import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { baixarInfinitePay } from '@/lib/infinitepayBaixa'

// v48.50 — Chamada pela página /pagamento-confirmado, com os identificadores que
// a InfinitePay põe no endereço ao devolver o paciente. É a segunda chance da
// baixa, caso o webhook não chegue. Pública, mas inofensiva: só marca como paga
// o que a própria InfinitePay confirmar no /payment_check.

export const runtime = 'nodejs'
export const maxDuration = 20

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ ok: false }, { status: 503 })
  let b: any = {}
  try { b = await req.json() } catch {}
  const r = await baixarInfinitePay(admin, {
    order_nsu: b?.order_nsu, transaction_nsu: b?.transaction_nsu, slug: b?.slug, receipt_url: b?.receipt_url,
  })
  return NextResponse.json({ ok: r.ok, pago: r.ok })
}
