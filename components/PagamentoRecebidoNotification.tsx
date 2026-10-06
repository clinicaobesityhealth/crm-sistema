'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'
import { CreditCard, X, AlertTriangle } from 'lucide-react'

// v48.55 — Alerta global (qualquer tela do CRM) quando um paciente PAGA uma
// cobrança no cartão. Escuta em tempo real a cobrança virar "paga" — o que só
// acontece depois de a própria InfinitePay (ou a Safrapay) confirmar o
// pagamento. Mesmo desenho do alerta de "Consulta confirmada".

type Alerta = {
  id: string
  contactId: string | null
  nome: string
  valor: string
  detalhe: string
  divergencia: string | null
  recibo: string | null
}

function brl(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''
}

function tocarSom() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    ;[660, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * 0.11)
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.11 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.11)
      osc.stop(now + i * 0.11 + 0.4)
    })
    setTimeout(() => { try { ctx.close() } catch {} }, 1200)
  } catch {}
}

export default function PagamentoRecebidoNotification() {
  const { agent } = useAuth()
  const router = useRouter()
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const avisados = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!agent) return
    const channel = supabase.channel('pagamento-recebido-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cobrancas_cartao' }, async (payload) => {
        const row = payload.new as any
        const antes = payload.old as any
        if (!row?.id || row.status !== 'paga') return
        if (antes?.status === 'paga') return
        if (avisados.current.has(row.id)) return
        avisados.current.add(row.id)

        let nome = 'Paciente'
        if (row.contact_id) {
          const { data } = await supabase.from('contacts').select('full_name').eq('id', row.contact_id).maybeSingle()
          if (data?.full_name) nome = data.full_name
        }
        const parcelas = Number(row.parcelas_pagas || row.parcelas) || 1
        const forma = row.forma_pagamento === 'pix' ? 'PIX' : (parcelas > 1 ? `cartão em ${parcelas}x` : 'cartão à vista')
        setAlertas(prev => [{
          id: row.id,
          contactId: row.contact_id || null,
          nome,
          valor: brl(row.valor_pago ?? row.valor_total),
          detalhe: [forma, row.descricao].filter(Boolean).join(' · '),
          divergencia: row.divergencia || null,
          recibo: row.receipt_url || null,
        }, ...prev].slice(0, 5))
        tocarSom()
      })
      // v48.56 — PIX confirmado pelo comprovante que o paciente mandou (a Sofia
      // leu e o valor bateu com a cobrança). Não há aviso do banco no PIX
      // direto: por isso o alerta lembra de conferir no extrato.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cobrancas_pix' }, async (payload) => {
        const row = payload.new as any
        const antes = payload.old as any
        if (!row?.id || row.status !== 'paga') return
        if (antes?.status === 'paga') return
        if (avisados.current.has(row.id)) return
        avisados.current.add(row.id)
        let nome = 'Paciente'
        if (row.contact_id) {
          const { data } = await supabase.from('contacts').select('full_name').eq('id', row.contact_id).maybeSingle()
          if (data?.full_name) nome = data.full_name
        }
        const porComprovante = row.confirmado_por === 'comprovante'
        setAlertas(prev => [{
          id: row.id,
          contactId: row.contact_id || null,
          nome,
          valor: brl(row.valor),
          detalhe: ['PIX', row.descricao].filter(Boolean).join(' · '),
          divergencia: porComprovante ? 'Confirmado pelo comprovante enviado pelo paciente — confira no extrato do banco.' : null,
          recibo: null,
        }, ...prev].slice(0, 5))
        tocarSom()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [agent])

  // Some sozinho depois de 20 s — pagamento merece ficar um pouco mais na tela.
  useEffect(() => {
    if (alertas.length === 0) return
    const timers = alertas.map(a => setTimeout(() => {
      setAlertas(prev => prev.filter(x => x.id !== a.id))
    }, 20000))
    return () => timers.forEach(clearTimeout)
  }, [alertas])

  if (!agent || alertas.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-[10000] space-y-2 w-[340px] max-w-[calc(100vw-2.5rem)]">
      {alertas.map(a => (
        <div key={a.id} className="relative bg-white border border-emerald-300 rounded-2xl shadow-2xl p-4">
          <button onClick={() => setAlertas(prev => prev.filter(x => x.id !== a.id))}
            className="absolute top-3 right-3 text-slate-400 hover:text-slate-600">
            <X size={15}/>
          </button>
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
              <CreditCard size={18}/>
            </div>
            <div className="pr-5 min-w-0">
              <p className="text-sm font-semibold text-slate-800">Pagamento recebido! {a.valor}</p>
              <p className="text-xs text-slate-500 mt-1">
                <strong>{a.nome}</strong> pagou{a.detalhe ? ` — ${a.detalhe}` : ''}.
              </p>
              {a.divergencia && (
                <p className="mt-1.5 text-[11px] text-amber-700 flex items-start gap-1">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0"/>{a.divergencia}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            {a.contactId && (
              <button
                onClick={() => { router.push(`/inbox?contact=${a.contactId}`); setAlertas(prev => prev.filter(x => x.id !== a.id)) }}
                className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium">
                Abrir conversa
              </button>
            )}
            {a.recibo && (
              <a href={a.recibo} target="_blank" rel="noopener noreferrer"
                className="flex-1 py-2 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-xs font-medium text-center">
                Comprovante
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
