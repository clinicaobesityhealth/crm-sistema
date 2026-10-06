// v48.119 — Duas ou mais cirurgias no mesmo lançamento (ex.: BP + CCC, uma
// bariátrica com uma colecistectomia) costumam repetir item de material —
// trocarte, agulha de Veress — porque cada procedimento tem sua própria
// lista. Somar as listas duplicava o item na solicitação ao hospital. Jorge
// pediu para não somar: um de cada, por padrão, com a opção de manter as
// repetições quando for mesmo o caso (ex.: dois kits de fato diferentes que
// só coincidem no texto).
//
// Fica num arquivo só porque a mesma lógica é usada em três lugares: ao
// gerar a solicitação de cirurgia (app/api/cirurgias/[id]/documento/
// route.ts, o mais importante — é o documento que vai pro hospital), na
// edição da cirurgia pelo CRM (CirurgiaModal.tsx/ProcedimentosDaCirurgia.tsx)
// e no link do cirurgião (agendar-cirurgia/[token]/page.tsx). Sem depender de
// nada do servidor nem do navegador, dá para importar dos três.

export type ListaMaterial = { id: string; nome: string; itens: string; procedimento_id?: string | null }

export type ItemRepetido = {
  chave: string
  linha: string
  listas: { id: string; nome: string }[]
}

// Tira número/unidade da frente ("* 1 UNIDADE - ", "01 un - ", "2x ") e
// acento/caixa, para comparar só a DESCRIÇÃO do item. Duas linhas que dizem a
// mesma coisa com quantidade ou pontuação diferente ainda contam como
// repetidas; descrições diferentes nunca são fundidas — é só nisso que o
// dedup mexe.
export function normalizarItemMaterial(linha: string): string {
  return linha
    .trim()
    .replace(/^[*•]\s*/, '')
    .replace(/^-+\s*/, '')
    .replace(/^\d+\s*(unidades?|un\.?|x)?\s*[-–:]?\s*/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function linhasDaLista(l: ListaMaterial): string[] {
  return String(l.itens || '').split('\n').map(s => s.trim()).filter(Boolean)
}

// Quais itens aparecem em mais de uma das listas selecionadas — é o que vira
// o aviso "isso está repetido, quer manter as duas ou só uma?".
export function acharRepetidos(listas: ListaMaterial[]): ItemRepetido[] {
  const porChave = new Map<string, ItemRepetido>()
  for (const l of listas) {
    const vistosNestaLista = new Set<string>()
    for (const linha of linhasDaLista(l)) {
      const chave = normalizarItemMaterial(linha)
      // Duas linhas iguais dentro da MESMA lista não contam como repetição
      // entre cirurgias — é a própria lista que tem o item em dobro.
      if (!chave || vistosNestaLista.has(chave)) continue
      vistosNestaLista.add(chave)
      const atual = porChave.get(chave)
      if (atual) atual.listas.push({ id: l.id, nome: l.nome })
      else porChave.set(chave, { chave, linha, listas: [{ id: l.id, nome: l.nome }] })
    }
  }
  return Array.from(porChave.values()).filter(r => r.listas.length > 1)
}

// Monta o texto final dos materiais, uma linha por item. Por padrão, um item
// que se repete em mais de uma lista selecionada entra só uma vez (o pedido
// do Jorge). "manterTodasChaves" é a exceção: quando a pessoa decide manter
// as repetições daquele item mesmo assim, ele entra sem dedup, uma vez por
// lista em que aparece.
export function montarTextoMateriais(listas: ListaMaterial[], manterTodasChaves?: Set<string> | string[]): string {
  const manter = manterTodasChaves instanceof Set ? manterTodasChaves : new Set(manterTodasChaves || [])
  const linhasFinais: string[] = []
  const jaEntrou = new Set<string>()
  for (const l of listas) {
    for (const linha of linhasDaLista(l)) {
      const chave = normalizarItemMaterial(linha)
      if (chave && !manter.has(chave)) {
        if (jaEntrou.has(chave)) continue
        jaEntrou.add(chave)
      }
      linhasFinais.push(linha)
    }
  }
  return linhasFinais.join('\n')
}
