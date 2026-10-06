import { supabase, Contact, Agent } from '@/lib/supabase'
import { psidDoContato, ehSomenteInstagram } from '@/lib/instagram'

// Bloqueio e desbloqueio de contato, num lugar só.
//
// Antes esta regra existia em duas telas com códigos diferentes: o Atendimento
// bloqueava de um jeito e as Configurações desbloqueavam de outro. Duas cópias
// de uma regra de segurança é como uma delas fica para trás — e aí um contato
// aparece bloqueado numa tela e liberado na outra.
//
// Bloquear faz quatro coisas, e todas importam:
//   1. marca o contato, para mensagem nova não abrir atendimento
//   2. cala a assistente de IA, para ela não responder sozinha
//   3. encerra a conversa e solta o responsável
//   4. deixa registro de quem bloqueou e quando
//
// v48.34 — O bloqueio passou a ser POR CANAL.
//
// O caso que pediu isso: o paciente que é paciente no WhatsApp e virou problema
// no Instagram. Bloquear os dois resolve o Instagram e perde o paciente.
//
// Como fica guardado:
//   custom_fields.crm_blocked_canais = ['instagram']  -> só o Instagram
//   custom_fields.crm_blocked        = true            -> todos os canais
//
// O crm_blocked continua existindo, e continua verdadeiro quando TODOS os
// canais do contato estão bloqueados. É o que mantém de pé o que já lê essa
// marca — a tela de bloqueados, o painel e os fluxos do n8n — sem precisar
// mexer em tudo ao mesmo tempo.

export type CanalBloqueio = 'whatsapp' | 'instagram'

export const NOME_DO_CANAL: Record<CanalBloqueio, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
}

// Quais canais aquele contato realmente tem. Não adianta oferecer bloqueio de
// Instagram para quem só tem telefone: é escolha que não existe.
export function canaisDoContato(c: Partial<Contact> | null | undefined): CanalBloqueio[] {
  if (!c) return []
  const canais: CanalBloqueio[] = []
  if (!ehSomenteInstagram(c as Contact) && (c as any).phone) canais.push('whatsapp')
  if (psidDoContato(c as Contact)) canais.push('instagram')
  // Contato sem nenhum dos dois ainda pode ser bloqueado: trata-se como
  // WhatsApp, que é o caminho por onde quase tudo chega.
  return canais.length ? canais : ['whatsapp']
}

export function canaisBloqueados(c: Partial<Contact> | null | undefined): CanalBloqueio[] {
  const campos = (c as any)?.custom_fields || {}
  const achados = new Set<CanalBloqueio>()

  const lista = Array.isArray(campos.crm_blocked_canais) ? campos.crm_blocked_canais : null
  if (lista) lista.forEach((x: any) => { if (x === 'whatsapp' || x === 'instagram') achados.add(x) })

  // v48.40 — As mesmas informações também ficam guardadas como duas marcas
  // simples, porque lista dentro de JSON é difícil de ler no n8n e no banco.
  // Aqui elas são lidas juntas: se qualquer uma das formas diz que o canal
  // está bloqueado, ele está.
  if (campos.crm_blocked_whatsapp === true) achados.add('whatsapp')
  if (campos.crm_blocked_instagram === true) achados.add('instagram')

  if (achados.size) return Array.from(achados)
  // Bloqueio antigo, feito antes desta versão: valia para o contato inteiro.
  if (campos.crm_blocked === true) return canaisDoContato(c)
  return []
}

export function estaBloqueado(c: Partial<Contact> | null | undefined): boolean {
  return canaisBloqueados(c).length > 0
}

export function bloqueadoNoCanal(c: Partial<Contact> | null | undefined, canal: CanalBloqueio): boolean {
  return canaisBloqueados(c).includes(canal)
}

// Bloqueado em tudo o que ele tem — é quando a assistente pode ser calada e a
// conversa, encerrada.
export function bloqueadoPorCompleto(c: Partial<Contact> | null | undefined): boolean {
  const tem = canaisDoContato(c)
  const bloq = canaisBloqueados(c)
  return tem.length > 0 && tem.every(x => bloq.includes(x))
}

export function textoDosCanais(canais: CanalBloqueio[]) {
  return canais.map(x => NOME_DO_CANAL[x]).join(' e ')
}

