import { NextResponse } from 'next/server'

// v48.49 — Assinar os eventos da conta, sem depender de ninguém lembrar.
//
// Conectar a conta ao app da Meta e gerar o token NÃO faz o Instagram entregar
// as mensagens. Falta um terceiro passo, numa chavinha escondida na tela da
// Meta: assinar os eventos daquela conta. É um passo que não avisa quando fica
// faltando — a conta simplesmente não recebe nada, e a pessoa vai procurar o
// erro no token, no cadastro, no fluxo, em tudo menos onde ele está.
//
// Aconteceu com a conta do Dr. Marcello em 18/09: token válido, cadastro certo,
// e silêncio absoluto porque a assinatura estava vazia.
//
// Agora o próprio CRM assina ao salvar a conta. O passo continua existindo, mas
// deixa de depender de memória.

export const runtime = 'nodejs'
export const maxDuration = 20

// 'messages' é o que traz a mensagem do paciente. 'messaging_seen' é o aviso de
// leitura, que faz o tique ficar azul.
const CAMPOS = 'messages,messaging_seen'

export async function POST(req: Request) {
  let body: any = null
  try { body = await req.json() } catch {}

  const contaId = String(body?.instagram_business_account_id || '').trim()
  const token = String(body?.access_token || '').trim()
  if (!contaId || !token) {
    return NextResponse.json({ ok: false, erro: 'Informe a conta e o token.' }, { status: 400 })
  }

  const base = token.startsWith('IGA') ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0'

  try {
    const r = await fetch(`${base}/${contaId}/subscribed_apps?subscribed_fields=${CAMPOS}&access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      return NextResponse.json({
        ok: false,
        erro: j?.error?.message || 'A Meta recusou a assinatura dos eventos.',
      }, { status: 502 })
    }

    // Confere lendo de volta: "success: true" não é prova de que ficou assinado,
    // e aqui a diferença entre achar e ter certeza custou um dia de trabalho.
    const conf = await fetch(`${base}/${contaId}/subscribed_apps?access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(10000),
    })
    const cj = await conf.json().catch(() => ({}))
    const campos: string[] = (cj?.data || []).flatMap((x: any) => x?.subscribed_fields || [])

    return NextResponse.json({
      ok: campos.includes('messages'),
      campos,
      avisoDeLeitura: campos.includes('messaging_seen'),
    })
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? 'A Meta não respondeu em 10 segundos.' : (e?.message || String(e))
    return NextResponse.json({ ok: false, erro: msg }, { status: 502 })
  }
}
