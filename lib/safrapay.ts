// v47.14 — Integração com o Link de Pagamentos da Safrapay (cartão).
//
// Por que este caminho e não a API de cartão "direta": na API direta o número do
// cartão e o CVV trafegam pelo nosso servidor, o que exige certificação PCI-DSS
// da clínica. No Link de Pagamentos, o paciente digita o cartão numa página
// hospedada pela própria Safrapay. Nada de cartão passa por aqui — nós só
// pedimos "cobre R$ X com esta descrição" e recebemos um endereço para mandar
// no WhatsApp.
//
// Fluxo (documentação Safrapay):
//   1) POST {gateway}/v2/merchant/auth  — header Authorization: <MerchantToken>
//      (valor direto, SEM "Bearer" e sem corpo) → devolve accessToken (JWT)
//   2) POST {gateway}/v2/paymentlink    — header Authorization: Bearer <JWT>
//      → devolve { id, smartCheckoutUrl }
//   3) URL final = {portal}{smartCheckoutUrl}
//   4) Consulta/cancelamento: GET/DELETE {gateway}/v2/smartcheckout/{id}?type=1

export type Bandeira = 'visa_master' | 'elo' | 'amex'

export type TabelaBandeira = {
  debito: number                     // taxa do débito (à vista, sem parcelamento)
  parcelas: Record<string, number>   // 1..12 -> taxa do crédito em %
}

export type SafraConfig = {
  ambiente: 'homologacao' | 'producao'
  merchant_id: string
  merchant_token: string
  meios: number[]                    // 1=Débito 2=Crédito 3=Voucher 4=Boleto 8=Pix
  repassar_taxa: boolean
  // Quem escolhe o parcelamento: a secretária (link travado) ou o paciente, na
  // página do Safra.
  paciente_escolhe: boolean
  // v47.17 — taxa por BANDEIRA. A secretária pergunta ao paciente qual cartão ele
  // vai usar e escolhe na hora de cobrar; assim o preço sai exato, em vez de
  // supor o pior caso e cobrar de todo mundo a taxa da bandeira mais cara.
  taxas_bandeira: Record<Bandeira, TabelaBandeira>
  bandeira_padrao: Bandeira
  antecipa: boolean                  // a clínica antecipa os recebimentos?
  // Pagamento à vista sai sem nenhum acréscimo — nem taxa de cartão, nem
  // antecipação. É uma decisão da clínica, não do sistema, e por isso é uma
  // chave: o acréscimo passa a existir só a partir de 2x, onde ele é juros de
  // parcelamento e aparece discriminado para o paciente.
  avista_sem_acrescimo: boolean
  // Explicação do acréscimo, enviada junto com a cobrança. Fica na configuração
  // (e não no código) para a clínica ajustar a redação sem depender de versão
  // nova — texto que vai para paciente costuma ser afinado com o uso.
  texto_parcelamento: string
  taxa_antecipacao: number           // % ao mês da antecipação
  max_parcelas: number
}

export const NOME_BANDEIRA: Record<Bandeira, string> = {
  visa_master: 'Visa / Master',
  elo: 'Elo',
  amex: 'Amex',
}

function faixas(avista: number, ate6: number, ate12: number): Record<string, number> {
  const t: Record<string, number> = { '1': avista }
  for (let p = 2; p <= 6; p++) t[String(p)] = ate6
  for (let p = 7; p <= 12; p++) t[String(p)] = ate12
  return t
}

// Contrato Obesity Health — coluna ONLINE (a outra coluna é a da maquininha
// física e não vale aqui). Repare que o débito online é MAIS CARO que o crédito
// à vista em todas as bandeiras: 2,85% contra 2,06% na Visa/Master.
export const TAXAS_BANDEIRA_PADRAO: Record<Bandeira, TabelaBandeira> = {
  visa_master: { debito: 2.85, parcelas: faixas(2.06, 2.51, 2.99) },
  elo:         { debito: 2.85, parcelas: faixas(2.56, 2.76, 3.26) },
  amex:        { debito: 0,    parcelas: faixas(2.66, 2.76, 2.96) }, // Amex não tem débito
}

