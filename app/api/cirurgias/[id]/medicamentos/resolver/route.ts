import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { resolverMedicamento } from '@/lib/pausamed'

// v48.97 — Consulta a base do PausaMed para UM medicamento da cirurgia e
// grava o resultado na linha (ainda como 'resolvido', não 'aprovado': quem
// aprova é o médico, revisando/editando antes de gerar o PDF).

export const runtime = 'nodejs'
// v48.101 — 30s bastava só para o PausaMed; agora pode cair na pesquisa por
// IA (workflow n8n, até 45s) quando nem o PausaMed nem a base da clínica têm
// o remédio.
export const maxDuration = 60

async function quemEsta(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  })
  const { data: { user } } = await pub.auth.getUser(token)
  return user
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  let b: any = {}
  try { b = await req.json() } catch {}
  const id = String(b.id || '')
  if (!id) return NextResponse.json({ erro: 'Medicamento não informado.' }, { status: 400 })

  const { data: med } = await admin.from('cirurgia_medicamentos').select('*').eq('id', id).eq('cirurgia_id', params.id).maybeSingle()
  if (!med) return NextResponse.json({ erro: 'Medicamento não encontrado.' }, { status: 404 })
  if (med.status === 'aprovado') return NextResponse.json({ erro: 'Medicamento já aprovado.' }, { status: 400 })

  const { data: c } = await admin.from('cirurgias').select('hospital').eq('id', params.id).maybeSingle()

  const regra = await resolverMedicamento({ nomeInformado: med.nome_informado, hospitalNome: c?.hospital || null })
  if (regra.erro && !regra.encontrado) {
    // v48.118 — "ia_falhou" quer dizer que a pesquisa por IA nem chegou a
    // rodar (já tentou 2x — ver lib/pausamed.ts) — diferente de "não achei o
    // remédio". Mensagem específica para não parecer que o remédio é
    // desconhecido quando na verdade a busca falhou.
    const msg = regra.erro.startsWith('ia_falhou')
      ? 'A pesquisa por IA falhou agora (instabilidade de rede entre o CRM e o serviço de IA) — tentamos 2 vezes. Toque em consultar de novo em alguns instantes.'
      : regra.erro
    return NextResponse.json({ erro: msg }, { status: 502 })
  }

  const dados: any = regra.encontrado ? {
    principio_ativo: regra.principioAtivo,
    nomes_comerciais: regra.nomesComerciais,
    prazo_suspensao_dias: regra.prazoSuspensaoDias,
    explicacao_paciente: regra.explicacaoPaciente,
    clinical_notes: regra.clinicalNotes,
    fonte: regra.fonte,
    fonte_detalhe: regra.fonteDetalhe,
    fonte_referencia: regra.fonteReferencia,
    // v48.121 — "Mounjaro achou o prazo (15 dias) mas não veio a orientação":
    // isso marcava status:'resolvido' só de olhar o prazo, mesmo com
    // explicacao_paciente vazio — a base do PausaMed às vezes tem o prazo
    // cadastrado sem o texto para o paciente. Resultado: a tela não avisava
    // que faltava revisar, e só dava pra notar abrindo o remédio na mão (foi
    // o que aconteceu com o João Jorge). Gerar o PDF de suspensão já exigia os
    // dois campos (medicamentosPendentes em DocumentosCirurgia.tsx) — agora o
    // status bate com essa mesma regra, então o alerta aparece na hora certa.
    status: (regra.prazoSuspensaoDias != null && String(regra.explicacaoPaciente || '').trim()) ? 'resolvido' : 'pendente',
  } : {
    fonte: null, fonte_detalhe: null, status: 'pendente',
  }

  const { data: salvo, error } = await admin.from('cirurgia_medicamentos').update(dados).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  return NextResponse.json({ medicamento: salvo, encontrado: regra.encontrado })
}
