'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase, Agent } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { MessageCircle, X, Send, ChevronLeft, Loader2, Check, CheckCheck } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'

// v48.169 — "read_at" entra para mostrar quando a mensagem foi lida, não só
// se foi lida (ver migração 20261005_leitura_chat_interno_v48_169.sql).
type IntMsg = { id: string; from_agent: string; to_agent: string; content: string; read: boolean; read_at?: string | null; created_at: string }
type IncomingNotice = { message: IntMsg; sender: Agent }

// Considera online se visto nos últimos 90 segundos
// Presença agora vem do Supabase Presence (instantâneo), via onlineIds do contexto

export default function InternalChat({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { agent, onlineIds } = useAuth()
  const [agents, setAgents] = useState<Agent[]>([])

  // v48.170 — Esta janela precisa ser maior que a tolerância de presença do
  // AuthContext (40s, v48.170): senão os dois sinais discordam entre si por
  // alguns segundos a cada queda de conexão — onlineIds ainda não marcou
  // offline, mas este fallback (baseado em last_seen_at, só atualizado a
  // cada heartbeat de 15s) já tinha marcado, e vice-versa. 60s dá folga.
  function isOnline(a: Agent): boolean {
    const seenRecently = !!a.is_online && !!a.last_seen_at &&
      Date.now() - new Date(a.last_seen_at).getTime() < 60000
    return onlineIds.has(a.id) || seenRecently
  }

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [messages, setMessages] = useState<IntMsg[]>([])
  const [text, setText] = useState('')
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [unreadByAgent, setUnreadByAgent] = useState<Record<string, number>>({})
  const [incomingNotice, setIncomingNotice] = useState<IncomingNotice | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const agentsRef = useRef<Agent[]>([])
  const openRef = useRef(open)

  const selectedAgentRef = useRef<Agent | null>(null)
  useEffect(() => { selectedAgentRef.current = selectedAgent }, [selectedAgent])
  useEffect(() => { agentsRef.current = agents }, [agents])
  useEffect(() => { openRef.current = open }, [open])

  useEffect(() => {
    if (!incomingNotice) return
    const timer = setTimeout(() => setIncomingNotice(null), 12000)
    return () => clearTimeout(timer)
  }, [incomingNotice])

  // Carrega agentes e presença + realtime (canal estável)
  useEffect(() => {
    if (!agent) return
    loadAgents()
    loadUnread()
    const interval = setInterval(() => { loadAgents(); loadUnread() }, 8000)

    const ch = supabase.channel(`internal-chat-${agent.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'internal_messages' }, (payload) => {
        const m = payload.new as IntMsg
        // Só mensagens que envolvem este agente
        if (m.to_agent !== agent.id && m.from_agent !== agent.id) return
        const sel = selectedAgentRef.current
        // Se a conversa aberta é com o outro lado desta mensagem, adiciona
        if (sel && (m.from_agent === sel.id || m.to_agent === sel.id)) {
          setMessages(prev => prev.find(x => x.id === m.id) ? prev : [...prev, m])
          if (m.to_agent === agent.id) markRead(m.from_agent)
        }
        loadUnread()
        // Toca som se recebeu mensagem nova de outro
        if (m.to_agent === agent.id && m.from_agent !== agent.id) {
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain); gain.connect(ctx.destination)
            osc.frequency.value = 660
            gain.gain.setValueAtTime(0.15, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
            osc.start(); osc.stop(ctx.currentTime + 0.3)
          } catch {}
          const alreadyViewing = openRef.current && selectedAgentRef.current?.id === m.from_agent
          if (!alreadyViewing) {
            const knownSender = agentsRef.current.find(a => a.id === m.from_agent)
            if (knownSender) {
              setIncomingNotice({ message: m, sender: knownSender })
            } else {
              supabase.from('agents').select('*').eq('id', m.from_agent).maybeSingle().then(({ data }) => {
                if (data) setIncomingNotice({ message: m, sender: data as Agent })
              })
            }
          }
        }
      })
      // v48.169 — Aviso de leitura em tempo real: quando a outra pessoa marca
      // a mensagem como lida (UPDATE em internal_messages), quem mandou vê o
      // check ficar duplo sem precisar reabrir a conversa.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'internal_messages' }, (payload) => {
        const m = payload.new as IntMsg
        if (m.to_agent !== agent.id && m.from_agent !== agent.id) return
        setMessages(prev => prev.some(x => x.id === m.id) ? prev.map(x => x.id === m.id ? m : x) : prev)
      })
      .subscribe()

    return () => { clearInterval(interval); supabase.removeChannel(ch) }
  }, [agent])

  useEffect(() => {
    if (selectedAgent) loadMessages(selectedAgent.id)
  }, [selectedAgent])

  // Polling da conversa aberta (fallback do realtime)
  useEffect(() => {
    if (!selectedAgent || !open) return
    const interval = setInterval(() => loadMessages(selectedAgent.id), 3000)
    return () => clearInterval(interval)
  }, [selectedAgent, open])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  async function loadAgents() {
    if (!agent) return
    const { data } = await supabase.from('agents').select('*').neq('id', agent.id).order('name')
    setAgents((data ?? []) as Agent[])
  }

  // Ordena com online primeiro (reativo ao onlineIds)
  const sortedAgents = [...agents].sort((a, b) => (isOnline(b) ? 1 : 0) - (isOnline(a) ? 1 : 0))

  async function loadUnread() {
    if (!agent) return
    const { data } = await supabase.from('internal_messages')
      .select('from_agent').eq('to_agent', agent.id).eq('read', false)
    const byAgent: Record<string, number> = {}
    for (const m of data ?? []) byAgent[m.from_agent] = (byAgent[m.from_agent] || 0) + 1
    setUnreadByAgent(byAgent)
    setUnreadTotal((data ?? []).length)
  }

  async function loadMessages(otherId: string) {
    if (!agent) return
    // Busca as duas direções separadamente (evita problema de sintaxe or/and aninhado)
    const [sent, received] = await Promise.all([
      supabase.from('internal_messages').select('*')
        .eq('from_agent', agent.id).eq('to_agent', otherId),
      supabase.from('internal_messages').select('*')
        .eq('from_agent', otherId).eq('to_agent', agent.id),
    ])
    const all = [...(sent.data ?? []), ...(received.data ?? [])]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    setMessages(prev => {
      const temps = prev.filter(m => m.id.startsWith('temp-') && !all.find(f => f.content === m.content && f.from_agent === m.from_agent))
      return [...all, ...temps]
    })
    markRead(otherId)
  }

  async function markRead(fromId: string) {
    if (!agent) return
    // v48.169 — "read_at" grava a hora de leitura, só na primeira vez (o
    // .eq('read', false) garante isso) — é o que o check duplo mostra para
    // quem mandou.
    //
    // v48.170 — Blindagem: se a coluna read_at ainda não existir no banco
    // (o SQL da v48.169 não rodou antes do deploy), o update acima falha
    // INTEIRO — e não só o read_at: o "read" também deixava de ser
    // marcado, travando a contagem de não lidas junto com o check de
    // leitura. Mesmo padrão já usado em outras telas deste CRM: tenta com o
    // campo novo, e se der erro, tenta de novo só com o que já existia.
    const { error } = await supabase.from('internal_messages')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('to_agent', agent.id).eq('from_agent', fromId).eq('read', false)
    if (error) {
      await supabase.from('internal_messages').update({ read: true })
        .eq('to_agent', agent.id).eq('from_agent', fromId).eq('read', false)
    }
    loadUnread()
  }

  async function send() {
    if (!text.trim() || !agent || !selectedAgent) return
    const content = text.trim()
    setText('')
    const optimistic: IntMsg = {
      id: 'temp-' + Date.now(), from_agent: agent.id, to_agent: selectedAgent.id,
      content, read: false, created_at: new Date().toISOString()
    }
    setMessages(prev => [...prev, optimistic])
    const { data, error } = await supabase.from('internal_messages').insert({
      from_agent: agent.id, to_agent: selectedAgent.id, content
    }).select().single()
    if (error) {
      alert('Erro ao enviar: ' + error.message)
      setMessages(prev => prev.filter(m => m.id !== optimistic.id))
      return
    }
    if (data) setMessages(prev => prev.map(m => m.id === optimistic.id ? data : m))
  }

  function initials(name: string) {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
  }

  const onlineCount = agents.filter(isOnline).length

  function openIncomingMessage(notice: IncomingNotice) {
    setSelectedAgent(notice.sender)
    setOpen(true)
    setIncomingNotice(null)
    markRead(notice.sender.id)
  }

  return (
    <>
      {incomingNotice && (
        <div className="fixed inset-x-3 top-3 z-[70] flex justify-center sm:inset-x-auto sm:right-5 sm:top-5 sm:block">
          <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-2xl">
            <button type="button" aria-label="Fechar notificação" onClick={() => setIncomingNotice(null)} className="absolute right-3 top-3 z-10 rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={15}/></button>
            <button type="button" onClick={() => openIncomingMessage(incomingNotice)} className="w-full p-4 pr-12 text-left hover:bg-slate-50 transition-colors">
              <div className="flex items-start gap-3">
                {incomingNotice.sender.photo_url
                  ? <img src={incomingNotice.sender.photo_url} alt="" className="h-11 w-11 flex-shrink-0 rounded-full object-cover"/>
                  : <div className="h-11 w-11 flex-shrink-0 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-bold">{initials(incomingNotice.sender.name)}</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><MessageCircle size={14} className="text-brand-600"/><p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Nova mensagem da equipe</p></div>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{incomingNotice.sender.name}</p>
                  <p className="mt-0.5 truncate text-sm text-slate-600">{incomingNotice.message.content}</p>
                  <p className="mt-2 text-xs font-medium text-brand-600">Clique para abrir a conversa</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      )}
      {/* Painel */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="flex-1 bg-black/20" onClick={() => setOpen(false)}/>
          <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col">
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
              {selectedAgent ? (
                <button onClick={() => setSelectedAgent(null)} className="flex items-center gap-2 text-slate-700">
                  <ChevronLeft size={18}/>
                  <div className="relative">
                    {selectedAgent.photo_url
                      ? <img src={selectedAgent.photo_url} className="w-8 h-8 rounded-full object-cover"/>
                      : <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold">{initials(selectedAgent.name)}</div>}
                    {isOnline(selectedAgent) && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"/>}
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold">{selectedAgent.name}</p>
                    <p className="text-[11px] text-slate-400">{isOnline(selectedAgent) ? 'online' : 'offline'}</p>
                  </div>
                </button>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-slate-800">Chat da equipe</p>
                  <p className="text-[11px] text-slate-400">{onlineCount} online agora</p>
                </div>
              )}
              <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
            </div>

            {/* Lista de agentes OU conversa */}
            {!selectedAgent ? (
              <div className="flex-1 overflow-y-auto">
                {agents.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Nenhum outro atendente</div>
                ) : sortedAgents.map(a => (
                  <button key={a.id} onClick={() => setSelectedAgent(a)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-50 text-left">
                    <div className="relative flex-shrink-0">
                      {a.photo_url
                        ? <img src={a.photo_url} className="w-10 h-10 rounded-full object-cover"/>
                        : <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-bold">{initials(a.name)}</div>}
                      {isOnline(a) && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                      <p className="text-xs text-slate-400 truncate">{a.job_title || (isOnline(a) ? 'online' : 'offline')}</p>
                    </div>
                    {unreadByAgent[a.id] > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 bg-brand-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                        {unreadByAgent[a.id]}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 bg-slate-50 space-y-2">
                  {messages.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Comece a conversar</div>
                  ) : messages.map(m => {
                    const mine = m.from_agent === agent?.id
                    // v48.169 — Check duplo (e colorido) só depois que a outra
                    // pessoa realmente abriu a conversa — read_at é a prova disso.
                    // Enquanto a mensagem ainda está sendo enviada (otimista,
                    // id "temp-...") não mostra nenhum check ainda.
                    const enviando = m.id.startsWith('temp-')
                    return (
                      <div key={m.id} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
                        <div className={clsx('max-w-[80%] px-3 py-2 rounded-2xl text-sm',
                          mine ? 'bg-brand-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm')}>
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          <p className={clsx('flex items-center justify-end gap-1 text-[10px] mt-0.5', mine ? 'text-white/60' : 'text-slate-400')}>
                            {format(new Date(m.created_at), 'HH:mm')}
                            {/* v48.170 — Degrau intermediário: "read" pode vir true sem
                                "read_at" (banco ainda sem a coluna da v48.169, ou mensagem
                                antiga lida antes dela existir) — mostra check duplo mesmo
                                assim, só sem o azul/hora exata, em vez de voltar pro check
                                simples como se não tivesse sido lida. */}
                            {mine && !enviando && (
                              m.read_at
                                ? <CheckCheck size={13} className="text-sky-300" aria-label={`Lido às ${format(new Date(m.read_at), 'HH:mm')}`}/>
                                : m.read
                                  ? <CheckCheck size={13} aria-label="Lido"/>
                                  : <Check size={13} aria-label="Enviado"/>
                            )}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="px-3 py-3 border-t border-slate-100 flex items-center gap-2">
                  <input value={text} onChange={e => setText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    placeholder="Mensagem..."
                    className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                  <button onClick={send} disabled={!text.trim()}
                    className="w-9 h-9 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-full flex items-center justify-center flex-shrink-0">
                    <Send size={15}/>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
