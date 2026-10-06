import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v48.97 — Lista estruturada de medicamentos da cirurgia (base para a
// suspensão pré-operatória, integrada ao PausaMed em lib/pausamed.ts).
//   GET    → lista os medicamentos já cadastrados
//   POST   {acao:'adicionar', nome}         → cria uma linha pendente
//   POST   {acao:'importar_texto'}          → quebra `cirurgias.medicacoes`
//                                              (texto livre) em linhas, uma
//                                              por medicamento
//   PATCH  {id, ...campos}                  → edita uma linha (edição manual
//                                              marca fonte:'manual')
//   DELETE {id}                             → remove uma linha

export const runtime = 'nodejs'

async function quemEsta(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  })
  const { data: { user } } = await pub.auth.getUser(token)
  return user
}

// v48.154 — Pedido do Jorge: "não precisamos de Medicações em uso porque
// temos Medicações e suspensão" — o campo de texto livre (cirurgias.medicacoes)
// saiu da tela (CirurgiaModal.tsx). MAS esse mesmo campo é o que a Google
// Agenda usa hoje para mostrar "MEDICAÇÕES EM USO: ..." na descrição do
// evento (workflow n8n "CRM - Cirurgia -> Google Agenda") — importante para
// o dia da cirurgia, por pedido do próprio Jorge. Em vez de mexer no n8n,
// mantemos cirurgias.medicacoes sincronizado sozinho, gerado a partir da
// lista estruturada, toda vez que ela muda (nome, sem prazo/explicação — só
// os nomes, como já era o texto livre).
async function sincronizarMedicacoesTexto(admin: any, cirurgiaId: string) {
  const { data: meds } = await admin.from('cirurgia_medicamentos')
    .select('nome_informado').eq('cirurgia_id', cirurgiaId).order('criado_em')
  const texto = (meds || []).map((m: any) => String(m.nome_informado || '').trim()).filter(Boolean).join(', ')
  await admin.from('cirurgias').update({ medicacoes: texto || null }).eq('id', cirurgiaId)
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  const { data, error } = await admin.from('cirurgia_medicamentos')
    .select('*').eq('cirurgia_id', params.id).order('criado_em')
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  const { data: c } = await admin.from('cirurgias').select('medicacoes').eq('id', params.id).maybeSingle()
  return NextResponse.json({ medicamentos: data || [], medicacoesTextoLivre: c?.medicacoes || '' })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  let b: any = {}
  try { b = await req.json() } catch {}

  if (b.acao === 'importar_texto') {
    const { data: c } = await admin.from('cirurgias').select('medicacoes').eq('id', params.id).maybeSingle()
    const linhas = String(c?.medicacoes || '')
      .split(/[\n,;]+/).map(x => x.trim()).filter(Boolean)
    if (!linhas.length) return NextResponse.json({ erro: 'Não há medicações em texto livre para importar.' }, { status: 400 })
    const { data: existentes } = await admin.from('cirurgia_medicamentos').select('nome_informado').eq('cirurgia_id', params.id)
    const jaTem = new Set((existentes || []).map((x: any) => x.nome_informado.trim().toLowerCase()))
    const novas = linhas.filter(l => !jaTem.has(l.toLowerCase())).map(nome_informado => ({ cirurgia_id: params.id, nome_informado, status: 'pendente' }))
    if (!novas.length) return NextResponse.json({ importados: 0 })
    const { data, error } = await admin.from('cirurgia_medicamentos').insert(novas).select('*')
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    await sincronizarMedicacoesTexto(admin, params.id)
    return NextResponse.json({ importados: data?.length || 0, medicamentos: data })
  }

  const nome = String(b.nome || '').trim()
  if (!nome) return NextResponse.json({ erro: 'Nome do medicamento é obrigatório.' }, { status: 400 })
  const { data, error } = await admin.from('cirurgia_medicamentos')
    .insert({ cirurgia_id: params.id, nome_informado: nome, status: 'pendente' })
    .select('*').single()
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  await sincronizarMedicacoesTexto(admin, params.id)
  return NextResponse.json({ medicamento: data })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  let b: any = {}
  try { b = await req.json() } catch {}
  const id = String(b.id || '')
  if (!id) return NextResponse.json({ erro: 'Medicamento não informado.' }, { status: 400 })

  const { data: atual } = await admin.from('cirurgia_medicamentos').select('*').eq('id', id).eq('cirurgia_id', params.id).maybeSingle()
  if (!atual) return NextResponse.json({ erro: 'Medicamento não encontrado.' }, { status: 404 })
  if (atual.status === 'aprovado') return NextResponse.json({ erro: 'Medicamento já aprovado — não é mais possível editar (gere um novo documento se precisar mudar algo).' }, { status: 400 })

  const dados: any = {}
  if ('nome_informado' in b) dados.nome_informado = String(b.nome_informado || '').trim()
  if ('principio_ativo' in b) dados.principio_ativo = b.principio_ativo?.trim() || null
  if ('prazo_suspensao_dias' in b) dados.prazo_suspensao_dias = b.prazo_suspensao_dias === '' || b.prazo_suspensao_dias == null ? null : Number(b.prazo_suspensao_dias)
  if ('explicacao_paciente' in b) dados.explicacao_paciente = b.explicacao_paciente?.trim() || null

  // Edição manual de prazo/explicação substitui a origem PausaMed: não faz
  // sentido mostrar "fonte: hospital X" numa linha que a pessoa acabou de mudar.
  if ('prazo_suspensao_dias' in b || 'explicacao_paciente' in b) {
    dados.fonte = 'manual'
    dados.fonte_detalhe = 'Editado manualmente'
    dados.status = dados.prazo_suspensao_dias != null && dados.explicacao_paciente ? 'manual' : 'pendente'
  }

  const { data, error } = await admin.from('cirurgia_medicamentos').update(dados).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  if ('nome_informado' in dados) await sincronizarMedicacoesTexto(admin, params.id)
  return NextResponse.json({ medicamento: data })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ erro: 'Medicamento não informado.' }, { status: 400 })
  const { error } = await admin.from('cirurgia_medicamentos').delete().eq('id', id).eq('cirurgia_id', params.id).neq('status', 'aprovado')
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  await sincronizarMedicacoesTexto(admin, params.id)
  return NextResponse.json({ ok: true })
}
