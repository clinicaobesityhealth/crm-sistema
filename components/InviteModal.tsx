'use client'
import { useState, useEffect } from 'react'
import { supabase, Agent } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { X, UserPlus, Loader2, Check } from 'lucide-react'
import clsx from 'clsx'

type Props = {
  contactId: string
  contactName: string
  onClose: () => void
  onInvited: () => void
}

export default function InviteModal({ contactId, contactName, onClose, onInvited }: Props) {
  const { agent } = useAuth()
  const [agents, setAgents] = useState<Agent[]>([])
  const [selected, setSelected] = useState<string>('')
  const [inviting, setInviting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Busca todos os agentes exceto o atual
    supabase.from('agents').select('*').order('name').then(({ data }) => {
      setAgents((data ?? []).filter(a => a.id !== agent?.id))
      setLoading(false)
    })
  }, [agent])

  async function handleInvite() {
    if (!selected || !agent) return
    setInviting(true)
    const invited = agents.find(a => a.id === selected)

    // Cria um pedido de convite (o convidado precisa aceitar)
    await supabase.from('access_requests')
      .delete()
      .eq('contact_id', contactId)
      .eq('requester_id', selected)
      .eq('status', 'pending')

    await supabase.from('access_requests').insert({
      contact_id: contactId,
      requester_id: selected,      // quem vai participar (o convidado)
      owner_id: agent.id,           // quem convidou (o dono)
      request_type: 'invite',       // tipo especial: convite do dono
      status: 'pending',
    })

    // Mensagem interna de registro (sem avisar o paciente ainda)
    await supabase.from('messages').insert({
      contact_id: contactId, channel: 'whatsapp', direction: 'outbound',
      content: `[INTERNO] ✉️ ${agent.name} convidou ${invited?.name} para participar`,
      status: 'sent', sender_id: agent.id,
    })

    setInviting(false)
    onInvited()
  }

  function initials(name: string) {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Convidar atendente</h2>
            <p className="text-xs text-slate-400 mt-0.5">{contactName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs text-slate-500 mb-3">Selecione quem vai participar do atendimento junto com você:</p>
          {loading ? (
            <div className="flex items-center justify-center h-20 text-slate-400 text-sm"><Loader2 size={14} className="animate-spin mr-2"/>Carregando...</div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {agents.map(a => (
                <button key={a.id} onClick={() => setSelected(a.id)}
                  className={clsx('w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors',
                    selected === a.id ? 'bg-brand-50 border-brand-300' : 'bg-white border-slate-200 hover:bg-slate-50')}>
                  <div className="relative flex-shrink-0">
                    {a.photo_url
                      ? <img src={a.photo_url} className="w-8 h-8 rounded-full object-cover"/>
                      : <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold">{initials(a.name)}</div>}
                    {/* v48.170 — Mesma janela de 60s usada no resto do CRM (InternalChat,
                        tolerância de presença do AuthContext), para não discordar do
                        indicador online/offline mostrado em outras telas. */}
                    {a.last_seen_at && (Date.now() - new Date(a.last_seen_at).getTime() < 60000) && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"/>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{a.name}</p>
                    {a.job_title && <p className="text-xs text-slate-400">{a.job_title}</p>}
                  </div>
                  {selected === a.id && <Check size={16} className="text-brand-600 flex-shrink-0"/>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          <button onClick={onClose} disabled={inviting}
            className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancelar
          </button>
          <button onClick={handleInvite} disabled={inviting || !selected}
            className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
            {inviting ? <Loader2 size={13} className="animate-spin"/> : <UserPlus size={13}/>}
            Convidar
          </button>
        </div>
      </div>
    </div>
  )
}
