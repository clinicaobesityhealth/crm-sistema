import type { Contact } from '@/lib/supabase'

// O identificador de um contato do Instagram — o PSID.
//
// Ele aparece em três lugares diferentes, conforme a época e o caminho por onde
// a conversa entrou: dentro do telefone como "ig:<psid>", em
// custom_fields.instagram_psid ou em custom_fields.ig_sender_psid. Procurar nos
// três aqui, num lugar só, evita que cada tela descubra o contato de um jeito.

export function psidDoContato(c: Partial<Contact> | null | undefined): string | null {
  if (!c) return null
  const cf = (c as any).custom_fields || {}
  const doTelefone = typeof c.phone === 'string' && c.phone.startsWith('ig:')
    ? c.phone.slice(3)
    : null
  const psid = doTelefone || cf.instagram_psid || cf.ig_sender_psid || null
  const s = psid ? String(psid).trim() : ''
  return s || null
}

// Contato que só existe no Instagram: chegou por lá e ainda não tem WhatsApp.
// É deste que o PSID precisa ficar visível, porque é ele que vai ser unido a
// um cadastro de WhatsApp.
export function ehSomenteInstagram(c: Partial<Contact> | null | undefined): boolean {
  if (!c) return false
  const cf = (c as any).custom_fields || {}
  return cf.channel === 'instagram' && typeof c.phone === 'string' && c.phone.startsWith('ig:')
}

// v48.45 — Uma pessoa pode ter mais de um Instagram no mesmo cadastro.
//
// A clínica tem duas contas: @drjoaojorge e @clinicaobesityhealth. Quando a
// mesma paciente escreve para as duas, o Instagram dá a ela um identificador
// DIFERENTE em cada uma — para a Meta são dois números para a mesma pessoa.
// Por isso o CRM abria dois cadastros: não era erro de leitura, faltava lugar
// para guardar os dois.
//
// A lista mora em custom_fields.instagram_contas, uma entrada por conta:
//   [{ psid, conta, vinculado_em }]
// As formas antigas continuam valendo e entram na mesma leitura.

export type ContaInstagramDoContato = { psid: string; conta: string; vinculado_em?: string }

export function contasInstagramDoContato(c: Partial<Contact> | null | undefined): ContaInstagramDoContato[] {
  if (!c) return []
  const cf = (c as any).custom_fields || {}
  const saida: ContaInstagramDoContato[] = []
  const jaTem = (p: string) => saida.some(x => x.psid === p)

  const lista = Array.isArray(cf.instagram_contas) ? cf.instagram_contas : []
  for (const item of lista) {
    const psid = String(item?.psid || '').trim()
    if (psid && !jaTem(psid)) {
      saida.push({ psid, conta: String(item?.conta || '').trim(), vinculado_em: item?.vinculado_em })
    }
  }

  // O identificador "solto", de antes desta versão.
  const antigo = psidDoContato(c)
  if (antigo && !jaTem(antigo)) {
    saida.push({ psid: antigo, conta: String(cf.ig_account_name || '').trim() })
  }

  return saida
}

export function psidsDoContato(c: Partial<Contact> | null | undefined): string[] {
  return contasInstagramDoContato(c).map(x => x.psid)
}

// Este cadastro já foi unido a outro? Serve para a tela não oferecer de novo o
// que já foi feito, e para explicar por que ele está quieto.
export function unidoPara(c: Partial<Contact> | null | undefined): string | null {
  const v = (c as any)?.custom_fields?.crm_unido_para
  return v ? String(v) : null
}
