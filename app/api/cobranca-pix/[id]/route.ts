import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v47.06 — Rota pública (sem login) que alimenta a página /pagar/[id], aberta
// pelo paciente no celular. Devolve só o necessário para mostrar o valor e o
// código: nada de dados clínicos, nada de telefone, nada de histórico.

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'indisponivel' }, { status: 503 })

  const id = String(params?.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: 'nao encontrado' }, { status: 404 })

  const { data } = await admin.from('cobrancas_pix')
    .select('id, valor, descricao, brcode, qr_url, status, created_at')
    .eq('id', id).single()

  if (!data) return NextResponse.json({ erro: 'nao encontrado' }, { status: 404 })

  const { data: settings } = await admin.from('clinic_settings').select('pix_config').limit(1).single()
  const pix = (settings?.pix_config || {}) as any

  return NextResponse.json({
    valor: Number(data.valor),
    descricao: data.descricao || '',
    brcode: data.brcode,
    qr_url: data.qr_url,
    status: data.status,
    recebedor: pix.nome_recebedor || 'OBESITY HEALTH',
    banco: pix.banco || '',
  })
}
