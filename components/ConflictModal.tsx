'use client'
import { Loader2, UserPlus, ArrowRightLeft, X, Clock } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { Contact } from '@/lib/supabase'

type Props = {
  contact: Contact
  currentAgentName: string
  currentAgentId: string
  onClose: () => void
  onResolved: () => void
}

export default function ConflictModal({ contact, currentAgentName, currentAgentId, onClose, onResolved }: Props) {
  const { agent } = useAuth()
  const [loading, setLoading] = useState<'join' | 'transfer' | null>(null)
  const [sent, setSent] = useState(false)
  const [requestType, setRequestType] = useState<'join' | 'transfer' | null>(null)

  async function sendRequest(type: 'join' | 'transfer') {
    if (!agent) { alert('Agente não identificado'); return }
    if (!currentAgentId) { alert('ID do atendente atual não encontrado'); return }
    setLoading(type)

    // Remove pedidos anteriores pendentes
    await supabase.from('access_requests')
      .delete()
      .eq('contact_id', contact.id)
      .eq('requester_id', agent.id)
      .eq('status', 'pending')

    // Cria novo pedido
    const { error } = await supabase.from('access_requests').insert({
      contact_id: contact.id,
      requester_id: agent.id,
      owner_id: currentAgentId,
      request_type: type,
      status: 'pending',
    })

    if (error) {
      setLoading(null)
      setRequestType(type)
      // Mostra erro ao invés de "enviado"
      setSent(false)
      alert('Erro ao enviar solicitação: ' + error.message)
      return
    }

    setLoading(null)
    setRequestType(type)
    setSent(true)
  }

  if (sent) {
    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-3">
          <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <Clock size={20} className="text-amber-600"/>
          </div>
          <p className="text-base font-semibold text-slate-800">Solicitação enviada</p>
          <p className="text-sm text-slate-500">
            Aguardando {currentAgentName} {requestType === 'join' ? 'permitir sua participação' : 'aprovar a transferência'}.
          </p>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600">Fechar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Paciente em atendimento</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-slate-600">
            <strong>{contact.full_name}</strong> está sendo atendido por{' '}
            <strong>{currentAgentName}</strong>. Enviar solicitação?
          </p>

          <button onClick={() => sendRequest('join')} disabled={!!loading}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-xl text-left transition-colors disabled:opacity-50">
            <div className="w-9 h-9 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
              {loading === 'join' ? <Loader2 size={16} className="animate-spin text-white"/> : <UserPlus size={16} className="text-white"/>}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Solicitar participação</p>
              <p className="text-xs text-slate-500">Você e {currentAgentName} atendem juntos</p>
            </div>
          </button>

          <button onClick={() => sendRequest('transfer')} disabled={!!loading}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl text-left transition-colors disabled:opacity-50">
            <div className="w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
              {loading === 'transfer' ? <Loader2 size={16} className="animate-spin text-white"/> : <ArrowRightLeft size={16} className="text-white"/>}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Solicitar transferência</p>
              <p className="text-xs text-slate-500">Você assume, some do {currentAgentName}</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
