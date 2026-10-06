// v48.50 — Link de pagamento da InfinitePay (cartão e PIX na página deles).
//
// Por que a InfinitePay entra: a Safrapay passou a dar trabalho (credencial,
// homologação, formato do aviso de pagamento que nunca foi documentado). A
// InfinitePay é o oposto em simplicidade: não há token, não há login, não há
// homologação. O que identifica a clínica é a InfiniteTag (o "handle", aquele
// $nome do app), e o link é criado com um único pedido.
//
// Fluxo (documentação InfinitePay — Checkout integrado):
//   1) POST https://api.checkout.infinitepay.io/links
//      { handle, items:[{quantity, price(centavos), description}], order_nsu,
//        redirect_url, webhook_url, customer{...} }  → devolve o endereço do link
//   2) O paciente paga na página da InfinitePay. Lá ELE escolhe o parcelamento
//      (a API não tem campo para travar as parcelas) e pode pagar também por PIX.
//   3) Pagamento aprovado → a InfinitePay chama o nosso webhook_url com
//      { invoice_slug, amount, paid_amount, installments, capture_method,
//        transaction_nsu, order_nsu, receipt_url, items }.
//   4) O aviso NÃO é assinado. Qualquer um poderia mandar um "está pago" falso
//      para o endereço. Por isso nada é dado como pago sem perguntar de volta à
//      própria InfinitePay: POST /payment_check → { success, paid, ... }.
//
// Este arquivo é importado também por telas (simulação), então não pode ter
// nada de servidor. A baixa do pagamento fica em lib/infinitepayBaixa.ts.

import { calcularBruto, type OpcaoParcela } from './safrapay'

export const API_INFINITEPAY = 'https://api.checkout.infinitepay.io'

export type InfinitePayConfig = {
  // A InfiniteTag, sem o "$" do começo.
  handle: string
  repassar_taxa: boolean
  paciente_escolhe: boolean
  avista_sem_acrescimo: boolean
  // 1..12 -> taxa em %. É uma tabela só: na InfinitePay a taxa do link é a
  // mesma para Visa, Master, Elo e Amex — não é preciso perguntar a bandeira.
  taxas: Record<string, number>
  max_parcelas: number
  texto_parcelamento: string
  // v48.54 — Quando quem acrescenta os juros é a própria InfinitePay: até
  // quantas parcelas ela está configurada para a CLÍNICA assumir a taxa
  // ("Assumindo até 1x" no app). 0 = repassa tudo ao paciente.
  assume_ate: number
}

// Tabela "Link de Pagamento e Gestão de Cobrança" enviada pelo Dr. Jorge em
// 21/09/2026 (Amex, Elo, Master e Visa). Plano Novus, recebimento em 1 dia útil — não
// existe antecipação para somar por cima, como no Safra.
export const TAXAS_INFINITEPAY_PADRAO: Record<string, number> = {
  '1': 4.20, '2': 6.09, '3': 7.01, '4': 7.91, '5': 8.80, '6': 9.67,
  '7': 12.59, '8': 13.42, '9': 14.25, '10': 15.06, '11': 15.87, '12': 16.66,
}

export const TEXTO_PARCELAMENTO_INFINITEPAY =
  'Pagamento à vista não tem acréscimo. No parcelado incidem os juros da operadora do cartão, ' +
  'já incluídos nos valores informados.'

// v48.50 — Padrão: quem acrescenta os juros é a PRÓPRIA InfinitePay, na página
// dela ("Repassar taxas" no app → Checkout Integrado → Configurações → Meios de
// pagamento). O CRM manda o valor que a clínica quer receber e o paciente vê, na
// página, o preço de cada parcelamento e o PIX sem acréscimo. É o único jeito em
// que o parcelamento escolhido lá nunca desencontra do valor cobrado.
export const INFINITEPAY_VAZIO: InfinitePayConfig = {
  handle: 'obesityhealth',
  repassar_taxa: false,
  paciente_escolhe: true,
  avista_sem_acrescimo: true,
  taxas: { ...TAXAS_INFINITEPAY_PADRAO },
  max_parcelas: 12,
  texto_parcelamento: TEXTO_PARCELAMENTO_INFINITEPAY,
  assume_ate: 1,
}

