import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { criarLinkInfinitePay, normalizarInfinitePay, limparHandle } from '@/lib/infinitepay'

// v48.50 — Botão "Gerar link de teste" da tela de Cobrança.
//
// Cria um link de R$ 1,00 e devolve o endereço. Criar link não cobra nada de
// ninguém: só vira cobrança se alguém abrir e pagar. Serve para provar que a
// InfiniteTag está certa antes de mandar link para paciente. O link de teste não
// vai para cobrancas_cartao nem gera mensagem.

export const runtime = 'nodejs'
export const maxDuration = 20

export async function POST(req: Request) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ ok: false, mensagem: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 })
  let b: any = {}
  try { b = await req.json() } catch {}

  // Aceita a InfiniteTag digitada na tela (ainda não salva) para testar antes de salvar.
  const { data: s } = await admin.from('clinic_settings').select('infinitepay_config').limit(1).maybeSingle()
  const cfg = normalizarInfinitePay((s as any)?.infinitepay_config)
  if (b?.handle) cfg.handle = limparHandle(String(b.handle))
  if (!cfg.handle) return NextResponse.json({ ok: false, mensagem: 'Preencha a InfiniteTag.' }, { status: 400 })

  const inicio = Date.now()
  try {
    const link = await criarLinkInfinitePay(cfg, {
      valorCentavos: 100,
      descricao: 'Teste do CRM - nao pagar',
      orderNsu: 'teste-' + Date.now(),
    })
    return NextResponse.json({ ok: true, mensagem: `Link criado para $${cfg.handle}. Abra e confira se aparece o nome da clínica.`, url: link.url, tempo_ms: Date.now() - inicio })
  } catch (e: any) {
    return NextResponse.json({ ok: false, mensagem: e?.message || String(e), status_http: e?.status ?? null, corpo: e?.corpo ?? null, tempo_ms: Date.now() - inicio })
  }
}
