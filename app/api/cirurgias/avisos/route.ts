import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v48.67 — A secretária decide o que fazer com a notícia pendente.
//   {acao:'enviar'}    → entra na fila do WhatsApp agora
//   {acao:'descartar'} → some do alerta, fica registrado quem decidiu
//
// v48.86 — {acao:'reenviar'} → a mesma coisa que 'enviar', mas para quando o
// aviso já tinha sido descartado antes e a secretária mudou de ideia clicando
// na mensagem "pendente" em Mensagens ao paciente (MensagensEnviadas.tsx). Fica
// separado de 'enviar' porque a trava contra clique duplo é por estado
// diferente: 'enviar' só vale a partir de pendente, 'reenviar' só a partir de
// descartado — cada um contra o duplo clique no seu próprio botão.
//
// v48.88 — {acao:'excluir'} → apaga o aviso de vez (pendente ou descartado).
// É para quando o texto ficou errado ou a mensagem não faz mais sentido: sem
// isso, o único jeito de "sumir" com uma pendência era descartar, e ela
// continuava lá, contando como decidida, até a situação voltar a mudar. Uma
// mensagem já enviada não entra aqui — é o registro do que o paciente recebeu.

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  })
  const { data: { user } } = await pub.auth.getUser(token)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  let b: any = {}
  try { b = await req.json() } catch {}
  const id = String(b.id || '')
  const acao = b.acao === 'descartar' ? 'descartar' : b.acao === 'reenviar' ? 'reenviar' : b.acao === 'excluir' ? 'excluir' : 'enviar'
  if (!id) return NextResponse.json({ erro: 'Aviso não informado.' }, { status: 400 })

  const { data: aviso } = await admin.from('cirurgia_avisos').select('*').eq('id', id).maybeSingle()
  if (!aviso) return NextResponse.json({ ok: true }) // já não existe — o resultado que quem apagou queria

  if (acao === 'excluir') {
    if (aviso.status === 'enviado') return NextResponse.json({ erro: 'Mensagem já enviada não pode ser apagada — é o registro do que foi mandado ao paciente.' }, { status: 400 })
    const { error } = await admin.from('cirurgia_avisos').delete().eq('id', id)
    if (error) return NextResponse.json({ erro: 'Não consegui apagar: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Duas pessoas com o CRM aberto veem o mesmo alerta. Quem clicar depois não
  // pode mandar a mensagem de novo — cada ação só vale a partir do estado que
  // é dela: 'enviar'/'descartar' de pendente, 'reenviar' de descartado.
  const estadoEsperado = acao === 'reenviar' ? 'descartado' : 'pendente'
  if (aviso.status !== estadoEsperado) return NextResponse.json({ ok: true, jaDecidido: true })

  // v48.97 — "medicamentos_pendentes" é uma TAREFA INTERNA (revisar antes de
  // gerar o documento), não notícia para o paciente — nunca pode virar
  // mensagem de WhatsApp. Ver a mesma trava em app/api/cirurgias/[id]/
  // documento/route.ts para a 'solicitacao' (por outro motivo: vai ao hospital).
  if ((acao === 'enviar' || acao === 'reenviar') && aviso.tipo === 'medicamentos_pendentes') {
    return NextResponse.json({ erro: 'Este aviso é uma tarefa interna — abra a cirurgia e gere o documento de suspensão de medicamentos.' }, { status: 400 })
  }

  if (acao === 'enviar' || acao === 'reenviar') {
    if (!aviso.contact_id) return NextResponse.json({ erro: 'Esta cirurgia não está ligada a um contato do CRM.' }, { status: 400 })
    const texto = String(b.texto || aviso.texto || '').trim()
    if (!texto) return NextResponse.json({ erro: 'Texto vazio.' }, { status: 400 })
    const { data: agente } = await admin.from('agents').select('id').eq('id', user.id).maybeSingle()
    const { error } = await admin.from('messages').insert({
      contact_id: aviso.contact_id, channel: 'whatsapp', direction: 'outbound',
      status: 'queued', content: texto, sender_id: agente?.id ?? null,
    })
    if (error) return NextResponse.json({ erro: 'Não consegui enfileirar: ' + error.message }, { status: 500 })
  }

  // v48.82 — Marca na cirurgia que o paciente foi cobrado, para o cartão
  // mostrar e para a varredura não voltar a perguntar antes da hora.
  if ((acao === 'enviar' || acao === 'reenviar') && aviso.tipo === 'preop_parado' && aviso.cirurgia_id) {
    const { data: atual } = await admin.from('cirurgias')
      .select('preop_avisos').eq('id', aviso.cirurgia_id).maybeSingle()
    await admin.from('cirurgias').update({
      preop_avisado_em: new Date().toISOString(),
      preop_avisos: (Number(atual?.preop_avisos) || 0) + 1,
    }).eq('id', aviso.cirurgia_id)
  }

  await admin.from('cirurgia_avisos').update({
    status: (acao === 'enviar' || acao === 'reenviar') ? 'enviado' : 'descartado',
    decidido_em: new Date().toISOString(),
    decidido_por: user.id,
    ...((acao === 'enviar' || acao === 'reenviar') && b.texto ? { texto: String(b.texto) } : {}),
  }).eq('id', id).eq('status', estadoEsperado)

  return NextResponse.json({ ok: true })
}
