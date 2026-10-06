import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v48.59 — "Sincronizar agora" da aba Google Agenda: manda para o n8n as
// cirurgias de hoje em diante, uma a uma, para criar/atualizar os eventos.
// Útil na primeira vez (as que já existiam) e depois de cadastrar a agenda de
// um cirurgião. Precisa estar logado no CRM.

export const runtime = 'nodejs'
export const maxDuration = 60

const WEBHOOK = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-cirurgia-agenda'

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  })
  const { data: { user } } = await pub.auth.getUser(token)
  if (!user) return NextResponse.json({ erro: 'Sessão inválida' }, { status: 401 })

  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
  const { data: lista, error } = await admin.from('cirurgias').select('id')
    .gte('data_cirurgia', hoje).order('data_cirurgia').limit(300)
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  let enviadas = 0, falhas = 0
  for (const c of lista || []) {
    try {
      const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'update', id: c.id }) })
      if (r.ok) enviadas++; else falhas++
    } catch { falhas++ }
    await new Promise(r => setTimeout(r, 150))
  }
  return NextResponse.json({ ok: true, enviadas, falhas })
}