export const ANTECIPACAO_PADRAO = 1.97

export const TEXTO_PARCELAMENTO_PADRAO =
  'Pagamento à vista não tem acréscimo. No parcelado incidem os juros da operadora do cartão, ' +
  'já incluídos nos valores informados.'

export const MEIOS_SAFRA: Record<number, string> = {
  1: 'Débito', 2: 'Crédito', 3: 'Voucher', 4: 'Boleto', 8: 'Pix',
}

export function basesSafra(ambiente: string) {
  return ambiente === 'producao'
    ? { gateway: 'https://payment.safrapay.com.br', portal: 'https://portal.safrapay.com.br' }
    : { gateway: 'https://payment-hml.safrapay.com.br', portal: 'https://portal-hml.safrapay.com.br' }
}

// O JWT tem validade curta. Guardamos em memória do processo para não autenticar
// a cada cobrança — mas com margem de segurança, e sem persistir em lugar nenhum.
const cacheToken: Record<string, { token: string; expiraEm: number }> = {}


// v48.05 — Toda chamada à Safrapay passa por aqui.
//
// Antes, o fetch ia solto. Quando a Safrapay demorava ou não respondia, a
// requisição ficava pendurada até o proxy do servidor desistir — e o proxy
// devolve uma PÁGINA DE ERRO EM HTML, não JSON. Era o que a página do paciente
// recebia, e daí o "Unexpected token '<'": um erro de infraestrutura chegando
// disfarçado de erro de programa.
//
// Com o tempo limite abaixo, quem desiste primeiro somos nós, e o paciente vê
// uma frase em português em vez de um erro de JSON.
const TEMPO_LIMITE_MS = 12000

export class ErroSafra extends Error {
  status: number
  corpo: string
  constructor(mensagem: string, status = 0, corpo = '') {
    super(mensagem)
    this.name = 'ErroSafra'
    this.status = status
    this.corpo = corpo
  }
}

async function chamarSafra(url: string, init: RequestInit): Promise<any> {
  let r: Response
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
  } catch (e: any) {
    const demorou = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    throw new ErroSafra(
      demorou
        ? `A Safrapay não respondeu em ${TEMPO_LIMITE_MS / 1000} segundos.`
        : `Não foi possível falar com a Safrapay: ${e?.message || e}`)
  }

  // A resposta pode não ser JSON — página de erro do gateway, bloqueio de WAF,
  // manutenção. Lemos como texto primeiro para conseguir DIZER o que veio, em
  // vez de estourar num JSON.parse sem contexto.
  const texto = await r.text()
  let json: any = null
  try { json = texto ? JSON.parse(texto) : null } catch {}

  if (json === null && texto.trim()) {
    throw new ErroSafra(
      `A Safrapay respondeu algo que não é JSON (HTTP ${r.status}).`,
      r.status, texto.slice(0, 300))
  }
  return { ok: r.ok, status: r.status, json: json ?? {} }
}

