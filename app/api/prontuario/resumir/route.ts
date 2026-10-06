import { NextRequest, NextResponse } from 'next/server'

// Proxy server-side para o webhook n8n que gera o resumo clinico com IA (Gemini),
// a partir do historico já buscado (ver /api/prontuario). Não chama o MedX de novo.
const WH_RESUMIR = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-resumir-prontuario'

export async function POST(req: NextRequest) {
  try {
    const { historico, resumoClinico } = await req.json()
    if (!Array.isArray(historico)) return NextResponse.json({ error: 'historico é obrigatório' }, { status: 400 })

    const res = await fetch(WH_RESUMIR, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ historico, resumoClinico: resumoClinico || null }),
    })
    const buf = await res.arrayBuffer()
    const txt = new TextDecoder('utf-8').decode(buf)
    let json: any = null
    try { json = JSON.parse(txt) } catch {}

    if (!json || json.sucesso === false) {
      return NextResponse.json({ sucesso: false, mensagem: json?.mensagem || 'Não foi possível gerar o resumo com IA.' }, { status: 200 })
    }

    return NextResponse.json({ sucesso: true, resumo: json.resumo })
  } catch (e: any) {
    return NextResponse.json({ sucesso: false, mensagem: e?.message || 'Erro ao gerar resumo.' }, { status: 200 })
  }
}
