import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { autenticarSafra, basesSafra, type SafraConfig } from '@/lib/safrapay'

// v48.05 — Teste de conexão com a Safrapay.
//
// Existe porque, quando uma cobrança falha, a pergunta é sempre a mesma: o
// problema é a credencial, é o ambiente errado, ou é a Safrapay fora do ar? Sem
// uma forma de perguntar isso diretamente, a investigação vira tentativa e erro
// em cima de paciente esperando para pagar.
//
// O teste faz SÓ a autenticação — não cria cobrança, não move dinheiro, não
// gera link. E nunca devolve o token: só se ele funcionou e, quando não
// funcionou, o que a Safrapay respondeu.

export const runtime = 'nodejs'

export async function POST(_req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (!admin) {
    return NextResponse.json({ ok: false, mensagem: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY configurada.' }, { status: 503 })
  }

  const { data: settings } = await admin.from('clinic_settings').select('safra_config').limit(1).single()
  const cfg = (settings?.safra_config || {}) as SafraConfig

  if (!cfg.merchant_token) {
    return NextResponse.json({
      ok: false,
      mensagem: 'Nenhum Merchant Token salvo. Preencha o campo acima e salve antes de testar.',
    })
  }

  const { gateway } = basesSafra(cfg.ambiente)
  const inicio = Date.now()

  try {
    await autenticarSafra(cfg)
    return NextResponse.json({
      ok: true,
      mensagem: `Conexão com a Safrapay funcionando (${cfg.ambiente === 'producao' ? 'produção' : 'homologação'}).`,
      ambiente: cfg.ambiente,
      gateway,
      // O tempo importa: uma autenticação que leva vários segundos é o aviso de
      // que a criação do link vai estourar o tempo limite mais tarde.
      tempo_ms: Date.now() - inicio,
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      mensagem: String(e?.message || e).slice(0, 300),
      ambiente: cfg.ambiente,
      gateway,
      status_http: e?.status ?? null,
      // Primeiros caracteres do que veio, quando não era JSON. É o que
      // diferencia "credencial recusada" de "bloqueio na frente do gateway".
      corpo: typeof e?.corpo === 'string' ? e.corpo.slice(0, 200) : null,
      tempo_ms: Date.now() - inicio,
    })
  }
}
