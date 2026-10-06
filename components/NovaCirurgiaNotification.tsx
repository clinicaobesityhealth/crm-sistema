'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'
import { Check, Scissors, X } from 'lucide-react'

// v48.76 — "O Dr. lançou uma cirurgia."
//
// A cirurgia que chega pelo link do cirurgião não pode ficar esperando alguém
// abrir a lista e reparar numa linha nova. O aviso aparece para quem estiver no
// CRM — e, se ninguém estiver, espera: fica pendente até alguém marcar como
// vista. Um lançamento que passa despercebido vira uma cirurgia sem convênio
// solicitado.

type Nova = {
  id: string; paciente_nome: string; data_cirurgia: string | null; hora: string | null
  hospital: string | null; procedimento_sigla: string | null; lancada_por: string | null
  status: string | null; created_at: string
}

function tocarSom() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    ;[520, 780].forEach((f, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = f
      gain.gain.setValueAtTime(0, now + i * 0.13)
      gain.gain.linearRampToValueAtTime(0.13, now + i * 0.13 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.13 + 0.38)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.13); osc.stop(now + i * 0.13 + 0.42)
    })
    setTimeout(() => { try { ctx.close() } catch {} }, 1300)
  } catch {}
}

export default function NovaCirurgiaNotification() {
  const { agent } = useAuth()
  const router = useRouter()
  const [novas, setNovas] = useState<Nova[]>([])
  const [avisadas, setAvisadas] = useState<Set<string>>(new Set())

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('cirurgias')
      .select('id, paciente_nome, data_cirurgia, hora, hospital, procedimento_sigla, lancada_por, status, created_at')
      .eq('origem', 'cirurgiao').is('vista_pela_equipe_em', null)
      .order('created_at', { ascending: false }).limit(10)
    const lista = (data ?? []) as Nova[]
    setNovas(l => {
      if (lista.some(x => !l.some(y => y.id === x.id)) && l.length) tocarSom()
      return lista
    })
  }, [])

  useEffect(() => {
    if (!agent) return
    carregar()
    const canal = supabase.channel('nova-cirurgia-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cirurgias' }, () => carregar())
      .subscribe()
    const t = setInterval(carregar, 120000)
    return () => { supabase.removeChannel(canal); clearInterval(t) }
  }, [agent, carregar])

  const atual = novas.find(n => !avisadas.has(n.id)) || null
  if (!agent || !atual) return null

  async function marcarVista(abrir: boolean) {
    setAvisadas(s => new Set(s).add(atual!.id))
    await supabase.from('cirurgias').update({ vista_pela_equipe_em: new Date().toISOString() }).eq('id', atual!.id)
    setNovas(l => l.filter(x => x.id !== atual!.id))
    if (abrir) router.push('/cirurgias')
  }

  // v48.95 — z-[45], abaixo de qualquer modal (z-[60]+). Antes, ambos usavam
  // o mesmo z-[60]; quem abria por último ficava por cima, e um clique num
  // botão do modal podia acertar este aviso por baixo — foi assim que "Gerar
  // PDF" virou clique em "Agenda" e trocava de tela sozinho, no meio de uma
  // carta sendo editada.
  return (
    <div className="fixed bottom-4 right-4 z-[45] w-[min(24rem,calc(100vw-2rem))] bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-brand-50 border-b border-brand-100">
        <Scissors size={15} className="text-brand-600"/>
        <p className="text-xs font-semibold text-brand-700 flex-1">Cirurgia lançada pelo cirurgião</p>
        {novas.length > 1 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-200 text-brand-800">+{novas.length - 1}</span>
        )}
        <button onClick={() => setAvisadas(s => new Set(s).add(atual.id))} className="p-0.5 text-slate-400"><X size={14}/></button>
      </div>
      <div className="px-4 py-3 space-y-1.5">
        <p className="text-sm font-semibold text-slate-800">{atual.paciente_nome}</p>
        <p className="text-xs text-slate-500">
          {atual.procedimento_sigla || 'sem procedimento'}
          {atual.hospital ? ` · ${atual.hospital}` : ''}
          {atual.data_cirurgia ? ` · ${atual.data_cirurgia.split('-').reverse().join('/')}` : ' · sem data'}
          {atual.hora ? ` ${atual.hora.slice(0, 5)}` : ''}
        </p>
        <p className="text-[11px] text-slate-400">
          por {atual.lancada_por || 'cirurgião'}{atual.status ? ` · ${atual.status}` : ''}
        </p>
        <div className="flex gap-2 pt-1.5">
          <button onClick={() => marcarVista(true)}
            className="flex-1 px-3 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold">
            Abrir cirurgias
          </button>
          <button onClick={() => marcarVista(false)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium">
            <Check size={14}/> Já vi
          </button>
        </div>
      </div>
    </div>
  )
}
