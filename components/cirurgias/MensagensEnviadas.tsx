'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Check, ChevronDown, Loader2, MessageSquare, Send, Trash2, X } from 'lucide-react'

// v48.83 — O que já foi dito a este paciente.
//
// Sem isto, a equipe não tem como saber se a cobrança do pré-operatório parado
// já saiu, nem se ele foi avisado da autorização — e acaba repetindo. Paciente
// cobrado duas vezes pela mesma coisa para de responder.
//
// Mostra as duas origens no mesmo lugar, porque para quem lê tanto faz:
//   avisos  — as notícias que alguém autorizou e enviou
//   agenda  — o pré-op, o pós-op e o retorno, que saem sozinhos
//
// v48.86 — Uma cirurgia que vai e volta de situação (solicitada → autorizada →
// volta pra pré-op → autorizada de novo...) criava um "não enviada" por ciclo,
// e a lista só crescia — parecia que várias coisas diferentes não tinham sido
// avisadas, quando era sempre a mesma. Agora só o estado mais recente de cada
// tipo de mensagem aparece: se ele foi descartado, mostra "pendente" (não
// "não enviada" — a decisão ainda pode mudar) e um clique reabre e manda,
// direto daqui, sem precisar caçar o alerta em outro lugar.
//
// v48.88 — E agora também aparece a que está pendente de verdade (esperando a
// secretária decidir), com a opção de apagar. É para o texto que saiu errado
// ou não faz mais sentido: apagando, a próxima vez que a situação mudar para o
// mesmo gatilho gera uma pendência nova, em vez de ficar presa nesta.
//
// v48.132 — Suspensão de medicamento (medicacao_suspender) saiu daqui: não é
// mais um "aviso" que espera alguém decidir — entrou no mesmo motor das
// mensagens automáticas por data (pré-op, pós-op, retorno), via
// agendar_lembrete_medicamento() (ver a migração v48.132). Por isso agora
// aparece do lado "agenda" desta tela, não "aviso" — sai sozinha, e a data
// se recalcula sozinha quando a cirurgia muda de data.

type LinhaAviso = {
  chave: string; titulo: string; quando: string | null; tipo: 'aviso'
  estadoReal: 'pendente' | 'descartado' | 'enviado'
  estado: 'enviada' | 'pendente'; avisoId: string; texto: string
}
type LinhaAgenda = { chave: string; titulo: string; quando: string | null; tipo: 'agendada'; estado: 'enviada' | 'agendada' }
type Linha = LinhaAviso | LinhaAgenda

const ROTULOS: Record<string, string> = {
  cirurgia_agendada: 'Cirurgia solicitada ao hospital',
  cirurgia_autorizada: 'Cirurgia autorizada pelo convênio',
  cirurgia_pre: 'Pré-operatório',
  cirurgia_pos: 'Pós-operatório',
  cirurgia_retorno: 'Retorno pós-operatório',
  cirurgia_preop_parado: 'Pré-operatório parado',
  // v48.132 — Sem o prefixo "cirurgia_": este reminder_type não vem de um
  // modelo em cirurgia_mensagens, vem de agendar_lembrete_medicamento() (um
  // por remédio aprovado). Ver a migração v48.132.
  medicacao_suspender: 'Suspensão de medicamento',
}

