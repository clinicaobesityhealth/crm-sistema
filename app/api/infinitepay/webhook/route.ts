import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { baixarInfinitePay } from '@/lib/infinitepayBaixa'

// v48.50 — Aviso de pagamento aprovado da InfinitePay.
//
// O endereço desta rota vai DENTRO de cada link criado pelo CRM (webhook_url),
// então não há nada para cadastrar no app da InfinitePay.
//
// Regras da InfinitePay: responder 200 rápido; respondendo 400, ela reenvia.
// Usamos isso a nosso favor: se a conferência não pôde ser feita agora (rede,
// InfinitePay instável), respondemos 400 e ela tenta de novo mais tarde. Em
// qualquer outro caso — inclusive aviso falso — respondemos 200, porque reenviar
// não mudaria o resultado.

export const runtime = 'nodejs'
export const maxDuration = 20

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ success: false, message: 'indisponivel' }, { status: 400 })

  let evento: any = {}
  try { evento = await req.json() } catch {}

  // Sempre guarda o aviso cru: é a prova do que chegou, e a base para conferir
  // à mão se algum dia a baixa automática não pegar.
  await admin.from('infinitepay_eventos').insert({ origem: 'webhook', payload: evento })

  const r = await baixarInfinitePay(admin, {
    order_nsu: evento?.order_nsu,
    transaction_nsu: evento?.transaction_nsu,
    slug: evento?.invoice_slug ?? evento?.slug,
    receipt_url: evento?.receipt_url,
  })

  if (!r.ok) {
    await admin.from('infinitepay_eventos').insert({ origem: 'webhook-resultado', payload: { order_nsu: evento?.order_nsu ?? null, erro: r.motivo } })
    if (r.tentar_de_novo) return NextResponse.json({ success: false, message: r.motivo }, { status: 400 })
  }
  return NextResponse.json({ success: true, message: null })
}
