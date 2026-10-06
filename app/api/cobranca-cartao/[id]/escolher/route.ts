import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { criarLinkInfinitePay, normalizarInfinitePay, taxaInfinitePay, telefoneInfinitePay, emailInfinitePay, enderecoInfinitePay } from '@/lib/infinitepay'
import { criarLinkPagamento, taxaEfetiva, calcularBruto, type Bandeira, type SafraConfig } from '@/lib/safrapay'

// v47.18 — O paciente escolheu em quantas vezes quer pagar. Só agora criamos o
// link na Safrapay, com o valor exato daquele parcelamento.
//
// É este passo que permite o paciente escolher sem ninguém sair perdendo: como o
// link é criado depois da escolha, cada opção pode ter o preço certo da bandeira
// e do número de parcelas, em vez de um valor único calculado pelo pior caso.

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // v48.05 — Casca de proteção. Qualquer erro não previsto aqui dentro vira uma
  // resposta JSON com explicação. Sem ela, um erro solto sobe para a camada do
  // servidor, que responde com PÁGINA HTML — e a página do paciente, esperando
  // JSON, mostrava "Unexpected token '<'". Erro de infraestrutura não pode
  // chegar ao paciente disfarçado de erro de programa.
  try {
    return await tratar(req, params)
  } catch (e: any) {
    console.error('[cobranca-cartao/escolher] falha inesperada', e)
    return NextResponse.json(
      { erro: 'Não foi possível abrir o pagamento agora. Avise a clínica.', detalhe: String(e?.message || e).slice(0, 300) },
      { status: 500 })
  }
}

async function tratar(req: NextRequest, params: { id: string }) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'indisponivel' }, { status: 503 })

  const id = String(params?.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: 'nao encontrado' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const escolhidas = Math.min(Math.max(1, Number(body.parcelas) || 1), 12)

  const { data: cob } = await admin.from('cobrancas_cartao')
    .select('*')
    .eq('id', id).single()
  if (!cob) return NextResponse.json({ erro: 'nao encontrado' }, { status: 404 })

  if (cob.status === 'paga') return NextResponse.json({ erro: 'Esta cobrança já foi paga.' }, { status: 409 })
  // Já escolheu antes e voltou à página: devolve o mesmo link em vez de criar
  // outro. Duas cobranças abertas para o mesmo atendimento é pedido de confusão.
  // v48.50 — Na InfinitePay o paciente pode voltar e trocar o parcelamento antes
  // de pagar: aí criamos outro link, com o preço do novo número de parcelas.
  const trocouNaInfinite = (cob as any).provedor === 'infinitepay' && Number(cob.parcelas) !== escolhidas
  if (cob.status === 'escolhida' && cob.url && !trocouNaInfinite) return NextResponse.json({ url: cob.url, ja_escolhida: true, parcelas: cob.parcelas })

  const max = Math.min(Math.max(1, Number(cob.max_parcelas) || 1), 12)
  if (escolhidas > max) return NextResponse.json({ erro: 'Parcelamento acima do permitido.' }, { status: 400 })

  const { data: settings } = await admin.from('clinic_settings').select('*').limit(1).single()
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.obesityhealth.com.br').replace(/\/$/, '')

  // v48.50 — cobrança criada pela InfinitePay termina na InfinitePay.
  if ((cob as any).provedor === 'infinitepay') {
    const ip = normalizarInfinitePay((settings as any)?.infinitepay_config)
    if (!ip.handle) return NextResponse.json({ erro: 'Cobrança indisponível no momento.' }, { status: 503 })
    const liquidoIp = Math.round(Number(cob.valor_liquido) * 100)
    const taxaIp = taxaInfinitePay(ip, escolhidas)
    const totalIp = calcularBruto(liquidoIp, taxaIp)
    const { data: contato } = await admin.from('contacts').select('full_name, phone, email, custom_fields').eq('id', cob.contact_id).maybeSingle()
    let link: { url: string; slug: string | null }
    try {
      link = await criarLinkInfinitePay(ip, {
        valorCentavos: totalIp,
        descricao: cob.descricao || 'Atendimento Obesity Health',
        orderNsu: String(cob.id),
        redirectUrl: `${base}/pagamento-confirmado`,
        webhookUrl: `${base}/api/infinitepay/webhook`,
        nome: contato?.full_name || undefined,
        telefone: telefoneInfinitePay(contato?.phone),
        email: emailInfinitePay((contato as any)?.email),
        endereco: enderecoInfinitePay((contato as any)?.custom_fields),
      })
    } catch (e: any) {
      const motivo = String(e?.message || e).slice(0, 400)
      await admin.from('cobrancas_cartao').update({ erro: motivo }).eq('id', cob.id)
      await admin.from('infinitepay_eventos').insert({ origem: 'escolher', payload: { cobranca_id: cob.id, parcelas: escolhidas, erro: motivo, status_http: e?.status ?? null, corpo: e?.corpo ?? null } })
      return NextResponse.json({ erro: 'Não foi possível abrir o pagamento agora. Tente de novo em instantes ou avise a clínica.', detalhe: motivo }, { status: 502 })
    }
    await admin.from('cobrancas_cartao').update({
      status: 'escolhida', parcelas: escolhidas, valor_total: totalIp / 100, taxa_aplicada: taxaIp,
      url: link.url, infinitepay_slug: link.slug, escolhida_em: new Date().toISOString(),
    }).eq('id', cob.id)
    return NextResponse.json({ url: link.url, parcelas: escolhidas })
  }

  const cfg = ((settings as any)?.safra_config || {}) as SafraConfig
  if (!cfg.merchant_token) return NextResponse.json({ erro: 'Cobrança indisponível no momento.' }, { status: 503 })

  const bandeira = (cob.bandeira || cfg.bandeira_padrao || 'visa_master') as Bandeira
  const liquido = Math.round(Number(cob.valor_liquido) * 100)
  const taxa = cfg.repassar_taxa ? taxaEfetiva(cfg, bandeira, escolhidas) : 0
  const total = calcularBruto(liquido, taxa)

  let link: { id: string; url: string }
  try {
    link = await criarLinkPagamento(cfg, {
      valorCentavos: total,
      descricao: cob.descricao || 'Atendimento Obesity Health',
      orderCode: String(cob.id),
      maxParcelas: escolhidas,
      travarParcelas: true,   // o paciente já escolheu; o valor é exato para este parcelamento
      expiraEm: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      redirectUrl: `${base}/pagamento-confirmado`,
    })
  } catch (e: any) {
    const motivo = String(e?.message || e).slice(0, 400)
    await admin.from('cobrancas_cartao').update({ erro: motivo }).eq('id', cob.id)
    // Guardado também no log de eventos: é aqui que a clínica descobre POR QUE
    // uma cobrança não abriu, sem depender de alguém ter visto a tela na hora.
    await admin.from('safrapay_eventos').insert({
      payload: {
        origem: 'escolher', cobranca_id: cob.id, parcelas: escolhidas,
        erro: motivo, status_http: e?.status ?? null, corpo: e?.corpo ?? null,
      },
    })
    return NextResponse.json({
      erro: 'Não foi possível abrir o pagamento agora. Tente de novo em instantes ou avise a clínica.',
      detalhe: motivo,
    }, { status: 502 })
  }

  await admin.from('cobrancas_cartao').update({
    status: 'escolhida',
    parcelas: escolhidas,
    valor_total: total / 100,
    taxa_aplicada: taxa,
    safra_link_id: link.id,
    url: link.url,
    escolhida_em: new Date().toISOString(),
  }).eq('id', cob.id)

  return NextResponse.json({ url: link.url })
}
