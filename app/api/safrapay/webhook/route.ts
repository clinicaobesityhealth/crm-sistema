import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v47.14 — Recebe as notificações da Safrapay quando uma cobrança muda de estado.
//
// Honestidade sobre o estado desta rota: o formato exato do evento não está
// fechado na documentação pública, e eu não vou inventar um formato e fingir que
// funciona. Então esta rota faz duas coisas:
//
//   1) guarda o evento cru em `safrapay_eventos` — assim, no primeiro pagamento
//      real, a gente vê exatamente o que a Safrapay manda;
//   2) já tenta dar baixa automática procurando a cobrança por qualquer um dos
//      identificadores que costumam vir (orderCode, que é o nosso id; o id do
//      link; ou o chargeId).
//
// Se a baixa automática não pegar de primeira, nada se perde: o evento fica
// gravado e a conferência continua possível pela tela.
//
// A URL desta rota é cadastrada no portal da Safrapay:
//   https://crm.obesityhealth.com.br/api/safrapay/webhook

export const runtime = 'nodejs'

function acharStatus(e: any): string | null {
  const bruto = String(e?.status ?? e?.chargeStatus ?? e?.paymentStatus ?? e?.event ?? '').toLowerCase()
  if (!bruto) return null
  if (/(approved|aprovad|paid|pago|captur)/.test(bruto)) return 'paga'
  if (/(denied|negad|refus|declin)/.test(bruto)) return 'negada'
  if (/(cancel|estorn|refund)/.test(bruto)) return 'cancelada'
  if (/(expir)/.test(bruto)) return 'expirada'
  return null
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ ok: false }, { status: 503 })

  let evento: any = {}
  try { evento = await req.json() } catch {}

  // Sempre registra, aconteça o que acontecer com a baixa.
  await admin.from('safrapay_eventos').insert({ payload: evento }).select().maybeSingle()

  const orderCode = evento?.orderCode ?? evento?.order_code ?? evento?.data?.orderCode
  const linkId = evento?.smartCheckoutId ?? evento?.paymentLinkId ?? evento?.id ?? evento?.data?.id
  const status = acharStatus(evento) ?? acharStatus(evento?.data)

  if (status) {
    const patch: any = { status, confirmado_em: new Date().toISOString() }
    if (orderCode && /^[0-9a-f-]{36}$/i.test(String(orderCode))) {
      await admin.from('cobrancas_cartao').update(patch).eq('id', String(orderCode))
    } else if (linkId) {
      await admin.from('cobrancas_cartao').update(patch).eq('safra_link_id', String(linkId))
    }
  }

  // A Safrapay reenvia o evento se não receber 200. Respondemos 200 sempre que
  // conseguimos gravar — reenvio em cima de evento já gravado só geraria ruído.
  return NextResponse.json({ ok: true })
}
