// Os alertas da agenda cirúrgica — os mesmos emojis da coluna ALERTAS da
// planilha, calculados aqui dentro.
//
// Ficam num arquivo próprio, com funções puras, porque são regras de prazo: a
// única forma de ter certeza de que "faltam 5 dias" está certo é conseguir
// testar a conta sem abrir a tela.

export type Alerta = { emoji: string; texto: string; tom: 'neutro' | 'atencao' | 'urgente' | 'ok' }

type CirurgiaParaAlerta = {
  status?: string | null
  categoria?: string | null
  carimbo_origem?: string | null
  created_at?: string | null
  data_solicitado_hospital?: string | null
  data_autorizacao?: string | null
  updated_at?: string | null
}

// O convênio tem 21 dias ÚTEIS para responder à solicitação. É prazo em dias
// úteis mesmo — contar dias corridos daria um alarme cedo demais, e ninguém
// confiaria nele depois da terceira vez.
export const PRAZO_DIAS_UTEIS = 21
const AVISO_DIAS_UTEIS = 5

export function diasUteisEntre(inicio: Date, fim: Date): number {
  if (fim < inicio) return -diasUteisEntre(fim, inicio)
  let dias = 0
  const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate())
  const alvo = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate())
  while (d < alvo) {
    d.setDate(d.getDate() + 1)
    const s = d.getDay()
    if (s !== 0 && s !== 6) dias++
  }
  return dias
}

function diasCorridos(inicio: Date, fim: Date) {
  return Math.floor((fim.getTime() - inicio.getTime()) / 86400000)
}

function paraData(v: string | null | undefined): Date | null {
  if (!v) return null
  // Data pura (aaaa-mm-dd) é lida ao meio-dia para não virar o dia anterior
  // por causa de fuso — erro clássico e silencioso em contagem de prazo.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00') : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function norm(s: string | null | undefined) {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
}

export function alertasDaCirurgia(c: CirurgiaParaAlerta, hoje: Date = new Date()) {
  const alertas: Alerta[] = []
  const s = norm(c.status)

  // Quando a cirurgia entrou no sistema. É a partir daqui que se conta há
  // quanto tempo o paciente está parado em pré-operatório.
  const desde = paraData(c.carimbo_origem) || paraData(c.created_at)

  // Quando a situação mudou pela última vez. Serve para "mais de 1 dia após
  // ser solicitado para agendar".
  const desdeMudanca = paraData(c.updated_at)

  const tachado = s === 'CIRURGIA REALIZADA'

  if (s === 'PRE-OPERATORIO') {
    const dias = desde ? diasCorridos(desde, hoje) : 0
    alertas.push(dias > 30
      ? { emoji: '⏰', texto: `Em pré-operatório há mais de 1 mês (${dias} dias)`, tom: 'atencao' }
      : { emoji: '😀', texto: `Em pré-operatório há ${dias} dia${dias === 1 ? '' : 's'}`, tom: 'neutro' })
  }

  if (s === 'AGENDAR') {
    const dias = desdeMudanca ? diasCorridos(desdeMudanca, hoje) : 0
    alertas.push(dias >= 1
      ? { emoji: '📞', texto: `Aguardando agendamento há ${dias} dia${dias === 1 ? '' : 's'} — ligar para o paciente`, tom: 'atencao' }
      : { emoji: '📅', texto: 'Para agendar', tom: 'neutro' })
  }

  if (s === 'AG. DOCUMENTOS' || s.startsWith('AG. DOCUMENT')) {
    alertas.push({ emoji: '📜', texto: 'Aguardando documentos', tom: 'atencao' })
  }

  if (s === 'PENDENCIA') {
    alertas.push({ emoji: '🚨', texto: 'Pendência não resolvida', tom: 'urgente' })
  }

  if (s === 'ENVIADO RELATORIO') {
    alertas.push({ emoji: '🕵🏼', texto: 'Relatório de pendência enviado', tom: 'neutro' })
  }

  if (s === 'INDECISO') {
    alertas.push({ emoji: '😶', texto: 'Paciente indeciso', tom: 'neutro' })
  }

  if (s === 'AUTORIZADA') {
    alertas.push({ emoji: '✔️', texto: 'Autorizada', tom: 'ok' })
  }

  if (s === 'CANCELADA' || s === 'NEGADA PELO CONVENIO') {
    alertas.push({ emoji: '❌', texto: s === 'CANCELADA' ? 'Cancelada' : 'Negada pelo convênio', tom: 'urgente' })
  }

  // --- o relógio dos 21 dias úteis ------------------------------------------
  // Vale enquanto a cirurgia está esperando resposta. Depois de autorizada,
  // negada, realizada ou cancelada, o prazo não corre mais.
  const esperandoResposta = ['SOLICITADO AO HOSPITAL', 'SOLICITADO AO CONVENIO', 'PENDENCIA', 'ENVIADO RELATORIO'].includes(s)
  const base = paraData(c.data_solicitado_hospital)

  if (esperandoResposta && base && !c.data_autorizacao) {
    const corridos = diasUteisEntre(base, hoje)
    const restam = PRAZO_DIAS_UTEIS - corridos
    if (restam < 0) {
      alertas.push({ emoji: '⌛', texto: `Ultrapassou os 21 dias úteis (${Math.abs(restam)} a mais)`, tom: 'urgente' })
    } else if (restam <= AVISO_DIAS_UTEIS) {
      alertas.push(restam === 0
        ? { emoji: '⚠️', texto: 'Último dia do prazo de 21 dias úteis', tom: 'urgente' }
        : { emoji: '⚠️', texto: `Faltam ${restam} ${restam === 1 ? 'dia útil' : 'dias úteis'} para expirar o prazo de 21 dias úteis`, tom: 'atencao' })
    }
  }

  return { alertas, tachado }
}