export async function bloquearContato(contact: Contact, agent: Agent, canais?: CanalBloqueio[]) {
  const anterior = (contact.custom_fields || {}) as any
  const alvo = (canais && canais.length ? canais : canaisDoContato(contact))

  // Some o que já estava bloqueado antes: bloquear o Instagram de quem já tinha
  // o WhatsApp bloqueado não pode liberar o WhatsApp.
  const jaBloqueados = canaisBloqueados(contact)
  const todos = Array.from(new Set([...jaBloqueados, ...alvo])) as CanalBloqueio[]
  const completo = canaisDoContato(contact).every(x => todos.includes(x))

  const campos = {
    ...anterior,
    crm_blocked_canais: todos,
    // v48.40 — A mesma coisa em forma de marca simples, uma por canal. É o que
    // o fluxo do n8n consegue ler sem errar, e é o que faltava para a Sofia
    // ficar calada num bloqueio de um canal só.
    crm_blocked_whatsapp: todos.includes('whatsapp'),
    crm_blocked_instagram: todos.includes('instagram'),
    // Só vira bloqueio "inteiro" quando não sobrou canal livre.
    crm_blocked: completo,
    crm_blocked_at: new Date().toISOString(),
    crm_blocked_by: agent.id,
    crm_blocked_by_name: agent.name,
    // Guarda como a assistente estava antes. Sem isso, desbloquear deixaria a
    // IA calada para sempre num contato que ela atendia normalmente.
    crm_blocked_previous_sofia_never_respond:
      anterior.crm_blocked_previous_sofia_never_respond ?? (anterior.sofia_never_respond === true),
    // A mordaça da assistente é do contato inteiro — quem a lê é o fluxo do
    // n8n, que não sabe separar canal. Num bloqueio parcial ela continua
    // respondendo, que é justamente o que se quer no canal que ficou livre.
    sofia_never_respond: completo ? true : (anterior.sofia_never_respond === true),
  }

  const mudancas: any = {
    custom_fields: campos,
    updated_at: new Date().toISOString(),
  }
  // Conversa encerrada e atendente solto só quando o contato inteiro sai de
  // cena. Num bloqueio de um canal só, o atendimento pelo outro continua.
  if (completo) {
    mudancas.conversation_status = 'closed'
    mudancas.assigned_to = null
    mudancas.sofia_paused = true
  }

  const { error } = await supabase.from('contacts').update(mudancas).eq('id', contact.id)
  if (error) return { erro: error.message }

  if (completo) {
    await supabase.from('conversation_participants').delete().eq('contact_id', contact.id)
  }

  await supabase.from('messages').insert({
    contact_id: contact.id,
    channel: 'whatsapp',
    direction: 'outbound',
    content: `[INTERNO] 🚫 Bloqueado em ${textoDosCanais(alvo)} por ${agent.name}`,
    status: 'sent',
    sender_id: agent.id,
  })

  return { erro: null }
}

export async function desbloquearContato(contact: Contact, agent?: Agent | null, canais?: CanalBloqueio[]) {
  const campos = { ...((contact.custom_fields || {}) as any) }
  const iaEstavaCalada = campos.crm_blocked_previous_sofia_never_respond === true

  const bloqueadosAgora = canaisBloqueados(contact)
  const liberar = (canais && canais.length ? canais : bloqueadosAgora)
  const restantes = bloqueadosAgora.filter(x => !liberar.includes(x))

  if (restantes.length === 0) {
    delete campos.crm_blocked
    delete campos.crm_blocked_canais
    campos.crm_blocked_whatsapp = false
    campos.crm_blocked_instagram = false
    delete campos.crm_blocked_at
    delete campos.crm_blocked_by
    delete campos.crm_blocked_by_name
    delete campos.crm_blocked_previous_sofia_never_respond
    campos.sofia_never_respond = iaEstavaCalada
  } else {
    campos.crm_blocked_canais = restantes
    campos.crm_blocked_whatsapp = restantes.includes('whatsapp')
    campos.crm_blocked_instagram = restantes.includes('instagram')
    campos.crm_blocked = false
    campos.sofia_never_respond = iaEstavaCalada
  }

  const { error } = await supabase.from('contacts').update({
    custom_fields: campos,
    sofia_paused: iaEstavaCalada,
    conversation_status: 'closed',
    assigned_to: null,
    updated_at: new Date().toISOString(),
  }).eq('id', contact.id)

  if (error) return { erro: error.message }

  if (agent) {
    await supabase.from('messages').insert({
      contact_id: contact.id,
      channel: 'whatsapp',
      direction: 'outbound',
      content: `[INTERNO] ✅ Desbloqueado em ${textoDosCanais(liberar)} por ${agent.name}`,
      status: 'sent',
      sender_id: agent.id,
    })
  }

  return { erro: null }
}
