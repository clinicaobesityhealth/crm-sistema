import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { simularInfinitePay, normalizarInfinitePay } from '@/lib/infinitepay'
import { simularParcelas, NOME_BANDEIRA, type Bandeira, type SafraConfig } from '@/lib/safrapay'

// v47.18 — Rota pública que alimenta a página /pagar-cartao/[id], aberta pelo
// paciente no celular. Devolve só o necessário para ele escolher o parcelamento:
// valor de cada opção, descrição e bandeira. Nada de dados clínicos, nada de
// telefone, nada de histórico — e, claro, nada de credencial da Safrapay.
//
// As opções são calculadas AQUI, no servidor. A página só desenha o que recebe:
// valor de cobrança não se calcula no navegador do paciente.

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'indisponivel' }, { status: 503 })

  const id = String(params?.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: 'nao encontrado' }, { status: 404 })

  const { data } = await admin.from('cobrancas_cartao')
    .select('*')
    .eq('id', id).single()
  if (!data) return NextResponse.json({ erro: 'nao encontrado' }, { status: 404 })

  const { data: settings } = await admin.from('clinic_settings').select('*').limit(1).single()
  const cfg = ((settings as any)?.safra_config || {}) as SafraConfig
  // v48.50 — vale o provedor da COBRANÇA, não o da chave atual: uma cobrança
  // criada no Safra termina no Safra mesmo que a clínica troque no meio.
  const provedor = String((data as any).provedor || 'safra')
  const infinite = provedor === 'infinitepay'
  const bandeira = (data.bandeira || cfg.bandeira_padrao || 'visa_master') as Bandeira

  const liquido = Math.round(Number(data.valor_liquido) * 100)
  const max = Math.min(Math.max(1, Number(data.max_parcelas) || 1), 12)
  const opcoes = (infinite
    ? simularInfinitePay(liquido, normalizarInfinitePay((settings as any)?.infinitepay_config), max)
    : simularParcelas(liquido, { ...cfg, max_parcelas: max }, bandeira))
    .map(o => ({ parcelas: o.parcelas, total: o.totalCentavos / 100, parcela: o.parcelaCentavos / 100 }))

  // Marca que o paciente abriu — ajuda a secretária a saber se o link foi visto.
  if (!data.status || data.status === 'enviada') {
    await admin.from('cobrancas_cartao').update({ aberta_em: new Date().toISOString() }).eq('id', id)
  }

  return NextResponse.json({
    descricao: data.descricao || '',
    bandeira: infinite ? null : bandeira,
    bandeira_nome: infinite ? '' : (NOME_BANDEIRA[bandeira] || ''),
    provedor,
    parcelas_escolhidas: data.status === 'escolhida' ? data.parcelas : null,
    status: data.status,
    opcoes,
    // Se o paciente já escolheu, devolvemos o endereço para ele continuar de onde
    // parou em vez de criar uma segunda cobrança.
    url_safra: data.status === 'escolhida' ? data.url : null,
  })
}
