'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { supabase } from '@/lib/supabase'
import { Cake, CheckCircle2, Image as ImageIcon, Loader2, MessageSquare, RefreshCw, X } from 'lucide-react'

type BirthdayContact = { id: string; full_name: string; phone: string | null; avatar_url: string | null; custom_fields: any; sent?: boolean; media_url?: string | null; sent_at?: string | null }

function saoPauloParts() {
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date())
  const value = (type: string) => parts.find(p => p.type === type)?.value || ''
  return { day: value('day'), month: value('month'), year: value('year') }
}

function birthDate(contact: BirthdayContact) {
  const fields = contact.custom_fields || {}
  return fields?.dados_medx?.nascimento || fields?.nascimento || fields?.data_nascimento || null
}

export default function BirthdaysPage() {
  const router = useRouter()
  const [contacts, setContacts] = useState<BirthdayContact[]>([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null)

  async function load() {
    setLoading(true)
    const today = saoPauloParts()
    const { data: rows } = await supabase.from('contacts').select('id,full_name,phone,avatar_url,custom_fields').order('full_name')
    const allContacts = (rows || []) as BirthdayContact[]
    const birthdays = allContacts.filter(contact => {
      const raw = birthDate(contact)
      if (!raw) return false
      const normalized = String(raw).slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized.slice(5, 7) === today.month && normalized.slice(8, 10) === today.day
      const match = String(raw).match(/^(\d{1,2})\/(\d{1,2})/)
      return !!match && match[1].padStart(2, '0') === today.day && match[2].padStart(2, '0') === today.month
    })
    const start = new Date(`${today.year}-${today.month}-${today.day}T00:00:00-03:00`).toISOString()
    const end = new Date(`${today.year}-${today.month}-${today.day}T23:59:59.999-03:00`).toISOString()
    const { data: messages } = await supabase.from('messages').select('contact_id,media_url,created_at,send_via').eq('send_via', 'birthday_flow').gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false })
    const sent = new Map<string, any>()
    for (const message of messages || []) if (!sent.has(message.contact_id)) sent.set(message.contact_id, message)
    // O próprio fluxo de aniversário é uma fonte válida: mesmo que o contato
    // ainda não tenha nascimento no custom_fields, o cartão enviado hoje o inclui.
    const knownIds = new Set(birthdays.map(c => c.id))
    for (const contactId of sent.keys()) {
      if (!knownIds.has(contactId)) {
        const contact = allContacts.find(c => c.id === contactId)
        if (contact) { birthdays.push(contact); knownIds.add(contactId) }
      }
    }
    birthdays.forEach(c => { const message = sent.get(c.id); c.sent = !!message; c.media_url = message?.media_url; c.sent_at = message?.created_at })
    setContacts(birthdays)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function openConversation(contact: BirthdayContact) {
    setOpening(contact.id)
    await supabase.from('contacts').update({ conversation_status: 'active', updated_at: new Date().toISOString() }).eq('id', contact.id)
    router.push(`/inbox?contact=${contact.id}`)
  }

  return <div className="flex h-screen bg-surface overflow-hidden"><Sidebar/><main className="flex-1 overflow-y-auto">
    <header className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between"><div><h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><Cake size={20} className="text-pink-500"/> Aniversariantes do dia</h1><p className="text-xs text-slate-400 mt-0.5">Cartões enviados aparecem aqui sem iniciar uma conversa</p></div><button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Atualizar"><RefreshCw size={16}/></button></header>
    <div className="max-w-4xl p-6">
      {loading ? <div className="h-48 flex items-center justify-center text-slate-400 text-sm"><Loader2 size={17} className="animate-spin mr-2"/> Carregando aniversariantes...</div> : contacts.length === 0 ? <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center"><Cake size={38} className="mx-auto text-slate-300"/><h2 className="text-base font-medium text-slate-700 mt-4">Nenhum aniversariante hoje</h2><p className="text-sm text-slate-400 mt-1">A lista usa a data de nascimento cadastrada no paciente.</p></div> : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{contacts.map(contact => <article key={contact.id} className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        {contact.media_url ? <button type="button" onClick={() => setLightbox({ url: contact.media_url as string, name: contact.full_name })} className="w-full aspect-[9/16] max-h-40 bg-slate-100 flex items-center justify-center cursor-zoom-in" title="Ver cartão inteiro"><img src={contact.media_url} alt={`Cartão de ${contact.full_name}`} className="w-full h-full object-contain"/></button> : <div className="aspect-[9/16] max-h-40 bg-gradient-to-br from-pink-50 to-amber-50 flex items-center justify-center"><ImageIcon size={26} className="text-pink-300"/></div>}
        <div className="p-3"><div className="flex items-start gap-2"><div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs flex-shrink-0">{contact.full_name?.charAt(0).toUpperCase()}</div><div className="flex-1 min-w-0"><h2 className="text-xs font-semibold text-slate-800 truncate">{contact.full_name}</h2><p className="text-[11px] text-slate-400 truncate">{contact.phone || 'Telefone não informado'}</p></div></div>
        <div className="mt-2">{contact.sent ? <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full"><CheckCircle2 size={10}/> Enviado</span> : <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">Aguardando</span>}</div>
        <button onClick={() => openConversation(contact)} disabled={opening === contact.id} className="w-full mt-3 py-2 rounded-xl border border-brand-200 text-brand-700 hover:bg-brand-50 text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-60">{opening === contact.id ? <Loader2 size={13} className="animate-spin"/> : <MessageSquare size={13}/>} Iniciar conversa</button></div>
      </article>)}</div>}
    </div>
    {lightbox && <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
      <button type="button" onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10" title="Fechar"><X size={22}/></button>
      <img src={lightbox.url} alt={`Cartão de ${lightbox.name}`} onClick={e => e.stopPropagation()} className="max-h-[90vh] max-w-full rounded-xl shadow-2xl"/>
    </div>}
  </main></div>
}
