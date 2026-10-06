'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'
import { useAcessoAgendaPessoal } from '@/lib/acessoAgendaPessoal'
import { AlarmClock, Check, ListChecks, X } from 'lucide-react'

// v48.68 — Lembrete dos compromissos e o resumo do dia.
//
// Duas coisas em um componente porque são a mesma ideia vista de dois ângulos:
// "o que eu tenho hoje" e "está na hora disto agora".
//
// O que está atrasado NÃO some. Se ela não estava no CRM quando deu a hora, o
// lembrete aparece quando ela abrir, marcado como atrasado — um lembrete que
// se perde por a pessoa não estar online não é um lembrete.

type Pendente = {
  compromisso_id: string; titulo: string; descricao: string | null
  dia: string; hora: string; antecedencia_min: number; atrasado: boolean
}

const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

function tocarSom() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    ;[880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * 0.16)
      gain.gain.linearRampToValueAtTime(0.14, now + i * 0.16 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.4)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.16); osc.stop(now + i * 0.16 + 0.45)
    })
    setTimeout(() => { try { ctx.close() } catch {} }, 1400)
  } catch {}
}

// Notificação do sistema: funciona com o CRM em outra aba ou minimizado.
// Só pede permissão uma vez, e nunca insiste se a pessoa negou.
function avisarNoSistema(titulo: string, corpo: string) {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') { new Notification(titulo, { body: corpo }); return }
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { if (p === 'granted') new Notification(titulo, { body: corpo }) })
    }
  } catch {}
}

export default function LembreteCompromissoNotification() {
  const { agent } = useAuth()
  const pode = useAcessoAgendaPessoal()
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [resumo, setResumo] = useState<Pendente[] | null>(null)
  const [fechados, setFechados] = useState<Set<string>>(new Set())
  const avisados = useRef<Set<string>>(new Set())

  const chave = (p: Pendente) => p.compromisso_id + ':' + p.dia

  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('meus_compromissos_pendentes', { p_dias_atras: 7 })
    const lista = (data ?? []) as Pendente[]
    lista.forEach(p => {
      const k = chave(p)
      if (avisados.current.has(k)) return
      avisados.current.add(k)
      // Só faz barulho pelo que está na hora. O atrasado aparece na tela, mas
      // não toca sino por algo de ontem.
      if (!p.atrasado) {
        tocarSom()
        avisarNoSistema(p.titulo, `${p.hora.slice(0, 5)} — ${p.descricao || 'lembrete da sua agenda'}`)
      }
    })
    setPendentes(lista)
  }, [])

  // Resumo do dia: uma vez por dia, na primeira abertura.
  const mostrarResumo = useCallback(async () => {
    const marca = 'crm_resumo_agenda'
    try { if (localStorage.getItem(marca) === hojeISO()) return } catch {}
    const hoje = hojeISO()
    const { data } = await supabase.rpc('compromissos_ocorrencias', {
      p_agente: agent?.id, p_de: hoje, p_ate: hoje,
    })
    const doDia = ((data ?? []) as any[]).filter(o => !o.concluido)
      .map(o => ({ ...o, atrasado: false })) as Pendente[]
    try { localStorage.setItem(marca, hoje) } catch {}
    if (doDia.length) setResumo(doDia)
  }, [agent?.id])

  useEffect(() => {
    if (!agent || pode !== true) return
    carregar(); mostrarResumo()
    const t = setInterval(carregar, 60000)
    return () => clearInterval(t)
  }, [agent, pode, carregar, mostrarResumo])

  async function concluir(p: Pendente) {
    await supabase.from('compromisso_conclusoes')
      .insert({ compromisso_id: p.compromisso_id, data: p.dia, por: agent?.id ?? null })
    setPendentes(l => l.filter(x => chave(x) !== chave(p)))
    setResumo(r => r ? r.filter(x => chave(x) !== chave(p)) : r)
  }

  if (!agent || pode !== true) return null

  const visiveis = pendentes.filter(p => !fechados.has(chave(p)))
  const atual = visiveis[0] || null

  if (resumo && resumo.length) {
    return (
      <div className="fixed inset-0 z-[70] bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
            <ListChecks size={16} className="text-brand-500"/>
            <p className="text-sm font-semibold text-slate-800 flex-1">O seu dia</p>
            <button onClick={() => setResumo(null)} className="p-1 text-slate-400"><X size={16}/></button>
          </div>
          <div className="px-5 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {resumo.map(p => (
              <div key={chave(p)} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200">
                <button onClick={() => concluir(p)} aria-label="Concluir"
                  className="mt-0.5 w-5 h-5 rounded-md border border-slate-300 text-transparent hover:border-emerald-400 flex items-center justify-center shrink-0">
                  <Check size={13}/>
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{p.hora.slice(0, 5)} · {p.titulo}</p>
                  {p.descricao && <p className="text-xs text-slate-500">{p.descricao}</p>}
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
            <Link href="/agenda-pessoal" onClick={() => setResumo(null)}
              className="flex-1 text-center px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600">
              Abrir a agenda
            </Link>
            <button onClick={() => setResumo(null)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-semibold">Começar o dia</button>
          </div>
        </div>
      </div>
    )
  }

  if (!atual) return null

  // v48.95 — z-[45], abaixo de qualquer modal (z-[60]+): este era exatamente
  // o card com o link para "Agenda" que estava causando a troca de tela
  // sozinha ao gerar uma carta — ver o comentário em NovaCirurgiaNotification.tsx.
  return (
    <div className="fixed bottom-4 right-4 z-[45] w-[min(22rem,calc(100vw-2rem))] bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
      <div className={'flex items-center gap-2 px-4 py-2.5 border-b ' + (atual.atrasado ? 'bg-amber-50 border-amber-100' : 'bg-brand-50 border-brand-100')}>
        <AlarmClock size={15} className={atual.atrasado ? 'text-amber-600' : 'text-brand-600'}/>
        <p className={'text-xs font-semibold flex-1 ' + (atual.atrasado ? 'text-amber-800' : 'text-brand-700')}>
          {atual.atrasado ? 'Passou da hora' : 'Daqui a pouco'}
        </p>
        {visiveis.length > 1 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">+{visiveis.length - 1}</span>
        )}
        <button onClick={() => setFechados(s => new Set(s).add(chave(atual)))} className="p-0.5 text-slate-400"><X size={14}/></button>
      </div>
      <div className="px-4 py-3 space-y-2">
        <p className="text-sm font-semibold text-slate-800">{atual.titulo}</p>
        <p className="text-xs text-slate-500">
          {atual.dia === hojeISO() ? 'hoje' : atual.dia.split('-').reverse().join('/')} às {atual.hora.slice(0, 5)}
        </p>
        {atual.descricao && <p className="text-xs text-slate-600 whitespace-pre-wrap">{atual.descricao}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={() => concluir(atual)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold">
            <Check size={14}/> Concluído
          </button>
          <Link href="/agenda-pessoal"
            className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium">Agenda</Link>
        </div>
      </div>
    </div>
  )
}
