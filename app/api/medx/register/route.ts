import { NextRequest, NextResponse } from 'next/server'

const REGISTER_WEBHOOK = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-cadastrar-paciente'
const SAVE_DRAFT_WEBHOOK = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-salvar-dados-cadastro'
const SEARCH_PATIENT_WEBHOOK = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-buscar-paciente'

function firstResult(value: any) {
  return Array.isArray(value) ? (value[0] ?? {}) : (value ?? {})
}

async function readResponse(response: Response) {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} } catch { return { message: text } }
}

function extractMedxId(value: any): string | null {
  const item = firstResult(value)
  const candidates = [
    item?.medx_id, item?.id_medx, item?.Id_do_Cliente, item?.Id, item?.id,
    item?.data?.medx_id, item?.data?.id_medx, item?.data?.Id_do_Cliente,
    item?.data?.Id, item?.data?.id,
    item?.paciente?.medx_id, item?.paciente?.id_medx,
    item?.paciente?.Id_do_Cliente, item?.paciente?.Id, item?.paciente?.id,
  ]
  const found = candidates.find(candidate =>
    candidate !== undefined && candidate !== null && String(candidate).trim()
  )
  return found === undefined ? null : String(found)
}

async function confirmPatientInMedx(body: any) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 750))
    const response = await fetch(SEARCH_PATIENT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cpf: body.cpf,
        telefone: String(body.celular).replace(/\D/g, ''),
        nome: String(body.nome).trim(),
        contact_id: body.contact_id,
      }),
      cache: 'no-store',
    })
    if (!response.ok) continue
    const result = await readResponse(response)
    const medxId = extractMedxId(result)
    if (medxId) return { medxId, result }
  }
  return { medxId: null, result: null }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const required = ['contact_id', 'nome', 'cpf', 'celular', 'nascimento', 'sexo']
    const missing = required.filter(field => !String(body?.[field] ?? '').trim())
    if (missing.length) {
      return NextResponse.json({ success: false, message: `Preencha: ${missing.join(', ')}.` }, { status: 400 })
    }

    // O flow do MedX exige que os dados estejam no rascunho antes do cadastro.
    // A Sofia faz isso em duas ferramentas; o cadastro manual do CRM precisa
    // executar as mesmas duas etapas automaticamente.
    const nascimento = /^\d{4}-\d{2}-\d{2}$/.test(body.nascimento)
      ? `${body.nascimento}T03:00:00.000Z`
      : body.nascimento
    const draftResponse = await fetch(SAVE_DRAFT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: body.contact_id,
        nome: String(body.nome).trim().toUpperCase(),
        nome_social: body.nome_social || '',
        sexo: body.sexo,
        nascimento,
        cpf: body.cpf,
        celular: String(body.celular).replace(/\D/g, ''),
        endereco_residencial: body.endereco_residencial || '',
        numero: body.numero || '',
        complemento: body.complemento || '',
        cep: String(body.cep || '').replace(/\D/g, ''),
        bairro: String(body.bairro || '').toUpperCase(),
        cidade: String(body.cidade || '').toUpperCase(),
        estado: String(body.estado || '').toUpperCase(),
        email: body.email || '',
        origem: 'crm_manual',
      }),
      cache: 'no-store',
    })
    const draftRaw = await readResponse(draftResponse)
    const draft = firstResult(draftRaw)
    if (!draftResponse.ok || draft?.success === false || draft?.ok === false || draft?.error) {
      return NextResponse.json({
        success: false,
        message: draft?.message || draft?.mensagem || draft?.error || 'O rascunho de cadastro não foi salvo.',
        etapa: 'salvar_dados_cadastro',
      }, { status: draftResponse.ok ? 422 : draftResponse.status })
    }

    const registerResponse = await fetch(REGISTER_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: body.contact_id, origem: 'crm_manual' }),
      cache: 'no-store',
    })
    const registerData = await readResponse(registerResponse)
    const registered = firstResult(registerData)
    if (!registerResponse.ok || registered?.success === false || registered?.error) {
      return NextResponse.json(registerData, { status: registerResponse.status })
    }

    let medxId = extractMedxId(registerData)
    let confirmation: any = null
    if (!medxId) {
      const confirmed = await confirmPatientInMedx(body)
      medxId = confirmed.medxId
      confirmation = confirmed.result
    }
    if (!medxId) {
      return NextResponse.json({
        success: false,
        message: 'O paciente foi gravado no MedX, mas a consulta de confirmação ainda não devolveu o identificador. Atualize os dados e tente vincular novamente.',
        etapa: 'confirmar_identificador_medx',
        cadastro_medx_confirmado: true,
      }, { status: 422 })
    }

    return NextResponse.json({
      ...registered,
      success: true,
      medx_id: medxId,
      Id_do_Cliente: medxId,
      confirmation,
    }, { status: registerResponse.status })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Falha ao comunicar com o cadastro MedX.' }, { status: 502 })
  }
}
