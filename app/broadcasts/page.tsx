'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import Sidebar from '@/components/Sidebar'
import { Send, CheckCircle2, XCircle, Clock, Loader2, CalendarClock, Plus, X, Users, Tag, Filter, Check, Search } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'

type SentMsg = {
  id: string
  contact_id: string
  content: string
  scheduled_for: string
  sent_at: string | null
  status: string
  origin: string
  broadcast_name?: string
  contact?: { full_name: string; phone: string }
}

type Sector = { id: string; name: string }

export default function BroadcastsPage() {
  const { agent } = useAuth()
  const [msgs, setMsgs] = useState<SentMsg[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'sent' | 'failed' | 'pending'>('all')
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')

  const filteredMsgs = msgs.filter(m => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const name = (m.contact as any)?.full_name?.toLowerCase() || ''
    const content = m.content?.toLowerCase() || ''
    const bname = (m as any).broadcast_name?.toLowerCase() || ''
    return name.includes(q) || content.includes(q) || bname.includes(q)
  })

  useEffect(() => { loadMsgs() }, [filter])

  async function loadMsgs() {
    setLoading(true)
    // Usa broadcast_id OU origin='broadcast' para não perder disparos cujo
    // registro em `broadcasts` falhou (ex.: RLS) mas cujas scheduled_messages
    // foram criadas normalmente com broadcast_id nulo.
    const base = supabase.from('scheduled_messages')
      .select('*, contact:contacts(full_name, phone)')
      .or('broadcast_id.not.is.null,origin.eq.broadcast')
    const query = filter !== 'all'
      ? base.eq('status', filter).order('scheduled_for', { ascending: true }).limit(200)
      : base.order('scheduled_for', { ascending: true }).limit(200)
    const { data } = await query
    setMsgs((data as any) ?? [])
    setLoading(false)
  }

  function statusIcon(status: string) {
    if (status === 'sent') return <CheckCircle2 size={15} className="text-emerald-500"/>
    if (status === 'failed') return <XCircle size={15} className="text-red-500"/>
    return <Clock size={15} className="text-slate-400"/>
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Disparos em massa</h1>
            <p className="text-xs text-slate-400 mt-0.5">Envie mensagens para grupos de contatos</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
              {(['all', 'pending', 'sent', 'failed'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={clsx('px-3 py-1.5 rounded-md transition-colors',
                    filter === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')}>
                  {f === 'all' ? 'Todos' : f === 'pending' ? 'Pendentes' : f === 'sent' ? 'Enviados' : 'Falharam'}
                </button>
              ))}
            </div>
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700">
              <Plus size={15}/> Novo disparo
            </button>
          </div>
          <div className="mt-3 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, conteúdo ou nome do disparo..."
              className="w-full max-w-md pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>
        </div>

        <div className="max-w-3xl px-6 py-8">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin mr-2"/>Carregando...</div>
          ) : filteredMsgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Send size={32} className="text-slate-300 mb-2"/>
              <p className="text-sm text-slate-500">Nenhum disparo ainda</p>
              <p className="text-xs text-slate-400 mt-1">Clique em "Novo disparo" para começar</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMsgs.map(msg => (
                <div key={msg.id} className="bg-white border border-slate-100 rounded-xl px-4 py-3.5 flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">{statusIcon(msg.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {(msg.contact as any)?.full_name || 'Contato'}
                      </p>
                      {msg.broadcast_name && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-brand-50 text-brand-700 flex-shrink-0">
                          {msg.broadcast_name}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 line-clamp-2 mb-1">{msg.content}</p>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><CalendarClock size={10}/>
                        {format(new Date(msg.scheduled_for), "d MMM 'às' HH:mm", { locale: ptBR })}
                      </span>
                      {msg.sent_at && <span className="flex items-center gap-1 text-emerald-500"><Send size={10}/>Enviado</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showModal && <BroadcastModal agentId={agent?.id} onClose={() => setShowModal(false)} onSent={() => { setShowModal(false); loadMsgs() }}/>}
    </div>
  )
}

function BroadcastModal({ agentId, onClose, onSent }: { agentId?: string; onClose: () => void; onSent: () => void }) {
  const [content, setContent] = useState('')
  const [name, setName] = useState('')
  const [sectors, setSectors] = useState<Sector[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [selectedSector, setSelectedSector] = useState<string>('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [mode, setMode] = useState<'filter' | 'manual'>('filter')
  const [allContacts, setAllContacts] = useState<any[]>([])
  const [manualSelected, setManualSelected] = useState<Set<string>>(new Set())
  const [contactSearch, setContactSearch] = useState('')
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  const [when, setWhen] = useState<'now' | 'scheduled'>('now')
  const [schedDate, setSchedDate] = useState('')
  const [schedTime, setSchedTime] = useState('')
  const [sending, setSending] = useState(false)
  const [step, setStep] = useState<'compose' | 'confirm'>('compose')

  useEffect(() => {
    supabase.from('sectors').select('id, name').order('name').then(({ data }) => setSectors(data ?? []))
    // Carrega tags da tabela dedicada (com fallback para tags dos contatos)
    supabase.from('tags').select('name').order('name').then(({ data }) => {
      if (data && data.length > 0) {
        setAllTags(data.map((t: any) => t.name))
      } else {
        supabase.from('contacts').select('tags').then(({ data: cs }) => {
          const tagSet = new Set<string>()
          for (const c of cs ?? []) for (const t of (c.tags ?? [])) tagSet.add(t)
          setAllTags(Array.from(tagSet).sort())
        })
      }
    })
    // Carrega todos os contatos com telefone para seleção manual
    supabase.from('contacts').select('id, full_name, phone').not('phone', 'is', null).order('full_name').then(({ data }) => {
      setAllContacts(data ?? [])
    })
  }, [])

  async function countRecipients() {
    if (mode === 'manual') {
      setRecipientCount(manualSelected.size)
      return manualSelected.size
    }
    let query: any = supabase.from('contacts').select('id', { count: 'exact', head: true })
      .not('phone', 'is', null)
    if (selectedSector) query = query.eq('sector_id', selectedSector)
    if (selectedTags.length > 0) query = query.overlaps('tags', selectedTags)
    const { count } = await query
    setRecipientCount(count ?? 0)
    return count ?? 0
  }

  async function handleReview() {
    if (!content.trim()) { alert('Escreva a mensagem'); return }
    await countRecipients()
    setStep('confirm')
  }

  async function handleSend() {
    setSending(true)
    let contacts: any[] = []
    if (mode === 'manual') {
      contacts = allContacts.filter(c => manualSelected.has(c.id))
    } else {
      let query: any = supabase.from('contacts').select('id, phone, full_name').not('phone', 'is', null)
      if (selectedSector) query = query.eq('sector_id', selectedSector)
      if (selectedTags.length > 0) query = query.overlaps('tags', selectedTags)
      const { data } = await query
      contacts = data ?? []
    }

    if (!contacts || contacts.length === 0) {
      alert('Nenhum contato selecionado')
      setSending(false)
      return
    }

    const scheduledFor = when === 'now'
      ? new Date().toISOString()
      : new Date(`${schedDate}T${schedTime}:00`).toISOString()

    // Cria a campanha (registro em `broadcasts`, usado para o nome/agrupamento).
    // Se falhar (ex.: RLS bloqueando o insert), seguimos mesmo assim: as
    // mensagens agendadas abaixo carregam origin='broadcast' e broadcast_name,
    // então continuam aparecendo na lista mesmo sem broadcast_id vinculado.
    const { data: broadcast, error: broadcastErr } = await supabase.from('broadcasts').insert({
      name: name.trim() || 'Disparo sem nome',
      content: content.trim(),
      filter_tags: selectedTags.length > 0 ? selectedTags : null,
      filter_sector_id: selectedSector || null,
      total_recipients: contacts.length,
      scheduled_for: scheduledFor,
      created_by: agentId ?? null,
    }).select().single()
    if (broadcastErr) {
      console.error('Erro ao registrar campanha em `broadcasts` (mensagens serão agendadas mesmo assim):', broadcastErr)
    }

    // Cria uma mensagem agendada para cada contato
    const rows = contacts.map((c: any) => ({
      contact_id: c.id,
      content: content.trim(),
      scheduled_for: scheduledFor,
      status: 'pending',
      origin: 'broadcast',
      broadcast_id: broadcast?.id ?? null,
      broadcast_name: name.trim() || 'Disparo',
      created_by: agentId ?? null,
    }))

    // Insere em lotes de 100
    let insertError: any = null
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from('scheduled_messages').insert(rows.slice(i, i + 100))
      if (error) {
        insertError = error
        console.error('Erro ao agendar mensagens do disparo:', error)
      }
    }

    setSending(false)

    if (insertError) {
      alert('Erro ao criar o disparo: ' + (insertError.message || 'tente novamente ou avise o suporte.'))
      return
    }

    onSent()
  }

  function toggleTag(tag: string) {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
    setRecipientCount(null)
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">
            {step === 'compose' ? 'Novo disparo em massa' : 'Confirmar disparo'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
        </div>

        {step === 'compose' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Nome do disparo (interno)</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Lembrete campanha julho"
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Mensagem</label>
              <textarea value={content} onChange={e => setContent(e.target.value)} rows={4}
                placeholder="Digite a mensagem que será enviada..."
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"/>
              <p className="text-xs text-slate-400 mt-1">Dica: use *texto* para negrito no WhatsApp</p>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1.5 block">Destinatários</label>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setMode('filter')}
                  className={clsx('flex-1 py-2 rounded-lg text-sm font-medium border', mode === 'filter' ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-600')}>
                  Por filtro
                </button>
                <button onClick={() => setMode('manual')}
                  className={clsx('flex-1 py-2 rounded-lg text-sm font-medium border', mode === 'manual' ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-600')}>
                  Escolher pessoas
                </button>
              </div>
            </div>

            {mode === 'manual' ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-500">Selecione os contatos ({manualSelected.size})</label>
                  <button onClick={() => {
                    const filtered = allContacts.filter(c => !contactSearch || c.full_name?.toLowerCase().includes(contactSearch.toLowerCase()))
                    if (manualSelected.size === filtered.length) setManualSelected(new Set())
                    else setManualSelected(new Set(filtered.map(c => c.id)))
                  }} className="text-xs text-brand-600 font-medium">
                    {manualSelected.size > 0 ? 'Limpar' : 'Selecionar todos'}
                  </button>
                </div>
                <input value={contactSearch} onChange={e => setContactSearch(e.target.value)}
                  placeholder="Buscar contato..."
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                <div className="max-h-56 overflow-y-auto space-y-1 border border-slate-100 rounded-lg p-1">
                  {allContacts
                    .filter(c => !contactSearch || c.full_name?.toLowerCase().includes(contactSearch.toLowerCase()))
                    .map(c => (
                    <button key={c.id} onClick={() => {
                      setManualSelected(prev => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id)
                        return next
                      })
                    }} className={clsx('w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm', manualSelected.has(c.id) ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                      <div className={clsx('w-4 h-4 rounded border flex items-center justify-center flex-shrink-0', manualSelected.has(c.id) ? 'bg-brand-600 border-brand-600' : 'border-slate-300')}>
                        {manualSelected.has(c.id) && <Check size={11} className="text-white"/>}
                      </div>
                      <span className="truncate text-slate-700">{c.full_name}</span>
                      <span className="text-xs text-slate-400 ml-auto flex-shrink-0">{c.phone}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
            <>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1"><Filter size={12}/> Filtrar por setor</label>
              <select value={selectedSector} onChange={e => { setSelectedSector(e.target.value); setRecipientCount(null) }}
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">Todos os setores</option>
                {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {allTags.length > 0 && (
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1"><Tag size={12}/> Filtrar por tags</label>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map(tag => (
                    <button key={tag} onClick={() => toggleTag(tag)}
                      className={clsx('px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                        selectedTags.includes(tag) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
            </>
            )}

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1.5 block">Quando enviar</label>
              <div className="flex gap-2">
                <button onClick={() => setWhen('now')}
                  className={clsx('flex-1 py-2 rounded-lg text-sm font-medium border', when === 'now' ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-600')}>
                  Agora
                </button>
                <button onClick={() => setWhen('scheduled')}
                  className={clsx('flex-1 py-2 rounded-lg text-sm font-medium border', when === 'scheduled' ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-600')}>
                  Agendar
                </button>
              </div>
              {when === 'scheduled' && (
                <div className="flex gap-2 mt-2">
                  <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"/>
                  <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"/>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 text-center">
              <Users size={24} className="text-brand-600 mx-auto mb-2"/>
              <p className="text-2xl font-bold text-brand-700">{recipientCount ?? '...'}</p>
              <p className="text-xs text-brand-600">contatos vão receber</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs font-medium text-slate-500 mb-1">Mensagem:</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{content}</p>
            </div>
            <div className="text-xs text-slate-500 space-y-1">
              <p><strong>Envio:</strong> {when === 'now' ? 'Imediato' : `${schedDate} às ${schedTime}`}</p>
              {selectedSector && <p><strong>Setor:</strong> {sectors.find(s => s.id === selectedSector)?.name}</p>}
              {selectedTags.length > 0 && <p><strong>Tags:</strong> {selectedTags.join(', ')}</p>}
            </div>
            {recipientCount === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                Nenhum contato encontrado com esses filtros. Ajuste os filtros.
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          {step === 'compose' ? (
            <>
              <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
              <button onClick={handleReview} disabled={!content.trim() || (when === 'scheduled' && (!schedDate || !schedTime))}
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                Revisar
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('compose')} className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Voltar</button>
              <button onClick={handleSend} disabled={sending || recipientCount === 0}
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                {sending ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
                {when === 'now' ? 'Enviar agora' : 'Agendar disparo'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
