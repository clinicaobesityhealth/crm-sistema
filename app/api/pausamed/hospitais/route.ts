import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// v48.110 — Proxy de LEITURA para a base nacional de hospitais do PausaMed
// (tabela hospital_directory, dados do CNES: todo hospital do Brasil, com
// cidade/estado). Usamos o nome exatamente como está aqui ao gravar o
// hospital da cirurgia — é o que garante bater 100% com a busca de remédio
// no PausaMed depois (ver lib/pausamed.ts, resolverMedicamento). Rota
// pública (sem login): só devolve cadastro de hospital, nada de paciente —
// usada tanto pelo CRM (CirurgiaModal) quanto pelo link público do
// cirurgião (agendar-cirurgia/[token]).

export const runtime = 'nodejs'

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

function cliente() {
  const url = process.env.PAUSAMED_SUPABASE_URL || ''
  const key = process.env.PAUSAMED_SUPABASE_KEY || ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const modo = searchParams.get('modo') || 'hospitais'

  if (modo === 'estados') return NextResponse.json({ estados: UFS })

  const sb = cliente()
  if (!sb) return NextResponse.json({ erro: 'PAUSAMED_SUPABASE_URL / PAUSAMED_SUPABASE_KEY não configurados no servidor.' }, { status: 502 })

  if (modo === 'cidades') {
    const estado = (searchParams.get('estado') || '').toUpperCase().trim()
    if (!estado) return NextResponse.json({ erro: 'Informe o estado.' }, { status: 400 })
    const { data, error } = await sb.from('hospital_directory')
      .select('city').eq('state', estado).eq('is_active', true).limit(5000)
    if (error) return NextResponse.json({ erro: error.message }, { status: 502 })
    const cidades = Array.from(new Set((data || []).map((r: any) => String(r.city || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return NextResponse.json({ cidades })
  }

  // modo === 'hospitais'
  const estado = (searchParams.get('estado') || '').toUpperCase().trim()
  const cidade = (searchParams.get('cidade') || '').trim()
  const busca = (searchParams.get('busca') || '').trim()

  if (!estado && busca.length < 3) {
    return NextResponse.json({ erro: 'Escolha um estado ou digite ao menos 3 letras para buscar.' }, { status: 400 })
  }

  let q = sb.from('hospital_directory').select('id, name, city, state').eq('is_active', true)
  if (estado) q = q.eq('state', estado)
  if (cidade) q = q.eq('city', cidade)
  if (busca) q = q.ilike('name', `%${busca}%`)
  q = q.order('name').limit(50)

  const { data, error } = await q
  if (error) return NextResponse.json({ erro: error.message }, { status: 502 })
  return NextResponse.json({
    hospitais: (data || []).map((h: any) => ({ id: h.id, nome: h.name, cidade: h.city, estado: h.state })),
  })
}
