import { NextRequest, NextResponse } from 'next/server'

// Proxy server-side para os webhooks n8n (evita CORS no navegador)
const WH_PACIENTE = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-buscar-paciente'
const WH_AGENDA = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/buscar_agendamento'

export async function POST(req: NextRequest) {
  try {
    const { nome, telefone, cpf } = await req.json()

    // Corrige acentos quebrados (MedX às vezes manda ? no lugar de acentos)
    function fixAcentos(s: any): any {
      if (typeof s !== 'string') return s
      return s
    }

    // Chama os dois webhooks do servidor (sem CORS)
    const [pacRes, agRes] = await Promise.allSettled([
      fetch(WH_PACIENTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, telefone, cpf }),
      }),
      fetch(WH_AGENDA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome_paciente: nome, telefone }),
      }),
    ])

    let paciente: any = null
    let agendamentos: any[] = []
    const debug: any = {}

    if (pacRes.status === 'fulfilled') {
      const buf = await pacRes.value.arrayBuffer()
      const txt = new TextDecoder('utf-8').decode(buf)
      debug.paciente_status = pacRes.value.status
      if (txt) { try { const j = JSON.parse(txt); paciente = Array.isArray(j) ? j[0] : j } catch {} }
    } else {
      debug.paciente_erro = String(pacRes.reason)
    }
    if (agRes.status === 'fulfilled') {
      const buf = await agRes.value.arrayBuffer()
      const txt = new TextDecoder('utf-8').decode(buf)
      debug.agenda_status = agRes.value.status
      debug.agenda_raw = txt.slice(0, 300)
      if (txt) { try { const j = JSON.parse(txt); agendamentos = Array.isArray(j) ? j : [j] } catch {} }
    } else {
      debug.agenda_erro = String(agRes.reason)
    }

    return NextResponse.json({ paciente, agendamentos, debug })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erro' }, { status: 500 })
  }
}
