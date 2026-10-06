'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'
import { CheckCircle2, X } from 'lucide-react'

// v46.92 — alerta global (qualquer tela do CRM) quando um paciente confirma
// a consulta pelo link público (/confirmar/[id]). Não mexe em nada do fluxo
// de confirmação em si — só escuta em tempo real quando "patient_confirmed_at"
// é preenchido em "agendamentos" e mostra um card + toca um som curto.

type Alert = {
  id: string
  agendamentoId: string
  contactId: string | null
  patientName: string
  professionalName: string
  dateLabel: string
  timeLabel: string
}

function playConfirmChime() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    ;[880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * 0.12)
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.12)
      osc.stop(now + i * 0.12 + 0.4)
    })
    setTimeout(() => { try { ctx.close() } catch {} }, 1000)
  } catch {}
}

function formatDataBR(iso: string) {
  try {
    const [y, m, d] = iso.slice(0, 10).split('-')
    return `${d}/${m}/${y}`
  } catch {
    return iso
  }
}

export default function PatientConfirmationNotification() {
  const { agent } = useAuth()
  const router = useRouter()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const notified = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!agent) return
    const channel = supabase.channel('patient-confirmation-alert')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agendamentos' }, (payload) => {
        const row = payload.new as any
        if (!row?.patient_confirmed_at || !row?.id) return
        if (notified.current.has(row.id)) return
        notified.current.add(row.id)
        const alert: Alert = {
          id: `${row.id}-${row.patient_confirmed_at}`,
          agendamentoId: row.id,
          contactId: row.contact_id || null,
          patientName: row.paciente_nome || 'Paciente',
          professionalName: row.profissional_nome || '',
          dateLabel: row.data ? formatDataBR(row.data) : '',
          timeLabel: row.hora ? String(row.hora).slice(0, 5) : '',
        }
        setAlerts(prev => [alert, ...prev].slice(0, 5))
        playConfirmChime()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [agent])

  // Some sozinho depois de um tempo, sem precisar de interação.
  useEffect(() => {
    if (alerts.length === 0) return
    const timers = alerts.map(a => setTimeout(() => {
      setAlerts(prev => prev.filter(x => x.id !== a.id))
    }, 12000))
    return () => timers.forEach(clearTimeout)
  }, [alerts])

  if (!agent || alerts.length === 0) return null

  return (
    <div className="fixed top-5 right-5 z-[10000] space-y-2 w-[340px]">
      {alerts.map(a => (
        <div key={a.id} className="relative bg-white border border-emerald-200 rounded-2xl shadow-2xl p-4">
          <button onClick={() => setAlerts(prev => prev.filter(x => x.id !== a.id))}
            className="absolute top-3 right-3 text-slate-400 hover:text-slate-600">
            <X size={15}/>
          </button>
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={18}/>
            </div>
            <div className="pr-5 min-w-0">
              <p className="text-sm font-semibold text-slate-800">Consulta confirmada!</p>
              <p className="text-xs text-slate-500 mt-1">
                <strong>{a.patientName}</strong> confirmou presença
                {a.dateLabel ? ` na consulta de ${a.dateLabel}` : ''}
                {a.timeLabel ? ` às ${a.timeLabel}` : ''}
                {a.professionalName ? ` com ${a.professionalName}` : ''}.
              </p>
            </div>
          </div>
          {a.contactId && (
            <button
              onClick={() => { router.push(`/inbox?contact=${a.contactId}`); setAlerts(prev => prev.filter(x => x.id !== a.id)) }}
              className="w-full mt-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium">
              Ver conversa
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
