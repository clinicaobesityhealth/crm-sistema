import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v48.46 — O aviso de leitura do Instagram.
//
// Quando a paciente abre a mensagem, a Meta manda um evento separado — não é
// parte da mensagem, é uma notificação própria, com o identificador da última
// mensagem que ela viu. Até agora ninguém escutava esse aviso, e por isso o
// tique nunca ficava azul no Instagram.
//
// Esta rota existe para receber esse aviso vindo do n8n. Ela mora no CRM, e não
// no fluxo, por um motivo concreto: aqui dentro a chave do banco já está
// configurada no servidor, então o n8n não precisa carregar credencial nenhuma
// para fazer esse trabalho.
//
// O que ela marca como lida: a mensagem indicada E as anteriores daquela mesma
// conversa. É assim que o Instagram funciona — quem abre a conversa vê tudo o
// que estava para trás, não só a última.
//
// O que ela NUNCA marca: mensagem que falhou. Uma mensagem recusada pela Meta
// não pode virar "lida" por causa de um aviso atrasado — seria a falha
// silenciosa de novo, com outra roupa.

export const runtime = 'nodejs'
export const maxDuration = 20

const ENVIADAS = ['sent', 'enviada', 'enviado', 'delivered', 'entregue']

type Leitura = { mid: string | null; quando: string | null }

// O evento chega como a Meta manda, ou já simplificado pelo fluxo. Aceitar as
// duas formas evita que uma mudança no n8n quebre isto em silêncio.
function lerEvento(body: any): Leitura[] {
  const saida: Leitura[] = []

  const push = (mid: any, ts: any) => {
    const m = mid ? String(mid) : null
    const quando = ts ? new Date(Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000).toISOString() : null
    if (m || quando) saida.push({ mid: m, quando: quando && !isNaN(Date.parse(quando)) ? quando : null })
  }

  if (body?.mid || body?.watermark) push(body.mid, body.watermark || body.timestamp)

  const entradas = Array.isArray(body?.entry) ? body.entry : []
  for (const e of entradas) {
    const msgs = Array.isArray(e?.messaging) ? e.messaging : []
    for (const m of msgs) {
      if (m?.read) push(m.read.mid, m.read.watermark || m.timestamp)
    }
  }

  return saida
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ ok: false, erro: 'Banco indisponível.' }, { status: 500 })

  let body: any = null
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, erro: 'Corpo inválido.' }, { status: 400 }) }

  const leituras = lerEvento(body)
  if (leituras.length === 0) return NextResponse.json({ ok: true, marcadas: 0, motivo: 'evento sem aviso de leitura' })

  let marcadas = 0

  for (const l of leituras) {
    // A mensagem que a paciente viu. É por ela que se descobre a conversa e o
    // momento — sem isso, não dá para saber o que mais ficou para trás.
    let contatoId: string | null = null
    let ate: string | null = l.quando

    if (l.mid) {
      const { data } = await admin.from('messages')
        .select('id, contact_id, created_at, status')
        .eq('external_id', l.mid)
        .maybeSingle()
      if (data) {
        contatoId = (data as any).contact_id
        ate = (data as any).created_at
      }
    }

    // Sem conseguir localizar a mensagem, não há o que marcar. Melhor não fazer
    // nada do que marcar a conversa errada.
    if (!contatoId || !ate) continue

    const { data: alteradas } = await admin.from('messages')
      .update({ status: 'read' })
      .eq('contact_id', contatoId)
      .eq('direction', 'outbound')
      .in('status', ENVIADAS)
      .lte('created_at', ate)
      .select('id')

    marcadas += (alteradas?.length || 0)
  }

  return NextResponse.json({ ok: true, marcadas })
}
