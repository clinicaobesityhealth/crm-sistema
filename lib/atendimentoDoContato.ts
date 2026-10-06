// Quem está atendendo cada contato.
//
// v48.30 — Na lista de Contatos não havia como saber que um paciente já estava
// em atendimento, nem com quem. Descobria-se clicando: ou abrindo o cadastro,
// ou tentando abrir a conversa e recebendo o aviso de que outra pessoa já está
// nela. Isso é tarde demais — duas pessoas já responderam ao mesmo paciente
// antes de a tela avisar.
//
// A informação já existia no banco, espalhada em três lugares:
//
//   contacts.conversation_status  — se a conversa está aberta ou na fila
//   contacts.assigned_to          — quem assumiu
//   conversation_participants     — quem mais entrou junto
//
// Aqui elas viram uma coisa só, que a lista consegue mostrar numa linha.

export type SituacaoAtendimento = {
  estado: 'ativo' | 'fila'
  nomes: string[]
  setor: string | null
}

export function montarAtendimentos(
  contatos: { id: string; conversation_status?: string | null; assigned_to?: string | null; sector_id?: string | null }[],
  agentes: { id: string; name: string | null }[],
  participantes: { contact_id: string; agent_id: string }[],
  setores: { id: string; name: string | null }[] = [],
): Record<string, SituacaoAtendimento> {
  const nomeDoAgente = new Map(agentes.map(a => [a.id, (a.name || '').trim()]))
  const nomeDoSetor = new Map(setores.map(s => [s.id, (s.name || '').trim()]))

  const porContato = new Map<string, string[]>()
  for (const p of participantes) {
    const nome = nomeDoAgente.get(p.agent_id)
    if (!nome) continue
    const lista = porContato.get(p.contact_id) ?? []
    if (!lista.includes(nome)) lista.push(nome)
    porContato.set(p.contact_id, lista)
  }

  const saida: Record<string, SituacaoAtendimento> = {}
  for (const c of contatos) {
    const status = c.conversation_status || ''
    if (status !== 'active' && status !== 'pending') continue

    // Quem assumiu vem primeiro: é a pessoa responsável pela conversa. Os
    // demais entraram depois, e aparecem na ordem em que entraram.
    const nomes: string[] = []
    const dono = c.assigned_to ? nomeDoAgente.get(c.assigned_to) : ''
    if (dono) nomes.push(dono)
    for (const n of porContato.get(c.id) ?? []) if (!nomes.includes(n)) nomes.push(n)

    saida[c.id] = {
      estado: status === 'active' ? 'ativo' : 'fila',
      nomes,
      setor: c.sector_id ? (nomeDoSetor.get(c.sector_id) || null) : null,
    }
  }
  return saida
}

// O texto curto do selo. Com mais de dois nomes, o terceiro em diante vira
// "+N": a coluna é estreita, e a lista inteira fica no title, ao passar o mouse.
export function textoAtendimento(s: SituacaoAtendimento) {
  if (s.nomes.length === 0) {
    return s.estado === 'ativo' ? 'em atendimento' : 'na fila' + (s.setor ? ` · ${s.setor}` : '')
  }
  if (s.nomes.length <= 2) return s.nomes.join(', ')
  return `${s.nomes[0]}, ${s.nomes[1]} +${s.nomes.length - 2}`
}

export function tituloAtendimento(s: SituacaoAtendimento) {
  const quem = s.nomes.length ? s.nomes.join(', ') : 'ninguém assumiu ainda'
  const onde = s.setor ? ` · setor ${s.setor}` : ''
  return s.estado === 'ativo'
    ? `Em atendimento com ${quem}${onde}`
    : `Na fila, aguardando atendimento${onde} (${quem})`
}
