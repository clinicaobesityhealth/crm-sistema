import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// Escreve o texto de uma carta por cima da folha timbrada do médico.
//
// A folha inteira entra como FUNDO da página, em vez de o programa desenhar
// cabeçalho e rodapé: a marca d'água, a faixa lateral e o espaçamento exato do
// papel impresso nunca saem iguais quando remontados por código. As margens
// dizem até onde o texto pode ir sem cobrir o que já está impresso.
//
// Quem não tem folha cadastrada recebe uma página em branco com as mesmas
// margens — a carta sai, e sai legível, em vez de não sair.

const MM = 72 / 25.4           // milímetro em pontos de PDF
const A4 = { largura: 595.28, altura: 841.89 }

export type Margens = { topo: number; base: number; esquerda: number; direita: number }

export async function montarPdfTimbrado(opcoes: {
  titulo: string
  texto: string
  papelUrl: string | null
  margens: Margens
}): Promise<Uint8Array> {
  const { titulo, texto, papelUrl, margens } = opcoes
  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)

  let fundo: any = null
  if (papelUrl) {
    try {
      const resposta = await fetch(papelUrl)
      if (resposta.ok) {
        const bytes = new Uint8Array(await resposta.arrayBuffer())
        const tipo = (resposta.headers.get('content-type') || '').toLowerCase()
        fundo = tipo.includes('png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
      }
    } catch {
      // Folha fora do ar não impede a carta: segue sem o fundo.
    }
  }

  const esquerda = margens.esquerda * MM
  const direita = A4.largura - margens.direita * MM
  const larguraUtil = direita - esquerda
  const topo = A4.altura - margens.topo * MM
  const base = margens.base * MM

  let pagina = pdf.addPage([A4.largura, A4.altura])
  if (fundo) pagina.drawImage(fundo, { x: 0, y: 0, width: A4.largura, height: A4.altura })
  let y = topo

  const novaPagina = () => {
    pagina = pdf.addPage([A4.largura, A4.altura])
    if (fundo) pagina.drawImage(fundo, { x: 0, y: 0, width: A4.largura, height: A4.altura })
    y = topo
  }

  // As fontes padrão do PDF só conhecem Latin-1. Acento do português passa;
  // travessão, aspas curvas e emoji, não — e um caractere fora da tabela
  // derruba a geração inteira. Trocar é mais útil do que falhar.
  const limpar = (s: string) => String(s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '')

  const escrever = (linha: string, fonte: any, tamanho: number, espaco: number) => {
    if (y - espaco < base) novaPagina()
    pagina.drawText(limpar(linha), { x: esquerda, y: y - tamanho, size: tamanho, font: fonte, color: rgb(0.1, 0.12, 0.15) })
    y -= espaco
  }

  // Quebra por largura real da fonte, não por número de caracteres: com
  // Helvetica, "MMMM" ocupa o dobro de "iiii".
  const quebrar = (linha: string, fonte: any, tamanho: number) => {
    const palavras = limpar(linha).split(/\s+/)
    const saida: string[] = []
    let atual = ''
    for (const p of palavras) {
      const teste = atual ? atual + ' ' + p : p
      if (fonte.widthOfTextAtSize(teste, tamanho) <= larguraUtil) atual = teste
      else { if (atual) saida.push(atual); atual = p }
    }
    if (atual) saida.push(atual)
    return saida.length ? saida : ['']
  }

  // Título centralizado, em negrito.
  const tamTitulo = 13
  const larguraTitulo = negrito.widthOfTextAtSize(limpar(titulo), tamTitulo)
  pagina.drawText(limpar(titulo), {
    x: esquerda + Math.max(0, (larguraUtil - larguraTitulo) / 2),
    y: y - tamTitulo, size: tamTitulo, font: negrito, color: rgb(0.1, 0.12, 0.15),
  })
  y -= tamTitulo + 14

  const TAM = 10.5
  const ALTURA_LINHA = 14.5

  for (const brutaOriginal of String(texto).split('\n')) {
    if (!brutaOriginal.trim()) { y -= ALTURA_LINHA * 0.6; if (y < base) novaPagina(); continue }

    // v48.105 — um \t no início marca "isto é conteúdo de lista de
    // procedimento/diagnóstico" (posto em route.ts): nunca deve entrar em
    // negrito, seja qual for o tamanho ou a capitalização da linha, e sai um
    // pouco menor para caber nomes compridos sem quebrar tanto. Sem essa
    // marca explícita, a regra abaixo (maiúscula + curta = título) também
    // pegava essas linhas — já que procedimento/diagnóstico são gravados em
    // maiúsculas — e uma cirurgia saía em negrito e outra não, só por causa
    // do tamanho do nome.
    const ehConteudoLista = brutaOriginal.startsWith('\t')
    const bruta = ehConteudoLista ? brutaOriginal.slice(1) : brutaOriginal

    // Linha inteira em maiúsculas e curta é cabeçalho de bloco ("HONORÁRIOS",
    // "DIVISÃO DE HONORÁRIOS"): sai em negrito, como na carta da planilha.
    const semAcento = bruta.normalize('NFD').replace(/[̀-ͯ]/g, '')
    const ehTituloMaiusculo = bruta.trim().length < 60 && semAcento === semAcento.toUpperCase() && /[A-Z]/.test(semAcento)
    // Rótulo de seção do modelo ("Procedimento(s):", "Diagnóstico(s):"): não
    // é maiúsculo, mas é o título da lista que vem embaixo — também negrito.
    const ehRotulo = /:\s*$/.test(bruta.trim()) && bruta.trim().length < 40
    const ehTitulo = !ehConteudoLista && (ehTituloMaiusculo || ehRotulo)

    const fonte = ehTitulo ? negrito : normal
    const tamanho = ehConteudoLista ? TAM - 0.75 : TAM
    // A indentação das linhas da divisão ("  R$ ...") é significativa.
    const recuo = bruta.match(/^\s+/)?.[0] || ''
    for (const parte of quebrar(bruta, fonte, tamanho)) escrever(recuo + parte, fonte, tamanho, ALTURA_LINHA)
  }

  return pdf.save()
}
