import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v48.127 — Registrar pagamento manualmente na aba Recibos.
//
// Por que existe: o PIX e o cartão do CRM só viram "Pago" sozinhos quando
// alguém confere — a Sofia lê o comprovante que o paciente manda na conversa
// (PIX) ou a InfinitePay avisa por webhook (cartão). Se a Sofia estava
// desligada na hora (relato real do Jorge: paciente pagou por PIX, mas como
// a Sofia não estava ativa, o comprovante nunca foi lido e a cobrança ficou
// "Aguardando pagamento" para sempre), ninguém tinha como corrigir isso na
// tela — só excluir e perder o registro. Agora dá para confirmar à mão.
//
// Mesma regra de segurança da exclusão (ver app/api/cobrancas/excluir):
// precisa estar logado e ter cadastro na equipe. Qualquer um da equipe pode
// registrar — é uma correção de algo que já aconteceu de verdade (o dinheiro
// já caiu), não uma permissão de dar desconto ou pular cobrança.

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  })
  const { data: { user } } = await pub.auth.getUser(token)
  if (!user) return NextResponse.json({ erro: 'Sessão inválida' }, { status: 401 })

  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  const { data: quem } = await admin.from('agents').select('name').eq('id', user.id).maybeSingle()
  if (!quem) return NextResponse.json({ erro: 'Usuário sem cadastro na equipe' }, { status: 403 })
  const nome = quem.name || 'equipe'

  let b: any = {}
  try { b = await req.json() } catch {}
  const tipo = String(b.tipo || '')
  const id = String(b.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: 'Registro inválido' }, { status: 400 })

  const agora = new Date().toISOString()

  if (tipo === 'pix') {
    const { data: reg } = await admin.from('cobrancas_pix')
      .select('id, status, contact_id, valor, descricao').eq('id', id).maybeSingle()
    if (!reg) return NextResponse.json({ erro: 'Cobrança não encontrada' }, { status: 404 })
    if (reg.status === 'paga') return NextResponse.json({ ok: true, ja_estava_paga: true })

    const { error } = await admin.from('cobrancas_pix').update({
      status: 'paga', pago_em: agora, confirmado_por: 'equipe', baixa_por: user.id, baixa_por_nome: nome,
    }).eq('id', id)
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

    await registrarNaConversa(admin, reg.contact_id, reg.valor, 'PIX', reg.descricao, nome)
    return NextResponse.json({ ok: true })
  }

  if (tipo === 'cartao') {
    const { data: reg } = await admin.from('cobrancas_cartao')
      .select('id, status, contact_id, valor_total, valor_pago, descricao').eq('id', id).maybeSingle()
    if (!reg) return NextResponse.json({ erro: 'Cobrança não encontrada' }, { status: 404 })
    if (reg.status === 'paga') return NextResponse.json({ ok: true, ja_estava_paga: true })

    const { error } = await admin.from('cobrancas_cartao').update({
      status: 'paga', confirmado_em: agora, pago_em: agora,
      valor_pago: reg.valor_pago ?? reg.valor_total, forma_pagamento: 'manual',
      baixa_por: user.id, baixa_por_nome: nome,
    }).eq('id', id)
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

    await registrarNaConversa(admin, reg.contact_id, reg.valor_pago ?? reg.valor_total, 'cartão', reg.descricao, nome)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ erro: 'Tipo inválido' }, { status: 400 })
}

// Mesmo padrão do lib/infinitepayBaixa.ts: um recado [INTERNO] na conversa,
// visível só para a equipe (nada é enviado ao WhatsApp do paciente), para
// quem olhar o histórico depois entender que foi uma baixa manual e não a
// Sofia/InfinitePay confirmando sozinha.
async function registrarNaConversa(admin: ReturnType<typeof getSupabaseAdmin>, contactId: string | null, valor: number | null, forma: string, descricao: string | null, nome: string) {
  if (!admin || !contactId) return
  try {
    const v = valor != null ? Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''
    await admin.from('messages').insert({
      contact_id: contactId, channel: 'whatsapp', direction: 'outbound', status: 'sent',
      content: `[INTERNO] 💳 Pagamento registrado manualmente por ${nome}: ${v} (${forma})${descricao ? ' — ' + descricao : ''}`,
    })
  } catch {}
}
