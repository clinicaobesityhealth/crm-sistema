import { NextRequest, NextResponse } from 'next/server'

// v48.22 — Dispara a sincronização com a planilha na hora, sem esperar os 15
// minutos do relógio.
//
// O botão da tela chama esta rota, e é ELA quem chama o n8n. O caminho podia
// ser direto do navegador, mas então a chave de sincronização precisaria estar
// no código que roda no navegador do usuário — ou seja, à vista de qualquer um.
// Aqui ela fica no servidor.

export const runtime = 'nodejs'
export const maxDuration = 60

const WEBHOOK_PADRAO = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/sincronizar-cirurgias'

export async function POST(_req: NextRequest) {
  const token = process.env.CIRURGIA_SYNC_TOKEN || ''
  if (!token) {
    return NextResponse.json({
      erro: 'Sincronização não configurada. Defina CIRURGIA_SYNC_TOKEN no EasyPanel.',
    }, { status: 503 })
  }

  const url = process.env.N8N_SYNC_WEBHOOK_URL || WEBHOOK_PADRAO

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'x-sync-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ origem: 'botao-crm' }),
      // A sincronização lê três abas, conversa com o banco e pode escrever de
      // volta. Um minuto é folgado; sem limite, o pedido ficaria pendurado.
      signal: AbortSignal.timeout(55000),
    })

    const texto = await r.text()
    let j: any = null
    try { j = texto ? JSON.parse(texto) : null } catch {}

    if (!r.ok) {
      return NextResponse.json({
        erro: 'A sincronização respondeu com erro.',
        detalhe: (j?.message || texto || '').slice(0, 300),
        status_http: r.status,
      }, { status: 502 })
    }

    // O n8n devolve o resumo do último nó, às vezes embrulhado num array.
    const resumo = Array.isArray(j) ? (j[0]?.json ?? j[0]) : (j?.json ?? j)
    return NextResponse.json({ ok: true, resumo: resumo ?? null })
  } catch (e: any) {
    const demorou = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    return NextResponse.json({
      erro: demorou
        ? 'A sincronização demorou mais de 55 segundos e foi interrompida. Ela pode ter terminado assim mesmo — confira no n8n.'
        : 'Não foi possível falar com a sincronização: ' + (e?.message || e),
    }, { status: 502 })
  }
}
