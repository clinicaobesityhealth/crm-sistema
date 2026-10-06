// Os procedimentos de uma cirurgia.
//
// Uma cirurgia raramente é uma só. "BP, HH, BX HEPÁTICA" numa célula da
// planilha é um lançamento com três procedimentos — e até a v48.24 o CRM
// guardava só o primeiro que reconhecia, com dois efeitos ruins: o valor saía
// pela metade e a guia saía incompleta.
//
// Aqui ficam as regras de composição, fora da tela, porque a mesma conta é
// usada pela sincronização com a planilha e pelas cartas.

export type ItemCirurgia = {
  id?: string
  procedimento_id: string | null
  sigla: string
  nome: string
  // O valor CHEIO daquele procedimento, como está na tabela — ou o combinado,
  // quando digitado à mão. A regra das conjugadas é aplicada na hora da conta,
  // não aqui: guardar o valor já reduzido esconderia de onde ele veio e
  // atrapalharia o rateio de honorários.
  valor_equipe: number
  valor_anestesista: number
  // Ligado quando alguém digita o valor à mão naquele item. O segundo
  // procedimento costuma ser cobrado por menos, e essa combinação é acordo, não
  // tabela — recalcular por cima dela seria apagar o acordo.
  valor_manual: boolean
  via_acesso: string
}

export const ITEM_VAZIO: ItemCirurgia = {
  procedimento_id: null, sigla: '', nome: '',
  valor_equipe: 0, valor_anestesista: 0, valor_manual: false, via_acesso: '',
}

// A planilha sempre escreveu as siglas separadas por vírgula na coluna I, e a
// contabilidade lê essa coluna. Mantemos o formato.
export function siglasCombinadas(itens: ItemCirurgia[]) {
  return itens.map(i => (i.sigla || '').trim()).filter(Boolean).join(', ')
}

// No nome completo o separador é " + ": vírgula dentro de nome de cirurgia é
// comum ("Herniorrafia inguinal - unilateral, com tela") e a leitura embaralha.
export function nomesCombinados(itens: ItemCirurgia[]) {
  return itens.map(i => (i.nome || '').trim()).filter(Boolean).join(' + ')
}

// Soma simples dos valores de equipe, sem a regra das conjugadas. Serve para
// mostrar a tabela na tela e para o rateio de honorários, não para o cobrado.
export function totalEquipe(itens: ItemCirurgia[]) {
  return arredondar(itens.reduce((s, i) => s + (Number(i.valor_equipe) || 0), 0))
}

// v48.32 — A regra da clínica para cirurgia conjugada, conferida linha a linha
// contra o VALORES.gs da planilha, que é o que gera os valores das cartas hoje.
//
//   para cada procedimento:
//       base = valor da equipe
//            + valor do anestesista DAQUELE procedimento, quando há anestesista
//
//   cobrado = a maior base, inteira
//           + metade de cada uma das outras
//
// Exemplo: CCC (6.000 + 2.000 de anestesista) com HU (4.000 + 1.500):
//   bases 8.000 e 5.500  ->  8.000 + 2.750 = 10.750
//
// A ordem importa aqui: o anestesista entra ANTES da divisão pela metade, e não
// depois. Somá-lo uma vez no fim — como esta função fazia na v48.29 — dá 10.000
// no mesmo caso, e a carta sairia com 750 reais a menos.
//
// Linha com valor digitado à mão continua fora da redução: o que foi combinado
// é o que vale.
export const PERCENTUAL_PROCEDIMENTO_ADICIONAL = 50

export type OpcoesAnestesista = {
  temAnestesista: boolean
  anestesistaCobraDireto: boolean
}

// O que cada procedimento vale antes da regra: equipe + anestesista dele.
export function baseDoItem(i: ItemCirurgia, o: OpcoesAnestesista) {
  const anestesista = o.temAnestesista && !o.anestesistaCobraDireto ? (Number(i.valor_anestesista) || 0) : 0
  return arredondar((Number(i.valor_equipe) || 0) + anestesista)
}

// Aplica a regra sobre as bases: a maior inteira, as outras pela metade.
export function valoresConjugados(bases: number[], manuais: boolean[] = []): number[] {
  const n = bases.map(v => Number(v) || 0)
  if (n.length <= 1) return n.map(arredondar)

  // O maior de todos — inclusive de uma linha digitada à mão, que pode
  // perfeitamente ser o procedimento principal.
  let maior = 0
  n.forEach((v, i) => { if (v > n[maior]) maior = i })

  return n.map((v, i) => {
    if (i === maior || manuais[i]) return arredondar(v)
    return arredondar(v * PERCENTUAL_PROCEDIMENTO_ADICIONAL / 100)
  })
}

// A conta inteira de um lançamento, do jeito que a planilha faz.
export function calcularConjugadas(itens: ItemCirurgia[], o: OpcoesAnestesista) {
  const bases = itens.map(i => baseDoItem(i, o))
  const entram = valoresConjugados(bases, itens.map(i => !!i.valor_manual))
  return {
    bases,
    entram,
    total: arredondar(entram.reduce((s, v) => s + v, 0)),
  }
}

// O anestesista, não: ele anestesia uma vez, por mais que se opere no mesmo
// ato. Entra pelo MAIOR valor entre os procedimentos — e não pelo primeiro da
// lista, porque a ordem em que a secretária digitou não deveria mudar o preço.
export function totalAnestesista(itens: ItemCirurgia[]) {
  return arredondar(itens.reduce((m, i) => Math.max(m, Number(i.valor_anestesista) || 0), 0))
}

// A via da cirurgia é a do procedimento principal — o primeiro da lista, que é
// o que dá o nome ao ato. Serve de sugestão: o campo continua editável.
export function viaPrincipal(itens: ItemCirurgia[]) {
  return itens.find(i => (i.via_acesso || '').trim())?.via_acesso || ''
}

// Quebra o texto da coluna CIRURGIA da planilha em siglas. Aceita vírgula,
// ponto e vírgula, barra e "+", que é como as pessoas escreveram ao longo dos
// anos, sem combinar entre si.
export function separarSiglas(texto: string): string[] {
  return String(texto || '')
    .split(/[,;+/]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function arredondar(v: number) {
  return Math.round(v * 100) / 100
}
