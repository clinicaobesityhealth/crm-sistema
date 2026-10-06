import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v48.58 — Excluir uma cobrança (cartão ou PIX) ou um comprovante da aba
// Recibos. Existe para limpar testes e links gerados por engano.
//
// Regras:
//   - precisa estar logado no CRM;
//   - cobrança ainda em aberto: qualquer pessoa da equipe exclui;
//   - cobrança JÁ PAGA: só administrador — é registro financeiro.
//
// Observação honesta: o link da InfinitePay não tem como ser desativado pela
// API deles. Excluído aqui, ele some do CRM; se alguém pagar mesmo assim, o
// pagamento cai na conta normalmente, mas o CRM não dá baixa (não há mais
// cobrança para ligar) — o aviso fica guardado em infinitepay_eventos.

export const runtime = 'nodejs'

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
  const { data: quem } = await admin.from('agents').select('role, name').eq('id', user.id).maybeSingle()
  if (!quem) return NextResponse.json({ erro: 'Usuário sem cadastro na equipe' }, { status: 403 })
  const ehAdmin = quem.role === 'admin'

  let b: any = {}
  try { b = await req.json() } catch {}
  const tipo = String(b.tipo || '')
  const id = String(b.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: 'Registro inválido' }, { status: 400 })

  if (tipo === 'cartao' || tipo === 'pix') {
    const tabela = tipo === 'cartao' ? 'cobrancas_cartao' : 'cobrancas_pix'
    const { data: reg } = await admin.from(tabela).select('id, status').eq('id', id).maybeSingle()
    if (!reg) return NextResponse.json({ erro: 'Cobrança não encontrada' }, { status: 404 })
    if (reg.status === 'paga' && !ehAdmin) {
      return NextResponse.json({ erro: 'Cobrança já paga: só um administrador pode excluir.' }, { status: 403 })
    }
    const { error } = await admin.from(tabela).delete().eq('id', id)
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (tipo === 'comprovante') {
    // O comprovante é uma mensagem da conversa (arquivo que o paciente mandou).
    const { data: msg } = await admin.from('messages').select('id, content, direction').eq('id', id).maybeSingle()
    if (!msg || msg.direction !== 'inbound' || !String(msg.content || '').startsWith('[ARQUIVO: comprovante_pagamento]')) {
      return NextResponse.json({ erro: 'Comprovante não encontrado' }, { status: 404 })
    }
    const { error } = await admin.from('messages').delete().eq('id', id)
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ erro: 'Tipo inválido' }, { status: 400 })
}
