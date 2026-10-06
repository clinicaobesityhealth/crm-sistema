import { supabase } from '@/lib/supabase'

// v48.166 — Algumas tabelas (agendamentos, cirurgias) guardam uma CÓPIA do
// nome do paciente, feita no momento em que o registro foi criado/vinculado
// ao cadastro. Se o cadastro for corrigido depois (ex: sobrenome errado), essa
// cópia não atualiza sozinha. Caso real: Bruna Puggina teve o cadastro
// corrigido, mas a Agenda Médica e a Agenda Cirúrgica continuaram mostrando
// "Bruna Polidoro", porque o nome só tinha sido copiado na hora da vinculação.
//
// Esta função busca o nome ATUAL do contato vinculado (contact_id) e
// sobrescreve a cópia antiga só na hora de exibir — não altera nada no banco,
// então não tem risco de sobrescrever um nome digitado à mão num registro sem
// vínculo (contact_id nulo).
export async function comNomeAtualDoContato<T extends { contact_id?: string | null; paciente_nome: string }>(
  lista: T[]
): Promise<T[]> {
  const ids = Array.from(new Set(lista.map(item => item.contact_id).filter((id): id is string => !!id)))
  if (ids.length === 0) return lista
  try {
    const { data } = await supabase.from('contacts').select('id, full_name').in('id', ids)
    if (!data || data.length === 0) return lista
    const nomePorId = new Map<string, string>(data.map((c: any) => [c.id, c.full_name]))
    return lista.map(item => {
      const nomeAtual = item.contact_id ? nomePorId.get(item.contact_id) : undefined
      return nomeAtual && nomeAtual !== item.paciente_nome ? { ...item, paciente_nome: nomeAtual } : item
    })
  } catch {
    return lista
  }
}
