'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { UserPlus, ArrowRightLeft, Check, X, Loader2 } from 'lucide-react'

type Request = {
  id: string
  contact_id: string
  requester_id: string
  request_type: 'join' | 'transfer'
  contact_name: string
  requester_name: string
}

export default function AccessRequestNotification() {
  const { agent } = useAuth()
  const router = useRouter()
  const [requests, setRequests] = useState<Request[]>([])
  const [processing, setProcessing] = useState<string | null>(null)

  useEffect(() => {
    if (!agent) return
    loadRequests()
    loadMyApprovals()

    const channel = supabase.channel(`access-req-${agent.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'access_requests'
      }, (payload) => {
        const req = payload.new as any
        // Sou owner de join/transfer OU sou o convidado de um invite
        if (req.owner_id === agent.id && (req.request_type === 'join' || req.request_type === 'transfer')) loadRequests()
        if (req.requester_id === agent.id && req.request_type === 'invite') loadRequests()
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'access_requests'
      }, (payload) => {
        const req = payload.new as any
        // Se meu pedido foi aprovado/rejeitado
        if (req.requester_id === agent.id && req.status !== 'pending') {
          loadMyApprovals()
        }
      })
      .subscribe()

    const interval = setInterval(() => { loadRequests(); loadMyApprovals() }, 5000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [agent])

  const [myApprovals, setMyApprovals] = useState<any[]>([])
  const notifiedApprovals = useRef<Set<string>>(new Set())

  async function loadMyApprovals() {
    if (!agent) return
    const { data } = await supabase.from('access_requests')
      .select('*')
      .eq('requester_id', agent.id)
      .in('status', ['approved', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(5)

    for (const req of data ?? []) {
      if (!notifiedApprovals.current.has(req.id)) {
        notifiedApprovals.current.add(req.id)
        const { data: contact } = await supabase.from('contacts').select('full_name').eq('id', req.contact_id).single()
        if (req.status === 'approved') {
          setApprovalToast({
            id: req.id,
            contactId: req.contact_id,
            contactName: contact?.full_name || 'Paciente',
            type: req.request_type,
          })
          // Remove após ver
          setTimeout(async () => {
            await supabase.from('access_requests').delete().eq('id', req.id)
          }, 1000)
        }
      }
    }
  }

  const [approvalToast, setApprovalToast] = useState<{ id: string; contactId: string; contactName: string; type: string } | null>(null)

  async function loadRequests() {
    if (!agent) return
    // Pedidos onde EU decido: sou owner de join/transfer, OU sou o convidado de um invite
    const { data: asOwner } = await supabase.from('access_requests')
      .select('*')
      .eq('owner_id', agent.id)
      .eq('status', 'pending')
      .in('request_type', ['join', 'transfer'])

    const { data: asInvited } = await supabase.from('access_requests')
      .select('*')
      .eq('requester_id', agent.id)
      .eq('status', 'pending')
      .eq('request_type', 'invite')

    const data = [...(asOwner ?? []), ...(asInvited ?? [])]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    if (!data || data.length === 0) { setRequests([]); return }

    // Busca nomes
    const enriched = await Promise.all(data.map(async r => {
      const [{ data: contact }, { data: requester }, { data: owner }] = await Promise.all([
        supabase.from('contacts').select('full_name').eq('id', r.contact_id).single(),
        supabase.from('agents').select('name').eq('id', r.requester_id).single(),
        supabase.from('agents').select('name').eq('id', r.owner_id).single(),
      ])
      return {
        ...r,
        contact_name: contact?.full_name || 'Paciente',
        requester_name: requester?.name || 'Atendente',
        owner_name: owner?.name || 'Atendente',
      }
    }))
    setRequests(enriched)
  }

  async function handleApprove(req: Request) {
    setProcessing(req.id)
    if (req.request_type === 'join' || req.request_type === 'invite') {
      // join: alguém pediu e o dono aceitou. invite: dono convidou e o convidado aceitou.
      // Em ambos, o participante é o requester_id.
      // Primeiro verifica se já existe para evitar erro de constraint
      const { data: existing } = await supabase.from('conversation_participants')
        .select('id').eq('contact_id', req.contact_id).eq('agent_id', req.requester_id).maybeSingle()
      if (!existing) {
        const { error: insErr } = await supabase.from('conversation_participants').insert({
          contact_id: req.contact_id, agent_id: req.requester_id
        })
        if (insErr) { console.error('Erro ao adicionar participante:', insErr); alert('Erro ao adicionar participante: ' + insErr.message) }
      }
      // Msg interna
      await supabase.from('messages').insert({
        contact_id: req.contact_id, channel: 'whatsapp', direction: 'outbound',
        content: `[INTERNO] 👥 ${req.requester_name} entrou na conversa`,
        status: 'sent', sender_id: agent?.id,
      })
      // Msg ao paciente sobre o novo participante (só agora que aceitou)
      await supabase.from('messages').insert({
        contact_id: req.contact_id, channel: 'whatsapp', direction: 'outbound',
        content: `*${req.requester_name}* está participando do seu atendimento. 😊`,
        status: 'queued', sender_id: agent?.id,
      })
    } else {
      // Transfere — busca o atendente atual para comparar
      const { data: contactData } = await supabase.from('contacts')
        .select('assigned_to').eq('id', req.contact_id).single()
      const isNewAgent = contactData?.assigned_to !== req.requester_id

      await supabase.from('conversation_participants').delete().eq('contact_id', req.contact_id)
      await supabase.from('contacts').update({
        assigned_to: req.requester_id,
        conversation_status: 'active',
        sofia_paused: true,
        updated_at: new Date().toISOString(),
      }).eq('id', req.contact_id)
      await supabase.from('messages').insert({
        contact_id: req.contact_id, channel: 'whatsapp', direction: 'outbound',
        content: `[INTERNO] 🔄 Atendimento transferido para ${req.requester_name}`,
        status: 'sent', sender_id: agent?.id,
      })
      // Msg ao paciente só se mudou de atendente
      if (isNewAgent) {
        await supabase.from('messages').insert({
          contact_id: req.contact_id, channel: 'whatsapp', direction: 'outbound',
          content: `Olá! A partir de agora você será atendido(a) por *${req.requester_name}*. Qualquer dúvida, estamos à disposição. 😊`,
          status: 'queued', sender_id: agent?.id,
        })
      }
    }
    await supabase.from('access_requests').update({ status: 'approved' }).eq('id', req.id)
    setProcessing(null)
    loadRequests()

    // Se EU sou quem vai participar (aceitei um convite), abro a conversa direto
    if (req.request_type === 'invite' && req.requester_id === agent?.id) {
      router.push(`/inbox?contact=${req.contact_id}`)
    }
  }

  async function handleReject(req: Request) {
    setProcessing(req.id)
    await supabase.from('access_requests').update({ status: 'rejected' }).eq('id', req.id)
    setProcessing(null)
    loadRequests()
  }

  if (requests.length === 0 && !approvalToast) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-2 max-w-sm w-full">
      {/* Toast de aprovação para o solicitante */}
      {approvalToast && (
        <div className="bg-emerald-600 text-white rounded-2xl shadow-xl p-4 space-y-2">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <Check size={18}/>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Solicitação aprovada!</p>
              <p className="text-xs text-white/80 mt-0.5">
                Você agora {approvalToast.type === 'join' ? 'participa' : 'atende'} <strong>{approvalToast.contactName}</strong>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setApprovalToast(null)}
              className="flex-1 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 rounded-lg">
              Fechar
            </button>
            <button onClick={() => { router.push(`/inbox?contact=${approvalToast.contactId}`); setApprovalToast(null) }}
              className="flex-1 py-1.5 text-xs font-medium bg-white text-emerald-700 hover:bg-emerald-50 rounded-lg">
              Abrir conversa
            </button>
          </div>
        </div>
      )}
      {requests.map(req => (
        <div key={req.id} className="bg-white border border-slate-200 rounded-2xl shadow-xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${req.request_type === 'transfer' ? 'bg-amber-100' : 'bg-brand-100'}`}>
              {req.request_type === 'transfer'
                ? <ArrowRightLeft size={16} className="text-amber-600"/>
                : <UserPlus size={16} className="text-brand-600"/>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                {req.request_type === 'invite' ? 'Convite para atendimento' : req.request_type === 'join' ? 'Solicitação de participação' : 'Solicitação de transferência'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {req.request_type === 'invite'
                  ? <><strong>{(req as any).owner_name}</strong> convidou você para participar do atendimento de <strong>{req.contact_name}</strong></>
                  : <><strong>{req.requester_name}</strong> quer {req.request_type === 'join' ? 'participar' : 'assumir'} o atendimento de <strong>{req.contact_name}</strong></>}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => handleReject(req)} disabled={processing === req.id}
              className="flex-1 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200 disabled:opacity-50">
              Recusar
            </button>
            <button onClick={() => handleApprove(req)} disabled={processing === req.id}
              className={`flex-1 py-2 text-xs font-medium text-white rounded-lg flex items-center justify-center gap-1 disabled:opacity-50 ${req.request_type === 'transfer' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-brand-600 hover:bg-brand-700'}`}>
              {processing === req.id ? <Loader2 size={12} className="animate-spin"/> : <Check size={12}/>}
              {req.request_type === 'invite' ? 'Aceitar' : req.request_type === 'join' ? 'Permitir' : 'Aprovar'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