export async function autenticarSafra(cfg: SafraConfig): Promise<string> {
  const chave = `${cfg.ambiente}:${cfg.merchant_token.slice(-6)}`
  const agora = Date.now()
  const guardado = cacheToken[chave]
  if (guardado && guardado.expiraEm > agora) return guardado.token

  const { gateway } = basesSafra(cfg.ambiente)
  const { ok, status, json: j } = await chamarSafra(`${gateway}/v2/merchant/auth`, {
    method: 'POST',
    headers: { 'Authorization': cfg.merchant_token },
  })
  if (!ok || !j?.accessToken) {
    const detalhe = j?.errors?.[0]?.message || `HTTP ${status}`
    // v48.06 — O 401 quase sempre é ambiente trocado, não chave errada. A chave
    // emitida no portal developers vale só em homologação; mandada para o
    // gateway de produção ela volta 401 por mais correta que esteja. Dizer isso
    // aqui evita a caça ao erro que já custou uma tarde.
    const dica = status === 401 && cfg.ambiente === 'producao'
      ? ' — a chave do portal developers vale só em homologação. Para cobrar de verdade, a Safrapay precisa liberar as credenciais de produção.'
      : ''
    throw new ErroSafra(`Safrapay recusou as credenciais: ${detalhe}${dica}`, status)
  }
  // 25 minutos é conservador: a documentação não fixa a validade, e reautenticar
  // é barato perto de uma cobrança falhar por token vencido.
  cacheToken[chave] = { token: j.accessToken, expiraEm: agora + 25 * 60 * 1000 }
  return j.accessToken
}

export type DadosLink = {
  valorCentavos: number
  descricao: string
  orderCode: string
  maxParcelas: number
  nomePaciente?: string
  emailPaciente?: string
  telefonePaciente?: string
  expiraEm?: Date
  redirectUrl?: string
  travarParcelas?: boolean
}

