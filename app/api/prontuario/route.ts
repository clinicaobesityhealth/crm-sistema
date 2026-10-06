import { NextRequest, NextResponse } from 'next/server'

// Proxy server-side para o webhook n8n que busca o prontuario no MedX (evita CORS
// no navegador e mantem o login/senha do MedX só dentro do n8n, nunca aqui).
//
// v48.163 — esse webhook ("tool-buscar-prontuario-medx") precisa ser criado no n8n
// (duplicando um workflow que já faz login no MedX) — ver IMPLANTACAO-v48.163.md.
const WH_PRONTUARIO = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-buscar-prontuario-medx'

export async function POST(req: NextRequest) {
  try {
    const { pacId, page, pageSize } = await req.json()
    if (!pacId) return NextResponse.json({ error: 'pacId é obrigatório' }, { status: 400 })

    const res = await fetch(WH_PRONTUARIO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pacId: String(pacId), page: page || 1, pageSize: pageSize || 50 }),
    })
    const buf = await res.arrayBuffer()
    const txt = new TextDecoder('utf-8').decode(buf)
    let json: any = null
    try { json = JSON.parse(txt) } catch {}

    if (!json) {
      return NextResponse.json({ error: 'Resposta inesperada do MedX', debug: { status: res.status, raw: txt.slice(0, 500) } }, { status: 502 })
    }

    const historico = Array.isArray(json.historico) ? json.historico : []
    const resumoClinico = json.resumoClinico || null

    return NextResponse.json({ historico, resumoClinico })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erro' }, { status: 500 })
  }
}
