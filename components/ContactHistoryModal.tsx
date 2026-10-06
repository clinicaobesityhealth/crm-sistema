'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase, Contact, Message, Sector, canReadPrivateMessage } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { X, MessageSquare, Play, Loader2, Image as ImageIcon, FileText, Mic, Lock } from 'lucide-react'
import ContactAvatar from '@/components/ContactAvatar'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'

type Props = {
  contact: Contact
  onClose: () => void
  onStart: () => void
}

export default function ContactHistoryModal({ contact, onClose, onStart }: Props) {
  const { agent } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [agentSectorIds, setAgentSectorIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!agent) return
    Promise.all([
      // v47.13 — as 200 MAIS RECENTES. Em ordem crescente, o limite cortava pelo
      // fim e o histórico de um paciente antigo parava no passado.
      supabase.from('messages').select('*').eq('contact_id', contact.id).order('created_at', { ascending: false }).limit(200),
      supabase.from('sectors').select('*'),
      supabase.from('agent_sectors').select('sector_id').eq('agent_id', agent.id),
    ]).then(([msgRes, sectorsRes, agentSectorsRes]) => {
      setMessages((msgRes.data ?? []).slice().reverse())
      setSectors(sectorsRes.data ?? [])
      setAgentSectorIds((agentSectorsRes.data ?? []).map((s: any) => s.sector_id))
      setLoading(false)
    })
  }, [contact.id, agent?.id])

  useEffect(() => {
    if (!loading) scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [loading])

  function mediaLabel(m: Message) {
    if (m.media_type === 'image') return '📷 Imagem'
    if (m.media_type === 'audio') return '🎤 Áudio'
    if (m.media_type === 'video') return '🎬 Vídeo'
    if (m.media_type) return '📎 Anexo'
    return null
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <ContactAvatar avatarUrl={contact.avatar_url} name={contact.full_name} id={contact.id} textClass="text-sm"/>
            <div>
              <p className="text-sm font-semibold text-slate-800">{contact.full_name}</p>
              <p className="text-xs text-slate-400">{contact.phone || 'sem telefone'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
        </div>

        {/* Histórico */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 bg-slate-50 space-y-2 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin mr-2"/>Carregando histórico...</div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <MessageSquare size={28} className="text-slate-300 mb-2"/>
              <p className="text-sm text-slate-500">Nenhuma mensagem anterior</p>
            </div>
          ) : (
            messages.filter(m => !m.content?.startsWith('[INTERNO]')).map(m => {
              const isOut = m.direction === 'outbound'
              const isPrivate = !canReadPrivateMessage(m, contact.sector_id, sectors, agentSectorIds)
              if (isPrivate) {
                return (
                  <div key={m.id} className={clsx('flex', isOut ? 'justify-end' : 'justify-start')}>
                    <div className="max-w-[75%] px-3 py-2 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 text-sm flex items-center gap-2">
                      <Lock size={13} className="flex-shrink-0"/><span>Mensagem privada</span>
                    </div>
                  </div>
                )
              }
              return (
                <div key={m.id} className={clsx('flex', isOut ? 'justify-end' : 'justify-start')}>
                  <div className={clsx('max-w-[75%] px-3 py-2 rounded-2xl text-sm',
                    isOut ? 'bg-brand-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm')}>
                    {mediaLabel(m) && <p className="text-xs opacity-80 mb-0.5">{mediaLabel(m)}</p>}
                    {m.content && <p className="whitespace-pre-wrap break-words">{m.content.replace(/^\*.+:\*\n/, '')}</p>}
                    <p className={clsx('text-[10px] mt-0.5', isOut ? 'text-white/60' : 'text-slate-400')}>
                      {format(new Date(m.created_at), 'd MMM HH:mm', { locale: ptBR })}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Ação */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Fechar</button>
          <button onClick={onStart}
            className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
            <Play size={14}/> Iniciar atendimento
          </button>
        </div>
      </div>
    </div>
  )
}