export async function criarLinkPagamento(cfg: SafraConfig, d: DadosLink) {
  const token = await autenticarSafra(cfg)
  const { gateway, portal } = basesSafra(cfg.ambiente)

  // v47.15 — Com repasse de taxa, o parcelamento vai TRAVADO (installmentNumber),
  // não como "até N vezes". Quem escolhe o parcelamento na página do Safra é o
  // paciente, e a taxa muda conforme a escolha: se a cobrança fosse calculada
  // para 2x e ele escolhesse 12x, a diferença sairia do caixa da clínica. Sem
  // repasse, o máximo volta a valer — aí a taxa é da clínica de qualquer forma
  // e dar liberdade de parcelamento só ajuda a fechar.
  const body: any = {
    amount: d.valorCentavos,
    description: d.descricao,
    orderCode: d.orderCode,
    paymentSupportedTypes: cfg.meios?.length ? cfg.meios : [1, 2],
  }
  if (d.travarParcelas) body.installmentNumber = d.maxParcelas
  else body.maxInstallmentNumber = d.maxParcelas
  if (d.expiraEm) body.expiration = d.expiraEm.toISOString()

  const { ok, status, json: j } = await chamarSafra(`${gateway}/v2/paymentlink`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(cfg.merchant_id ? { 'MerchantId': cfg.merchant_id } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!ok || !j?.success || !j?.smartCheckoutUrl) {
    const detalhe = j?.errors?.[0]?.message || `HTTP ${status}`
    const trace = j?.traceKey ? ` (traceKey ${j.traceKey})` : ''
    throw new ErroSafra(`Safrapay não criou o link: ${detalhe}${trace}`, status)
  }

  let url = `${portal}${j.smartCheckoutUrl}`
  if (d.redirectUrl) {
    url += (j.smartCheckoutUrl.includes('?') ? '&' : '?') + 'redirect_url=' + encodeURIComponent(d.redirectUrl)
  }
  return { id: String(j.id), url, traceKey: j.traceKey as string | undefined }
}

export async function consultarLink(cfg: SafraConfig, id: string) {
  const token = await autenticarSafra(cfg)
  const { gateway } = basesSafra(cfg.ambiente)
  const r = await fetch(`${gateway}/v2/smartcheckout/${id}?type=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  return await r.json().catch(() => ({}))
}

// ---------------------------------------------------------------------------
// Repasse da taxa do cartão
//
// A secretária digita quanto a clínica precisa RECEBER. A maquininha desconta a
// taxa do valor cobrado, então cobrar o mesmo valor deixaria a clínica com menos.
// O valor a cobrar é o líquido dividido por (1 - taxa), não o líquido mais a taxa
// — somar a taxa por cima é a conta errada, e deixa uma diferença a menos na
// conta da clínica.
//
//   líquido 1000,00 com taxa de 10%:
//     errado:  1000 + 10%  = 1100,00  →  recebe 990,00
//     certo:   1000 / 0,90 = 1111,11  →  recebe 1000,00
//
// As taxas são as do SEU contrato Safrapay, digitadas em Configurações. Repassar
// a taxa ao paciente é permitido no Brasil (Lei 13.455/2017), desde que a
// diferença de preço seja informada — e ela aparece na mensagem e na página.
// ---------------------------------------------------------------------------

export function tabelaDaBandeira(cfg: SafraConfig, bandeira: Bandeira): TabelaBandeira {
  return (cfg.taxas_bandeira?.[bandeira]) || TAXAS_BANDEIRA_PADRAO[bandeira]
}

export function taxaDaParcela(cfg: SafraConfig, bandeira: Bandeira, parcelas: number): number {
  const tabela = tabelaDaBandeira(cfg, bandeira)
  const credito = Number(tabela.parcelas?.[String(parcelas)])
  let t = Number.isFinite(credito) && credito >= 0 && credito < 100 ? credito : 0
  // À vista, o paciente ainda pode escolher débito na página — e o débito online
  // é mais caro que o crédito à vista. Se o débito está habilitado, o preço de 1x
  // usa a maior das duas taxas, senão a clínica recebe menos quando ele optar
  // por débito.
  if (parcelas === 1 && cfg.meios?.includes(1)) {
    const debito = Number(tabela.debito)
    if (Number.isFinite(debito) && debito > t) t = debito
  }
  return t
}

// Antecipação: o custo não é um percentual fixo, ele depende de quanto tempo o
// dinheiro seria esperado. Numa venda em N parcelas, a primeira chega em 1 mês e
// a última em N — o prazo médio é (N+1)/2. Antecipar tudo custa, então, a taxa
// mensal vezes esse prazo médio.
//
// É por isso que 12x pesa tanto: 1,97% ao mês sobre 6,5 meses dá quase 13%,
// muito acima da própria taxa do cartão.
export function prazoMedioMeses(parcelas: number): number {
  return (parcelas + 1) / 2
}

export function taxaEfetiva(cfg: SafraConfig, bandeira: Bandeira, parcelas: number): number {
  // À vista sem acréscimo: zero de verdade, e não "taxa do cartão zerada".
  // Zerar só o campo de 1x na tela não bastaria — a antecipação é somada por
  // cima e o paciente continuaria pagando 1,97% a mais sem ninguém perceber.
  if (parcelas === 1 && cfg.avista_sem_acrescimo) return 0

  const cartao = taxaDaParcela(cfg, bandeira, parcelas)
  if (!cfg.antecipa) return cartao
  const mensal = Number(cfg.taxa_antecipacao)
  if (!Number.isFinite(mensal) || mensal <= 0) return cartao
  return cartao + mensal * prazoMedioMeses(parcelas)
}

export function calcularBruto(liquidoCentavos: number, taxaPercent: number): number {
  if (!taxaPercent) return Math.round(liquidoCentavos)
  return Math.ceil(liquidoCentavos / (1 - taxaPercent / 100))
}

export type OpcaoParcela = {
  parcelas: number
  taxa: number
  totalCentavos: number
  parcelaCentavos: number
}

export function simularParcelas(liquidoCentavos: number, cfg: SafraConfig, bandeira: Bandeira): OpcaoParcela[] {
  const max = Math.min(Math.max(1, cfg.max_parcelas || 12), 12)
  const opcoes: OpcaoParcela[] = []
  for (let p = 1; p <= max; p++) {
    const taxa = cfg.repassar_taxa ? taxaEfetiva(cfg, bandeira, p) : 0
    const total = calcularBruto(liquidoCentavos, taxa)
    opcoes.push({ parcelas: p, taxa, totalCentavos: total, parcelaCentavos: Math.ceil(total / p) })
  }
  return opcoes
}