export function normalizarInfinitePay(bruto: any): InfinitePayConfig {
  const c = (bruto || {}) as Partial<InfinitePayConfig>
  const taxas: Record<string, number> = { ...TAXAS_INFINITEPAY_PADRAO }
  if (c.taxas) for (const [k, v] of Object.entries(c.taxas)) {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0 && n < 100) taxas[k] = n
  }
  return {
    handle: limparHandle(c.handle ?? INFINITEPAY_VAZIO.handle),
    repassar_taxa: c.repassar_taxa ?? false,
    paciente_escolhe: c.paciente_escolhe ?? true,
    avista_sem_acrescimo: c.avista_sem_acrescimo ?? true,
    taxas,
    max_parcelas: Math.min(Math.max(1, Number(c.max_parcelas) || 12), 12),
    texto_parcelamento: c.texto_parcelamento ?? TEXTO_PARCELAMENTO_INFINITEPAY,
    assume_ate: Math.min(Math.max(0, Number.isFinite(Number(c.assume_ate)) ? Number(c.assume_ate) : 1), 12),
  }
}

// "$obesityhealth", " @obesityhealth ", "infinitepay.io/obesityhealth" → "obesityhealth"
export function limparHandle(h: string): string {
  let s = String(h || '').trim()
  s = s.replace(/^https?:\/\/[^/]+\//i, '')
  s = s.replace(/^[$@]+/, '')
  return s.split(/[/?#\s]/)[0].toLowerCase()
}

export function taxaInfinitePay(cfg: InfinitePayConfig, parcelas: number): number {
  if (!cfg.repassar_taxa) return 0
  if (parcelas === 1 && cfg.avista_sem_acrescimo) return 0
  const t = Number(cfg.taxas?.[String(parcelas)] ?? TAXAS_INFINITEPAY_PADRAO[String(parcelas)])
  return Number.isFinite(t) && t >= 0 && t < 100 ? t : 0
}

export function simularInfinitePay(liquidoCentavos: number, cfg: InfinitePayConfig, max?: number): OpcaoParcela[] {
  const limite = Math.min(Math.max(1, max ?? cfg.max_parcelas ?? 12), 12)
  const opcoes: OpcaoParcela[] = []
  for (let p = 1; p <= limite; p++) {
    const taxa = taxaInfinitePay(cfg, p)
    const total = calcularBruto(liquidoCentavos, taxa)
    opcoes.push({ parcelas: p, taxa, totalCentavos: total, parcelaCentavos: Math.ceil(total / p) })
  }
  return opcoes
}

// v48.54 — O que o paciente vai ver na página da InfinitePay quando é ELA que
// acrescenta os juros. Serve para a secretária enxergar e passar orçamento.
// É uma estimativa: a conta é a mesma do CRM (a clínica recebe o valor
// digitado; o acréscimo cobre a taxa da tabela), e o valor exato é o que a
// InfinitePay mostrar. Até "assume_ate" parcelas, a clínica paga a taxa e o
// paciente paga o valor cheio.
export function simularRepasseInfinitePay(liquidoCentavos: number, cfg: InfinitePayConfig, max?: number): OpcaoParcela[] {
  const limite = Math.min(Math.max(1, max ?? cfg.max_parcelas ?? 12), 12)
  const assume = Math.max(0, Number(cfg.assume_ate) || 0)
  const opcoes: OpcaoParcela[] = []
  for (let p = 1; p <= limite; p++) {
    const t = p <= assume ? 0 : Number(cfg.taxas?.[String(p)] ?? TAXAS_INFINITEPAY_PADRAO[String(p)]) || 0
    const total = calcularBruto(liquidoCentavos, t)
    opcoes.push({ parcelas: p, taxa: t, totalCentavos: total, parcelaCentavos: Math.ceil(total / p) })
  }
  return opcoes
}

export class ErroInfinitePay extends Error {
  status: number | null
  corpo: string | null
  constructor(msg: string, status: number | null = null, corpo: string | null = null) {
    super(msg); this.status = status; this.corpo = corpo
  }
}

// Telefone do cadastro → "+5511999887766", que é o formato pedido. Se não der
// para montar com segurança, não manda: o campo é opcional e um telefone mal
// formatado faria o link inteiro ser recusado.
export function telefoneInfinitePay(phone: string | null | undefined): string | undefined {
  const d = String(phone || '').replace(/\D/g, '')
  if (String(phone || '').startsWith('ig:')) return undefined
  if (d.length === 12 || d.length === 13) return d.startsWith('55') ? '+' + d : undefined
  if (d.length === 10 || d.length === 11) return '+55' + d
  return undefined
}

// E-mail do cadastro, só se tiver cara de e-mail: um valor inválido faria a
// InfinitePay recusar o link inteiro por causa de um campo opcional.
export function emailInfinitePay(email: string | null | undefined): string | undefined {
  const e = String(email || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : undefined
}

export type EnderecoInfinite = { cep: string; street: string; neighborhood?: string; number: string; complement?: string }

// Endereço do cadastro (custom_fields.dados_medx), para a etapa de endereço do
// checkout já vir preenchida. A InfinitePay exige CEP — sem CEP no cadastro não
// manda nada, para não correr o risco de o link ser recusado por um campo opcional.
export function enderecoInfinitePay(customFields: any): EnderecoInfinite | undefined {
  const dm = customFields?.dados_medx || {}
  const cep = String(dm.cep || customFields?.cep || '').replace(/\D/g, '')
  const rua = String(dm.endereco_residencial || '').trim()
  const numero = String(dm.numero || '').trim()
  if (cep.length !== 8 || !rua || !numero) return undefined
  const e: EnderecoInfinite = { cep, street: rua.slice(0, 120), number: numero.slice(0, 20) }
  if (dm.bairro) e.neighborhood = String(dm.bairro).trim().slice(0, 80)
  if (dm.complemento) e.complement = String(dm.complemento).trim().slice(0, 80)
  return e
}

export type DadosLinkInfinite = {
  valorCentavos: number
  descricao: string
  orderNsu: string
  redirectUrl?: string
  webhookUrl?: string
  nome?: string
  telefone?: string
  email?: string
  endereco?: EnderecoInfinite
}

// A documentação não descreve o nome do campo da resposta; aceita os nomes
// plausíveis e, se nenhum vier, mostra a resposta crua no erro em vez de fingir.
function acharUrl(j: any): string | null {
  const c = [j?.url, j?.link, j?.checkout_url, j?.payment_url, j?.data?.url, j?.data?.link]
  const u = c.find(x => typeof x === 'string' && /^https?:\/\//.test(x))
  return u || null
}

export async function criarLinkInfinitePay(cfg: InfinitePayConfig, d: DadosLinkInfinite): Promise<{ url: string; slug: string | null }> {
  const handle = limparHandle(cfg.handle)
  if (!handle) throw new ErroInfinitePay('InfiniteTag não configurada. Vá em Configurações → Cobrança.')
  if (!Number.isInteger(d.valorCentavos) || d.valorCentavos < 100) throw new ErroInfinitePay('Valor mínimo do link é R$ 1,00.')

  const corpo: any = {
    handle,
    items: [{ quantity: 1, price: d.valorCentavos, description: (d.descricao || 'Atendimento').slice(0, 120) }],
    order_nsu: d.orderNsu,
  }
  if (d.redirectUrl) corpo.redirect_url = d.redirectUrl
  if (d.webhookUrl) corpo.webhook_url = d.webhookUrl
  const cliente: any = {}
  if (d.nome) cliente.name = d.nome.slice(0, 80)
  if (d.telefone) cliente.phone_number = d.telefone
  if (d.email) cliente.email = d.email
  if (d.endereco) corpo.address = d.endereco
  if (Object.keys(cliente).length) corpo.customer = cliente

  let r: Response
  try {
    r = await fetch(`${API_INFINITEPAY}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15000),
    })
  } catch (e: any) {
    throw new ErroInfinitePay(e?.name === 'TimeoutError' ? 'A InfinitePay não respondeu em 15 segundos.' : 'Sem conexão com a InfinitePay: ' + (e?.message || e))
  }
  const texto = await r.text()
  let j: any = null
  try { j = JSON.parse(texto) } catch {}
  if (!r.ok) {
    const msg = j?.message || j?.error || j?.errors?.[0]?.message || texto.slice(0, 200) || `HTTP ${r.status}`
    throw new ErroInfinitePay('A InfinitePay recusou o link: ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)), r.status, texto.slice(0, 500))
  }
  const url = acharUrl(j)
  if (!url) throw new ErroInfinitePay('A InfinitePay respondeu sem o endereço do link.', r.status, texto.slice(0, 500))
  const slug = j?.slug || j?.invoice_slug || (url.match(/[?&]lenc=([^&]+)/)?.[1] ?? null)
  return { url, slug: slug ? String(slug) : null }
}

export type ConferenciaInfinite = {
  success: boolean
  paid: boolean
  amount: number | null
  paid_amount: number | null
  installments: number | null
  capture_method: string | null
}

export async function conferirPagamentoInfinitePay(
  cfg: InfinitePayConfig,
  q: { order_nsu: string; transaction_nsu: string; slug: string },
): Promise<ConferenciaInfinite> {
  const r = await fetch(`${API_INFINITEPAY}/payment_check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ handle: limparHandle(cfg.handle), ...q }),
    signal: AbortSignal.timeout(8000),
  })
  const texto = await r.text()
  let j: any = null
  try { j = JSON.parse(texto) } catch {}
  if (!r.ok || !j) throw new ErroInfinitePay('Conferência recusada pela InfinitePay', r.status, texto.slice(0, 300))
  const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v))
  return {
    success: !!j.success,
    paid: !!j.paid,
    amount: num(j.amount),
    paid_amount: num(j.paid_amount),
    installments: num(j.installments),
    capture_method: j.capture_method ?? null,
  }
}
