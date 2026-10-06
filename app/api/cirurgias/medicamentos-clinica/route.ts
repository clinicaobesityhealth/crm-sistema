import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { sugerirMedicamentos } from '@/lib/pausamed'

// v48.112 — Confirmar e gravar, na base própria da clínica
// (cirurgia_medicamentos_clinica), um medicamento que acabou de ser
// pesquisado por IA (workflow "CRM - Pesquisar Remédio (IA)").
//
// Antes disso o próprio workflow n8n gravava sozinho, sem perguntar
// ninguém — o pedido foi explícito: perguntar antes de incluir, e só
// incluir na base DA CLÍNICA, nunca no PausaMed (o CRM nunca escreve lá,
// só lê — ver lib/pausamed.ts). Por isso esta rota não recebe texto livre
// do cliente: ela relê o medicamento já resolvido em cirurgia_medicamentos
// (a fonte da verdade do que a IA respondeu) e copia só esses campos.
//
// v48.125 — Também grava o HOSPITAL da cirurgia junto (nova coluna, ver
// migração 20260928_hospital_base_clinica_medicamentos_v48_125.sql), pelo
// mesmo motivo de sempre: não confiar em texto vindo do cliente. O hospital
// não vem no corpo do POST — é relido do banco (cirurgia_medicamentos →
// cirurgia_id → cirurgias.hospital), igual ao que
// app/api/cirurgias/[id]/medicamentos/resolver/route.ts já faz. Sem
// hospital nessa cirurgia, a linha grava com hospital NULL ("vale pra
// qualquer hospital" — ver resolverMedicamento()).
//
// GET ?q=termo → autocomplete usado em MedicamentosCirurgia.tsx ao digitar
// o nome de um medicamento novo: sugere entradas já existentes na base da
// clínica, uma por princípio ativo (não uma por linha — a mesma substância
// pode ter várias linhas, uma por hospital).

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

export async function POST(req: NextRequest) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  let b: any = {}
  try { b = await req.json() } catch {}
  const medicamentoId = String(b.medicamentoId || '')
  if (!medicamentoId) return NextResponse.json({ erro: 'Medicamento não informado.' }, { status: 400 })

  const { data: med } = await admin.from('cirurgia_medicamentos').select('*').eq('id', medicamentoId).maybeSingle()
  if (!med) return NextResponse.json({ erro: 'Medicamento não encontrado.' }, { status: 404 })
  if (med.fonte !== 'ia') {
    // Só faz sentido confirmar o que acabou de vir de uma pesquisa por IA —
    // o que já vem do PausaMed ou da própria base da clínica não precisa
    // (e não deve) ser duplicado aqui.
    return NextResponse.json({ erro: 'Este medicamento não veio de uma pesquisa por IA agora — nada para salvar.' }, { status: 400 })
  }
  if (!med.principio_ativo) return NextResponse.json({ erro: 'Sem princípio ativo resolvido — não há o que salvar.' }, { status: 400 })

  // v48.125 — hospital da cirurgia deste medicamento (relido do banco, não
  // do cliente — ver comentário no topo do arquivo).
  let hospitalNome: string | null = null
  if (med.cirurgia_id) {
    const { data: c } = await admin.from('cirurgias').select('hospital').eq('id', med.cirurgia_id).maybeSingle()
    hospitalNome = (c?.hospital || '').trim() || null
  }

  // Já existe (alguém confirmou antes, para o MESMO hospital — ou para
  // "qualquer hospital" quando não há hospital nesta cirurgia)? Não duplica.
  // v48.125 — o filtro por hospital é o que permite duas linhas para o
  // mesmo princípio ativo (uma por hospital) sem uma barrar a outra.
  const termo = (med.principio_ativo || '').trim()
  let consultaExistente = admin.from('cirurgia_medicamentos_clinica')
    .select('id').eq('ativo', true).ilike('principio_ativo', termo)
  consultaExistente = hospitalNome ? consultaExistente.ilike('hospital', hospitalNome) : consultaExistente.is('hospital', null)
  const { data: existente } = await consultaExistente.limit(1)
  if (existente && existente.length) {
    return NextResponse.json({ jaExistia: true, id: existente[0].id })
  }

  const { data: salvo, error } = await admin.from('cirurgia_medicamentos_clinica').insert({
    principio_ativo: med.principio_ativo || null,
    nomes_comerciais: med.nomes_comerciais || null,
    prazo_suspensao_dias: med.prazo_suspensao_dias,
    // v48.144 — Antes gravava med.fonte_referencia aqui em cima de
    // prazo_texto (era o mesmo desencontro de nomes — fonte_referencia, por
    // um bug antigo, guardava o texto cru do prazo). Agora fonte_referencia
    // guarda a referência de verdade (bula, diretriz...), e vai na coluna
    // nova certa (`referencia`) — ver migração v48.144.
    referencia: med.fonte_referencia || null,
    orientacao: med.clinical_notes || null,
    explicacao_paciente: med.explicacao_paciente || null,
    hospital: hospitalNome,
    fonte: 'ia',
    ativo: true,
  }).select('id').single()
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  return NextResponse.json({ jaExistia: false, id: salvo.id })
}

export async function GET(req: NextRequest) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const termo = (req.nextUrl.searchParams.get('q') || '').trim()
  if (termo.length < 2) return NextResponse.json({ medicamentos: [] })

  // v48.144 — Antes só olhava a NOSSA base (cirurgia_medicamentos_clinica —
  // o que a clínica já tinha pesquisado antes). Pedido do Jorge depois do
  // caso "MOUJARO": olhar também o catálogo do PRÓPRIO PausaMed
  // (clinical_rules), pra sugerir um remédio mesmo na primeira vez que
  // alguém digita o nome dele aqui — ver sugerirMedicamentos() em
  // lib/pausamed.ts.
  const sugestoes = await sugerirMedicamentos(termo)
  return NextResponse.json({ medicamentos: sugestoes })
}
