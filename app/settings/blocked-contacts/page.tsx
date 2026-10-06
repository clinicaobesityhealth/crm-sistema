'use client'

import { useEffect, useMemo, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { Agent, Contact, supabase } from '@/lib/supabase'
import { Ban, Loader2, Search, Unlock } from 'lucide-react'
import { canaisBloqueados, desbloquearContato, NOME_DO_CANAL, CanalBloqueio } from '@/lib/bloqueio'

// v48.40 — Esta tela só enxergava o bloqueio INTEIRO.
//
// Desde a v48.34 dá para bloquear um canal só. Quem fazia isso ficava sem
// lugar nenhum para ver e desfazer: a lista aqui procurava exclusivamente
// crm_blocked = true, que num bloqueio parcial é falso. O paciente ficava
// bloqueado e invisível — e ninguém lembra de um bloqueio feito há três
// semanas.
//
// Agora a lista mostra quem está bloqueado em qualquer canal, diz em qual, e
// deixa desbloquear um canal de cada vez.

export default function BlockedContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [trabalhando, setTrabalhando] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase.from('agents').select('*').eq('id', user.id).maybeSingle()
        if (data) setAgent(data as Agent)
      }
      await loadBlockedContacts()
    })()
  }, [])

  async function loadBlockedContacts() {
    setLoading(true)
    // As três formas de gravação convivem: a marca antiga do contato inteiro e
    // as duas marcas por canal. Procurar só uma delas é como esta tela deixou
    // de enxergar metade dos bloqueios.
    const { data, error } = await supabase.from('contacts')
      .select('*')
      .or('custom_fields->>crm_blocked.eq.true,custom_fields->>crm_blocked_whatsapp.eq.true,custom_fields->>crm_blocked_instagram.eq.true')
      .order('updated_at', { ascending: false })
    if (error) alert('Não foi possível carregar os contatos bloqueados: ' + error.message)
    // Última conferência no cliente: a regra de "o que conta como bloqueado"
    // mora num lugar só, em lib/bloqueio.
    setContacts((data ?? []).filter(c => canaisBloqueados(c as Contact).length > 0) as Contact[])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return contacts
    return contacts.filter(contact =>
      contact.full_name?.toLowerCase().includes(query)
      || contact.phone?.toLowerCase().includes(query)
      || contact.email?.toLowerCase().includes(query)
    )
  }, [contacts, search])

  async function desbloquear(contact: Contact, canal?: CanalBloqueio) {
    const canais = canaisBloqueados(contact)
    const alvo = canal ? [canal] : canais
    const texto = canal
      ? `Desbloquear ${contact.full_name || 'este contato'} no ${NOME_DO_CANAL[canal]}?`
      : `Desbloquear ${contact.full_name || 'este contato'}? Novas mensagens voltarão a aparecer normalmente no CRM.`
    if (!window.confirm(texto)) return

    setTrabalhando(contact.id + (canal || ''))
    const { erro } = await desbloquearContato(contact, agent, alvo)
    setTrabalhando(null)
    if (erro) { alert('Não foi possível desbloquear o contato: ' + erro); return }
    await loadBlockedContacts()
  }

  function blockedAt(contact: Contact) {
    const value = contact.custom_fields?.crm_blocked_at
    if (!value) return 'Data não registrada'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Data não registrada' : date.toLocaleString('pt-BR')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar/>
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <header className="border-b border-slate-100 bg-white px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-800">Contatos bloqueados</h1>
          <p className="mt-0.5 text-xs text-slate-400">Consulte e desbloqueie pacientes — no contato inteiro ou em um canal só</p>
        </header>

        <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-800">
            No canal bloqueado, a Sofia não responde e nenhuma mensagem sai — nem a dela, nem a da equipe.
            As mensagens do paciente continuam sendo guardadas no histórico.
          </div>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar por nome, telefone ou e-mail..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400"><Loader2 size={17} className="mr-2 animate-spin"/>Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white text-center">
              <Ban size={30} className="mb-2 text-slate-300"/>
              <p className="text-sm font-medium text-slate-600">Nenhum contato bloqueado</p>
              <p className="mt-1 text-xs text-slate-400">O bloqueio é feito pelo menu de três pontos no atendimento.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
              {filtered.map((contact, index) => {
                const canais = canaisBloqueados(contact)
                return (
                  <div key={contact.id} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center ${index ? 'border-t border-slate-100' : ''}`}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700"><Ban size={17}/></div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{contact.full_name || 'Contato sem nome'}</p>
                        <p className="truncate text-xs text-slate-500">{contact.phone || contact.email || 'Sem telefone ou e-mail'}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {canais.map(c => (
                            <span key={c} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                              bloqueado no {NOME_DO_CANAL[c]}
                            </span>
                          ))}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400">Bloqueado em {blockedAt(contact)}{contact.custom_fields?.crm_blocked_by_name ? ` por ${contact.custom_fields.crm_blocked_by_name}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {/* Um botão por canal quando há mais de um: desbloquear o
                          Instagram não pode significar desbloquear tudo. */}
                      {canais.length > 1 && canais.map(c => (
                        <button key={c}
                          onClick={() => void desbloquear(contact, c)}
                          disabled={trabalhando === contact.id + c}
                          className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {trabalhando === contact.id + c ? <Loader2 size={14} className="animate-spin"/> : <Unlock size={14}/>} Só {NOME_DO_CANAL[c]}
                        </button>
                      ))}
                      <button
                        onClick={() => void desbloquear(contact)}
                        disabled={trabalhando === contact.id}
                        className="flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        {trabalhando === contact.id ? <Loader2 size={15} className="animate-spin"/> : <Unlock size={15}/>} Desbloquear
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
