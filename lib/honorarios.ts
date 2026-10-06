import { moeda, reaisPorExtenso } from './extenso'

// A divisão de honorários das cartas.
//
// Conferida linha a linha contra o PREENCHER CARTAS.gs da planilha e contra um
// orçamento real: R$ 6.000,00 com cirurgião + 1 instrumentadora dá 11 partes,
// R$ 5.454,55 e R$ 545,45 — exatamente o que sai hoje.
//
// Os centavos do arredondamento não se perdem: a diferença é distribuída de um
// em um, começando pelo primeiro da lista, até fechar o total exato. Uma carta
// em que a soma das linhas não bate com o total é uma carta que o convênio
// devolve.

export const PARTES = {
  cirurgiao: 10,
  auxiliar1: 3,
  auxiliar2: 2,
  instrumentador: 1,
  anestesista: 6,
}

export type Membro = {
  papel: string          // "CIRURGIÃO", "1º AUXILIAR", "1º INSTRUMENTADOR(A)"...
  nome: string
  documento: string      // "CRM 109958", "CPF 279.285.848-67", "COREN 123456"
  partes: number
}

export type LinhaHonorario = Membro & {
  valor: number
  valorTexto: string
  valorExtenso: string
}

// Documento que identifica quem recebe: médico tem CRM, instrumentador tem
// COREN ou CPF. O convênio recusa a linha sem identificação, então a ordem
// aqui é a de quem costuma ter o quê.
export function documentoDoMembro(m: { crm?: string | null; coren?: string | null; cpf?: string | null }): string {
  const crm = (m.crm || '').trim()
  if (crm) return `CRM ${crm}`
  const coren = (m.coren || '').trim()
  if (coren) return `COREN ${coren}`
  const cpf = (m.cpf || '').trim()
  if (cpf) return `CPF ${cpf}`
  return ''
}

export function dividirHonorarios(total: number, membros: Membro[]): LinhaHonorario[] {
  const validos = membros.filter(m => m.partes > 0 && (m.nome || '').trim())
  const soma = validos.reduce((s, m) => s + m.partes, 0)
  const centavosTotal = Math.round((Number(total) || 0) * 100)
  if (!validos.length || soma <= 0 || centavosTotal <= 0) return []

  // Em centavos inteiros: dividir reais em ponto flutuante e arredondar no fim
  // é como nasce a carta que fecha em R$ 5.999,99.
  const brutos = validos.map(m => Math.floor((centavosTotal * m.partes) / soma))
  let sobra = centavosTotal - brutos.reduce((s, v) => s + v, 0)
  for (let i = 0; sobra > 0; i = (i + 1) % brutos.length) { brutos[i] += 1; sobra -= 1 }

  return validos.map((m, i) => {
    const valor = brutos[i] / 100
    return { ...m, valor, valorTexto: moeda(valor), valorExtenso: reaisPorExtenso(valor) }
  })
}

// O bloco como ele sai impresso.
export function textoDivisao(linhas: LinhaHonorario[]): string {
  if (!linhas.length) return ''
  return ['DIVISÃO DE HONORÁRIOS', ''].concat(
    linhas.map(l => `- ${l.papel}: ${l.nome}${l.documento ? ' - ' + l.documento : ''}\n  ${l.valorTexto} (${l.valorExtenso})`)
  ).join('\n')
}

// Quantos auxiliares e instrumentadores a equipe prevê, lido do texto que a
// clínica sempre escreveu ("2 AUXILIARES, 1 INSTRUMENTADOR, 1 ANESTESISTA").
export function lerComposicao(texto: string) {
  const t = (texto || '').toLowerCase()
  const doisAux = /\b(2|dois|duas)\s+auxiliar/.test(t)
  const doisInst = /\b(2|dois|duas)\s+instrumentador/.test(t)
  return {
    auxiliares: doisAux ? 2 : /auxiliar/.test(t) ? 1 : 0,
    instrumentadores: doisInst ? 2 : /instrumentador/.test(t) ? 1 : 0,
    anestesista: /anestesista/.test(t),
  }
}

export const PAPEIS_RGO = [
  { chave: 'cirurgiao',      rotulo: 'CIRURGIÃO',            partes: PARTES.cirurgiao },
  { chave: 'auxiliar1',      rotulo: '1º AUXILIAR',          partes: PARTES.auxiliar1 },
  { chave: 'auxiliar2',      rotulo: '2º AUXILIAR',          partes: PARTES.auxiliar2 },
  { chave: 'instrumentador1', rotulo: '1º INSTRUMENTADOR(A)', partes: PARTES.instrumentador },
  { chave: 'instrumentador2', rotulo: '2º INSTRUMENTADOR(A)', partes: PARTES.instrumentador },
  { chave: 'anestesista',    rotulo: 'ANESTESISTA',          partes: PARTES.anestesista },
] as const
