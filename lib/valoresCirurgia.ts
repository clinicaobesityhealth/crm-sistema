// Cálculo dos valores de uma cirurgia.
//
// Fica fora da tela de propósito: a mesma conta vai ser usada pela
// sincronização com a planilha e pela geração das cartas. Regra escrita em um
// lugar só é regra que não diverge.
//
// A conta, como a clínica faz hoje:
//
//   cobrado (o orçamento) = valor da equipe
//                         + valor do anestesista, se houver anestesista na
//                           equipe e ele não for cobrar direto do paciente
//                         + ajuste
//
//   prévia = cobrado + percentual da modalidade (30% no particular com
//            convênio; zero onde não há reembolso)

export type EntradaValores = {
  valorEquipe: number
  valorAnestesista: number
  temAnestesista: boolean
  anestesistaCobraDireto: boolean
  ajuste: number
}

export function calcularCobrado(e: EntradaValores): number {
  const anestesista = e.temAnestesista && !e.anestesistaCobraDireto ? (e.valorAnestesista || 0) : 0
  const total = (e.valorEquipe || 0) + anestesista + (e.ajuste || 0)
  return arredondar(total)
}

// Devolve null quando a modalidade não tem prévia — e null aqui quer dizer
// "não se aplica", que é diferente de zero. O campo fica vazio na tela em vez
// de mostrar R$ 0,00, que pareceria valor combinado.
export function calcularPrevia(cobrado: number | null, percentual: number): number | null {
  if (cobrado === null || !Number.isFinite(cobrado)) return null
  if (!percentual) return null
  return arredondar(cobrado * (1 + percentual / 100))
}

// Duas casas, para não aparecer centavo de arredondamento de ponto flutuante
// num valor que vai para o orçamento do paciente.
function arredondar(v: number) {
  return Math.round(v * 100) / 100
}

// Texto da composição da equipe no formato que a planilha e as cartas usam:
// "2 AUXILIARES, 1 INSTRUMENTADOR".
export function textoEquipe(auxiliares: number, instrumentadores: number, temAnestesista: boolean) {
  const partes: string[] = []
  if (auxiliares > 0) partes.push(`${auxiliares} ${auxiliares === 1 ? 'AUXILIAR' : 'AUXILIARES'}`)
  if (instrumentadores > 0) partes.push(`${instrumentadores} ${instrumentadores === 1 ? 'INSTRUMENTADOR' : 'INSTRUMENTADORES'}`)
  if (temAnestesista) partes.push('1 ANESTESISTA')
  return partes.join(', ')
}
