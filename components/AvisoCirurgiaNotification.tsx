'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'
import { BellRing, Check, ClipboardList, Loader2, Send, X } from 'lucide-react'

// v48.67 — "Deseja avisar o paciente?"
//
// A cirurgia mudou de situação e existe uma notícia para dar (foi solicitada ao
// hospital, o convênio autorizou). O texto já está pronto, mas quem aperta o
// botão é a secretária: ela sabe se o paciente já soube por telefone, se a
// situação mudou por engano, se falta uma linha no texto.
//
// O aviso NÃO depende de ela estar online na hora: fica pendente no banco e
// aparece na próxima vez que alguém abrir o CRM.

type Aviso = { id: string; tipo: string; titulo: string; texto: string; contact_id: string | null; cirurgia_id: string; criado_por: string | null; criado_em: string }

// v48.171 — Depois deste prazo sem decisão, o aviso volta a aparecer para
// QUALQUER UM (não só para quem mudou a situação) — rede de segurança para a
// pessoa ter saído sem decidir, ou ter esquecido. Até lá, só o autor da
// mudança vê a janela.
const PRAZO_QUALQUER_UM_MS = 2 * 60 * 60 * 1000

export default function AvisoCirurgiaNotification() {
  const { agent } = useAuth()
  const router = useRouter()
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const vistos = useRef<Set<string>>(new Set())

  const carregar = useCallback(async () => {
    if (!agent) return
    const { data } = await supabase.from('cirurgia_avisos')
      .select('id, tipo, titulo, texto, contact_id, cirurgia_id, criado_por, criado_em')
      .eq('status', 'pendente').order('criado_em').limit(20)
    const agora = Date.now()
    // v48.171 — "Deseja avisar o paciente?" (tipo de aviso que vem de mudança
    // de situação, com um autor conhecido) só aparece para quem mudou,
    // enquanto estiver dentro do prazo — os outros tipos (paciente parado,
    // medicamentos pendentes) não têm autor (criado_por vazio) e continuam
    // aparecendo para todo mundo, como sempre foi.
    const lista = ((data ?? []) as Aviso[]).filter(a =>
      !a.criado_por || a.criado_por === agent.id || (agora - new Date(a.criado_em).getTime()) > PRAZO_QUALQUER_UM_MS)
    lista.forEach(a => vistos.current.add(a.id))
    setAvisos(lista)
  }, [agent])

  useEffect(() => {
    if (!agent) return
    // Varre os pacientes parados numa situação (pré-operatório há 30 dias, por
    // exemplo) antes de listar. Não há agendador no banco para isto: como a
    // clínica abre o CRM todo dia, a varredura acontece aqui, e a chave
    // mensal do aviso impede que a mesma pessoa seja lembrada a cada login.
    //
    // v48.97/v48.122 — O aviso de véspera por medicamento aprovado também
    // vivia aqui (avisar_suspensao_medicamentos), mas dependia de alguém abrir
    // o CRM para nascer E para ser enviado — se ninguém via o cartão, o
    // paciente não era avisado a tempo (risco clínico, pedido do Jorge).
    // v48.132 — Saiu daqui: agora nasce sozinho assim que o remédio é
    // aprovado (trigger em cirurgia_medicamentos) e é enviado pelo mesmo motor
    // que já manda pré-op/pós-op/retorno sozinho, a cada minuto — não depende
    // mais de ninguém abrir esta tela. Ver agendar_lembrete_medicamento na
    // migração v48.132.
    supabase.rpc('avisar_cirurgias_paradas').then(() => {}, () => {})
    carregar()
    const canal = supabase.channel('aviso-cirurgia-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cirurgia_avisos' }, () => carregar())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [agent, carregar])

  const atual = avisos[0] || null
  useEffect(() => { setTexto(atual?.texto || ''); setErro('') }, [atual?.id])

  if (!agent || !atual) return null

  async function decidir(acao: 'enviar' | 'descartar') {
    setOcupado(acao); setErro('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/cirurgias/avisos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ id: atual!.id, acao, texto }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
      setAvisos(a => a.slice(1))
    } catch (e: any) { setErro(e?.message || 'Não foi possível.') }
    setOcupado('')
  }

  // v48.95 — z-[45], abaixo de qualquer modal (z-[60]+): ver o comentário em
  // NovaCirurgiaNotification.tsx — esse empate de z-index era o que fazia um
  // clique em botão de modal cair, às vezes, num aviso flutuante por baixo.
  //
  // v48.97 — "medicamentos_pendentes" é uma TAREFA da equipe (revisar antes de
  // gerar o documento de suspensão), não notícia para o paciente: card
  // diferente, sem texto editável nem "enviar" — só abrir a cirurgia ou dispensar.
  if (atual.tipo === 'medicamentos_pendentes') {
    return (
      <div className="fixed bottom-4 right-4 z-[45] w-[min(24rem,calc(100vw-2rem))] bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-brand-50 border-b border-brand-100">
          <ClipboardList size={15} className="text-brand-600 shrink-0"/>
          <p className="text-xs font-semibold text-brand-700 flex-1">Tarefa da equipe</p>
          {avisos.length > 1 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-200 text-brand-800">+{avisos.length - 1}</span>
          )}
        </div>
        <div className="px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-slate-800">{atual.titulo}</p>
          <p className="text-xs text-slate-500">{atual.texto}</p>
          {erro && <p className="text-[11px] text-red-600">{erro}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={() => router.push('/cirurgias?abrir=' + atual.cirurgia_id)}
              className="flex-1 px-3 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold">
              Abrir medicações
            </button>
            <button onClick={() => decidir('descartar')} disabled={!!ocupado}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium disabled:opacity-50">
              {ocupado === 'descartar' ? <Loader2 size={14} className="animate-spin"/> : <X size={14}/>} Dispensar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-[45] w-[min(26rem,calc(100vw-2rem))] bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100">
        <BellRing size={15} className="text-amber-600 shrink-0"/>
        <p className="text-xs font-semibold text-amber-800 flex-1">Deseja avisar o paciente?</p>
        {avisos.length > 1 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800">
            +{avisos.length - 1}
          </span>
        )}
      </div>

      <div className="px-4 py-3 space-y-2">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{atual.titulo}</p>
        {/* Editável de propósito: quase sempre vai como está, e quando não vai,
            reescrever aqui é mais rápido do que abrir a conversa. */}
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={7}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 leading-5 resize-y"/>
        {erro && <p className="text-[11px] text-red-600">{erro}</p>}
        <div className="flex gap-2">
          <button onClick={() => decidir('enviar')} disabled={!!ocupado || !texto.trim() || !atual.contact_id}
            title={!atual.contact_id ? 'Cirurgia sem paciente vinculado ao CRM' : ''}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40">
            {ocupado === 'enviar' ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>} Enviar agora
          </button>
          <button onClick={() => decidir('descartar')} disabled={!!ocupado}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium disabled:opacity-50">
            {ocupado === 'descartar' ? <Loader2 size={14} className="animate-spin"/> : <X size={14}/>} Não enviar
          </button>
        </div>
        {!atual.contact_id && (
          <p className="text-[11px] text-amber-700 flex items-start gap-1">
            <Check size={12} className="mt-0.5 shrink-0"/>
            Esta cirurgia não está ligada a um contato do CRM — vincule o paciente para poder enviar.
          </p>
        )}
      </div>
    </div>
  )
}