export default function MensagensEnviadas({ cirurgiaId }: { cirurgiaId: string }) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aberta, setAberta] = useState<string>('')
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [av, ag] = await Promise.all([
      supabase.from('cirurgia_avisos').select('id, titulo, tipo, status, texto, decidido_em, criado_em')
        .eq('cirurgia_id', cirurgiaId).order('criado_em', { ascending: false }),
      supabase.from('scheduled_messages').select('reminder_type, status, scheduled_for')
        .eq('cirurgia_id', cirurgiaId).order('scheduled_for', { ascending: false }),
    ])

    // Só o mais recente de cada tipo — o histórico de ciclos anteriores não
    // ajuda ninguém a decidir o que fazer agora, e o mais recente é sempre o
    // pendente de verdade, quando existe um.
    const avisosPorTipo = new Map<string, any>()
    for (const a of (av.data ?? []) as any[]) {
      // v48.97 — Tarefa interna da equipe, não mensagem ao paciente: não
      // pertence a esta lista (ver AvisoCirurgiaNotification.tsx).
      if (a.tipo === 'medicamentos_pendentes') continue
      if (!avisosPorTipo.has(a.tipo)) avisosPorTipo.set(a.tipo, a)
    }
    const saida: Linha[] = []
    for (const a of avisosPorTipo.values()) {
      const enviado = a.status === 'enviado'
      saida.push({
        chave: 'aviso:' + a.tipo, avisoId: a.id, texto: a.texto || '',
        titulo: a.titulo || ROTULOS['cirurgia_' + a.tipo] || a.tipo,
        quando: a.decidido_em || a.criado_em,
        tipo: 'aviso', estadoReal: a.status, estado: enviado ? 'enviada' : 'pendente',
      })
    }

    const agendaPorTipo = new Map<string, any>()
    for (const s of (ag.data ?? []) as any[]) {
      if (!['sent', 'scheduled', 'pending'].includes(s.status)) continue
      if (!agendaPorTipo.has(s.reminder_type)) agendaPorTipo.set(s.reminder_type, s)
    }
    for (const s of agendaPorTipo.values()) {
      saida.push({
        chave: 'agenda:' + s.reminder_type,
        titulo: ROTULOS[s.reminder_type] || s.reminder_type,
        quando: s.scheduled_for, tipo: 'agendada',
        estado: s.status === 'sent' ? 'enviada' : 'agendada',
      })
    }
    saida.sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || '')))
    setLinhas(saida)
    setCarregando(false)
  }, [cirurgiaId])

  useEffect(() => { carregar() }, [carregar])

  function abrir(l: LinhaAviso) {
    if (aberta === l.chave) { setAberta(''); return }
    setAberta(l.chave); setTexto(l.texto); setErro('')
  }

  async function chamarApi(avisoId: string, acao: 'enviar' | 'reenviar' | 'excluir', textoEnvio?: string) {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch('/api/cirurgias/avisos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ id: avisoId, acao, texto: textoEnvio }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
  }

  async function enviar(l: LinhaAviso) {
    const acao = l.estadoReal === 'descartado' ? 'reenviar' : 'enviar'
    setOcupado('enviar' + l.chave); setErro('')
    try {
      await chamarApi(l.avisoId, acao, texto)
      setAberta('')
      await carregar()
    } catch (e: any) { setErro(e?.message || 'Não foi possível.') }
    setOcupado('')
  }

  async function excluir(l: LinhaAviso) {
    setOcupado('excluir' + l.chave); setErro('')
    try {
      await chamarApi(l.avisoId, 'excluir')
      setAberta('')
      await carregar()
    } catch (e: any) { setErro(e?.message || 'Não foi possível.') }
    setOcupado('')
  }

  if (carregando) return null
  if (!linhas.length) return null

  return (
    <div className="bg-slate-50 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
        <MessageSquare size={13}/> Mensagens ao paciente
      </p>
      <ul className="space-y-1">
        {linhas.map(l => {
          const clicavel = l.tipo === 'aviso' && l.estado === 'pendente'
          const expandida = clicavel && aberta === l.chave
          const av = l as LinhaAviso
          return (
            <li key={l.chave} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div
                className={'flex items-center gap-2 px-2.5 py-1.5' + (clicavel ? ' cursor-pointer' : '')}
                onClick={() => clicavel && abrir(av)}>
                {l.estado === 'enviada'
                  ? <Check size={12} className="text-emerald-600 shrink-0"/>
                  : l.estado === 'agendada'
                    ? <span className="w-3 h-3 rounded-full border border-slate-300 shrink-0"/>
                    : <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"/>}
                <span className="text-[11px] text-slate-700 flex-1 min-w-0 truncate">{l.titulo}</span>
                <span className={'text-[10px] shrink-0 ' + (l.estado === 'enviada' ? 'text-emerald-600 font-semibold' : l.estado === 'pendente' ? 'text-amber-600 font-semibold' : 'text-slate-400')}>
                  {l.estado}
                  {l.quando ? ' · ' + new Date(l.quando).toLocaleDateString('pt-BR') : ''}
                </span>
                {clicavel && <ChevronDown size={12} className={'text-slate-300 shrink-0 transition-transform' + (expandida ? ' rotate-180' : '')}/>}
              </div>
              {expandida && (
                <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-slate-100">
                  <p className="text-[10px] text-slate-400">
                    {av.estadoReal === 'pendente'
                      ? 'Esperando decisão — revise e mande, ou apague para começar de novo.'
                      : 'Ainda não enviada — revise e mande, ou apague de vez.'}
                  </p>
                  <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={5}
                    className="w-full px-2.5 py-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 leading-5 resize-y"/>
                  {erro && <p className="text-[11px] text-red-600">{erro}</p>}
                  <div className="flex gap-1.5">
                    <button onClick={() => enviar(av)} disabled={!!ocupado || !texto.trim()}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold disabled:opacity-40">
                      {ocupado === 'enviar' + av.chave ? <Loader2 size={12} className="animate-spin"/> : <Send size={12}/>} Enviar agora
                    </button>
                    <button onClick={() => excluir(av)} disabled={!!ocupado}
                      title="Apagar esta pendência — a próxima mudança de situação gera uma nova"
                      className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 text-[12px] font-medium disabled:opacity-50">
                      {ocupado === 'excluir' + av.chave ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12}/>} Apagar
                    </button>
                    <button onClick={() => setAberta('')} disabled={!!ocupado}
                      className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-[12px] disabled:opacity-50">
                      <X size={12}/>
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
