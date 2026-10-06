// Valor por extenso, em português.
//
// Está nas cartas porque convênio pede: "R$ 6.000,00 (seis mil reais)". Um
// número sozinho pode ser alterado com uma canetada; escrito por extenso, não.
//
// Sem biblioteca de propósito: são duas dezenas de palavras e três regras, e a
// dependência custaria mais para manter do que o próprio código.

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
const DEZ_A_DEZENOVE = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']

function ate999(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'
  const c = Math.floor(n / 100), d = Math.floor((n % 100) / 10), u = n % 10
  const partes: string[] = []
  if (c) partes.push(CENTENAS[c])
  if (d === 1) partes.push(DEZ_A_DEZENOVE[u])
  else {
    if (d) partes.push(DEZENAS[d])
    if (u) partes.push(UNIDADES[u])
  }
  return partes.join(' e ')
}

// Cada grupo de três dígitos vira "<número> <escala>". O plural da escala só
// aparece acima de mil: "um milhão", "dois milhões".
const ESCALAS: [string, string][] = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']]

export function porExtenso(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'zero'

  const grupos: number[] = []
  let resto = n
  while (resto > 0) { grupos.push(resto % 1000); resto = Math.floor(resto / 1000) }

  const partes: string[] = []
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i]
    if (!g) continue
    // "mil" não leva "um" na frente: mil reais, não um mil reais.
    const texto = i === 1 && g === 1 ? '' : ate999(g)
    const escala = ESCALAS[i] ? (g === 1 ? ESCALAS[i][0] : ESCALAS[i][1]) : ''
    partes.push([texto, escala].filter(Boolean).join(' '))
  }

  // "e" antes do último grupo quando ele é pequeno ou redondo, como se fala:
  // "mil e duzentos", "dois mil e quinze" — mas "mil duzentos e trinta".
  const ultimo = grupos[0]
  if (partes.length > 1 && ultimo > 0 && (ultimo < 100 || ultimo % 100 === 0)) {
    const fim = partes.pop()!
    return partes.join(', ') + ' e ' + fim
  }
  return partes.join(partes.length > 2 ? ', ' : ' ')
}

// "seis mil reais", "quinhentos e quarenta e cinco reais e quarenta e cinco
// centavos" — o formato que as cartas usam hoje.
export function reaisPorExtenso(valor: number): string {
  const v = Math.round(Math.abs(Number(valor) || 0) * 100)
  const inteiros = Math.floor(v / 100)
  const centavos = v % 100

  const partes: string[] = []
  if (inteiros > 0) partes.push(`${porExtenso(inteiros)} ${inteiros === 1 ? 'real' : 'reais'}`)
  if (centavos > 0) partes.push(`${porExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`)
  if (!partes.length) return 'zero real'
  return partes.join(' e ')
}

export function moeda(valor: number): string {
  return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
