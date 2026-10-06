import { supabase } from '@/lib/supabase'

// De onde vem o valor de uma cirurgia.
//
// A busca vai do mais específico para o mais geral, e para no primeiro que
// encontra:
//
//   1. preço daquele procedimento naquele convênio E naquele plano
//   2. preço daquele procedimento naquele convênio (qualquer plano)
//   3. preço particular — o que está no cadastro do procedimento
//
// Essa ordem é o que permite cadastrar pouco: o convênio inteiro com um preço,
// e só a exceção de um plano. Sem ela, seria preciso repetir o mesmo valor em
// todos os planos de um convênio.

export type Preco = {
  valorEquipe: number
  valorAnestesista: number
  origem: 'plano' | 'convenio' | 'particular'
  rotulo: string
}

export async function buscarPreco(
  procedimentoId: string | null,
  convenioId: string | null,
  planoId: string | null,
): Promise<Preco | null> {
  if (!procedimentoId) return null

  const { data: proc } = await supabase
    .from('cirurgia_procedimentos')
    .select('valor_equipe, valor_anestesista')
    .eq('id', procedimentoId).single()

  const particular: Preco = {
    valorEquipe: Number(proc?.valor_equipe ?? 0),
    valorAnestesista: Number(proc?.valor_anestesista ?? 0),
    origem: 'particular',
    rotulo: 'tabela particular',
  }

  if (!convenioId) return particular

  const { data: precos } = await supabase
    .from('cirurgia_precos')
    .select('plano_id, valor_equipe, valor_anestesista')
    .eq('procedimento_id', procedimentoId)
    .eq('convenio_id', convenioId)

  const lista = precos ?? []

  const doPlano = planoId ? lista.find(p => p.plano_id === planoId) : null
  if (doPlano) {
    return {
      valorEquipe: Number(doPlano.valor_equipe),
      valorAnestesista: Number(doPlano.valor_anestesista),
      origem: 'plano',
      rotulo: 'tabela do plano',
    }
  }

  const doConvenio = lista.find(p => !p.plano_id)
  if (doConvenio) {
    return {
      valorEquipe: Number(doConvenio.valor_equipe),
      valorAnestesista: Number(doConvenio.valor_anestesista),
      origem: 'convenio',
      rotulo: 'tabela do convênio',
    }
  }

  // Convênio escolhido mas sem preço cadastrado para esta cirurgia. Cair no
  // particular em silêncio seria pior do que avisar: o valor sairia certo por
  // acaso, ou muito errado sem ninguém entender por quê.
  return { ...particular, rotulo: 'tabela particular (sem preço cadastrado para este convênio)' }
}
