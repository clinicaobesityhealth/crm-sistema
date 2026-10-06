'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { useAcessoAgendaPessoal } from '@/lib/acessoAgendaPessoal'
import {
  Check, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Repeat, Search, Trash2, X,
} from 'lucide-react'

// v48.70 — Minha agenda: mês, semana e dia, com busca e filtro.
//
// Só o dono vê. Um administrador pode LANÇAR na agenda de alguém — delegar uma
// tarefa — e continua sem ver o resto da agenda dela.
//
// As três visões existem porque respondem perguntas diferentes: o mês é "como
// está a minha semana que vem", a semana é o dia a dia, e o dia é "o que eu
// faço agora". Trocar de visão não perde a data em que se estava.

type Ocorrencia = {
  compromisso_id: string; titulo: string; descricao: string | null
  dia: string; hora: string; antecedencia_min: number; repete: string
  concluido: boolean; criado_por: string | null
}

type Form = {
  id: string | null; agent_id: string; titulo: string; descricao: string
  data: string; hora: string; antecedencia_min: number
  repete: string; repete_ate: string; avisar_whatsapp: boolean
}

const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const iso = (d: Date) => d.toLocaleDateString('sv-SE')
const dia = (s: string) => new Date(s + 'T12:00:00')
const somar = (s: string, n: number) => { const d = dia(s); d.setDate(d.getDate() + n); return iso(d) }

const REPETE = [
  ['nenhuma', 'não se repete'], ['diaria', 'todo dia'],
  ['semanal', 'toda semana'], ['mensal', 'todo mês'],
]
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const vazio = (agentId: string, data: string): Form => ({
  id: null, agent_id: agentId, titulo: '', descricao: '',
  data, hora: '09:00', antecedencia_min: 10,
  repete: 'nenhuma', repete_ate: '', avisar_whatsapp: true,
})

// Domingo da semana de uma data, e o primeiro dia da grade do mês (que começa
// no domingo anterior ao dia 1 para as colunas baterem).
const domingoDa = (s: string) => somar(s, -dia(s).getDay())
const inicioGradeMes = (s: string) => {
  const d = dia(s); d.setDate(1)
  return domingoDa(iso(d))
}

export default function AgendaPessoalPage() {
  const { agent, isAdmin } = useAuth()
  const pode = useAcessoAgendaPessoal()

  const [visao, setVisao] = useState<'mes' | 'semana' | 'dia'>('semana')
  const [foco, setFoco] = useState(hojeISO())
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'pendentes' | 'concluidos'>('todos')

  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [form, setForm] = useState<Form | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([])
  const [erro, setErro] = useState('')
  const buscaRef = useRef<HTMLInputElement>(null)

  // A janela carregada é sempre a da visão. Buscar carrega um pouco além, para
  // a pesquisa achar o compromisso da semana que vem sem precisar navegar.
  const { de, ate } = useMemo(() => {
    if (visao === 'dia') return { de: foco, ate: foco }
    if (visao === 'semana') { const d = domingoDa(foco); return { de: d, ate: somar(d, 6) } }
    const g = inicioGradeMes(foco)
    return { de: g, ate: somar(g, 41) }
  }, [visao, foco])

  const janela = useMemo(() => {
    if (!busca.trim()) return { de, ate }
    return { de: somar(hojeISO(), -60), ate: somar(hojeISO(), 180) }
  }, [busca, de, ate])

  const carregar = useCallback(async () => {
    if (!agent) return
    setCarregando(true)
    const { data, error } = await supabase.rpc('compromissos_ocorrencias', {
      p_agente: agent.id, p_de: janela.de, p_ate: janela.ate,
    })
    if (error) setErro(error.message + (/compromissos_ocorrencias/.test(error.message) ? ' — falta rodar a migração 20260923_agenda_pessoal_v48_68.sql.' : ''))
    else setErro('')
    setOcorrencias((data ?? []) as Ocorrencia[])
    setCarregando(false)
  }, [agent, janela.de, janela.ate])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    if (!isAdmin) return
    supabase.from('agents').select('id, name').order('name').then(({ data }) => setEquipe((data ?? []) as any))
  }, [isAdmin])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return ocorrencias.filter(o => {
      if (filtro === 'pendentes' && o.concluido) return false
      if (filtro === 'concluidos' && !o.concluido) return false
      if (!q) return true
      return (o.titulo + ' ' + (o.descricao || '')).toLowerCase().includes(q)
    })
  }, [ocorrencias, busca, filtro])

  const pendentesHoje = ocorrencias.filter(o => o.dia === hojeISO() && !o.concluido).length

  async function concluir(o: Ocorrencia) {
    if (o.concluido) {
      await supabase.from('compromisso_conclusoes').delete()
        .eq('compromisso_id', o.compromisso_id).eq('data', o.dia)
    } else {
      await supabase.from('compromisso_conclusoes')
        .insert({ compromisso_id: o.compromisso_id, data: o.dia, por: agent?.id ?? null })
    }
    // Troca só a linha mexida em vez de recarregar: o ✓ responde na hora.
    setOcorrencias(l => l.map(x =>
      x.compromisso_id === o.compromisso_id && x.dia === o.dia ? { ...x, concluido: !o.concluido } : x))
  }

  async function editar(id: string) {
    const { data } = await supabase.from('compromissos').select('*').eq('id', id).maybeSingle()
    if (!data) return
    setForm({
      id: data.id, agent_id: data.agent_id, titulo: data.titulo, descricao: data.descricao || '',
      data: data.data, hora: String(data.hora).slice(0, 5), antecedencia_min: data.antecedencia_min,
      repete: data.repete, repete_ate: data.repete_ate || '', avisar_whatsapp: data.avisar_whatsapp,
    })
  }

  async function salvar() {
    if (!form || !form.titulo.trim()) return
    setSalvando(true); setErro('')
    const corpo: any = {
      agent_id: form.agent_id, criado_por: agent?.id ?? null,
      titulo: form.titulo.trim(), descricao: form.descricao.trim() || null,
      data: form.data, hora: form.hora,
      antecedencia_min: Number(form.antecedencia_min) || 10,
      repete: form.repete, repete_ate: form.repete_ate || null,
      avisar_whatsapp: form.avisar_whatsapp, updated_at: new Date().toISOString(),
    }
    const { error } = form.id
      ? await supabase.from('compromissos').update(corpo).eq('id', form.id)
      : await supabase.from('compromissos').insert(corpo)
    setSalvando(false)
    if (error) { setErro('Não foi possível salvar: ' + error.message); return }
    setForm(null); carregar()
  }

  async function apagar(id: string) {
    if (!window.confirm('Apagar este compromisso? Se ele se repete, todas as datas somem.')) return
    // Cancelado, não apagado: o histórico de conclusões continua fazendo
    // sentido, e um clique errado não leva junto o que já foi feito.
    await supabase.from('compromissos').update({ cancelado: true }).eq('id', id)
    setForm(null); carregar()
  }

  if (pode === false) {
    return (
      <div className="flex h-screen bg-surface overflow-hidden">
        <Sidebar/>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <p className="text-sm font-semibold text-slate-700">Minha agenda</p>
            <p className="text-xs text-slate-400 mt-1">
              Seu cargo não tem agenda pessoal. Se precisar de uma, peça a um administrador
              para liberar em Configurações → Cargos.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const passo = (n: number) => setFoco(f => visao === 'mes'
    ? (() => { const d = dia(f); d.setDate(1); d.setMonth(d.getMonth() + n); return iso(d) })()
    : somar(f, (visao === 'semana' ? 7 : 1) * n))

  const rotuloPeriodo = () => {
    const d = dia(foco)
    if (visao === 'mes') return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    if (visao === 'dia') return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    const ini = dia(domingoDa(foco)), fim = dia(somar(domingoDa(foco), 6))
    return `${ini.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${fim.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`
  }

  const campo = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  const Linha = ({ o, compacto }: { o: Ocorrencia; compacto?: boolean }) => (
    <div className={'group flex items-start gap-2.5 rounded-xl border bg-white transition-colors '
      + (compacto ? 'px-2.5 py-2 ' : 'px-3 py-2.5 ')
      + (o.concluido ? 'border-slate-100' : 'border-slate-200 hover:border-brand-200')}>
      <button onClick={() => concluir(o)} aria-label={o.concluido ? 'Reabrir' : 'Concluir'}
        className={'mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors '
          + (o.concluido ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400 hover:text-emerald-300')}>
        <Check size={13}/>
      </button>
      <div className="flex-1 min-w-0">
        <p className={'text-sm text-slate-800 ' + (o.concluido ? 'line-through text-slate-400' : 'font-medium')}>
          <span className="tabular-nums text-slate-500 mr-1.5">{o.hora.slice(0, 5)}</span>{o.titulo}
        </p>
        {o.descricao && !compacto && <p className="text-xs text-slate-500 whitespace-pre-wrap mt-0.5">{o.descricao}</p>}
        {o.repete !== 'nenhuma' && (
          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
            <Repeat size={10}/>{REPETE.find(r => r[0] === o.repete)?.[1]}
          </p>
        )}
      </div>
      <button onClick={() => editar(o.compromisso_id)}
        className="p-1.5 text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 focus:opacity-100">
        <Pencil size={13}/>
      </button>
    </div>
  )

  const DiaLista = ({ d }: { d: string }) => {
    const doDia = visiveis.filter(o => o.dia === d)
    const ehHoje = d === hojeISO()
    return (
      <div>
        <div className="flex items-baseline gap-2 mb-1.5">
          <p className={'text-xs font-semibold ' + (ehHoje ? 'text-brand-600' : 'text-slate-400')}>
            {dia(d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}
            {ehHoje ? ' · hoje' : ''}
          </p>
          <button onClick={() => setForm(vazio(agent?.id || '', d))}
            className="text-[11px] text-slate-300 hover:text-brand-600">+ adicionar</button>
        </div>
        {doDia.length === 0
          ? <p className="text-xs text-slate-300 pl-1 pb-1">nada marcado</p>
          : <div className="space-y-1.5">{doDia.map(o => <Linha key={o.compromisso_id + o.dia} o={o}/>)}</div>}
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Minha agenda</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {pendentesHoje > 0
                ? `${pendentesHoje} ${pendentesHoje === 1 ? 'compromisso em aberto hoje' : 'compromissos em aberto hoje'}`
                : 'nada em aberto hoje'} · só você vê
            </p>
          </div>
          <button onClick={() => setForm(vazio(agent?.id || '', visao === 'mes' ? hojeISO() : foco))}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors">
            <Plus size={15}/> Novo
          </button>
        </div>

        {/* Barra de controle: visão, navegação, busca e filtro */}
        <div className="bg-white border-b border-slate-100 px-6 py-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {([['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia']] as const).map(([v, r]) => (
              <button key={v} onClick={() => setVisao(v)}
                className={'px-3 py-1.5 text-xs font-semibold transition-colors '
                  + (visao === v ? 'bg-brand-500 text-white' : 'text-slate-500 hover:bg-slate-50')}>
                {r}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button onClick={() => passo(-1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronLeft size={15}/></button>
            <button onClick={() => setFoco(hojeISO())} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50">hoje</button>
            <button onClick={() => passo(1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronRight size={15}/></button>
          </div>

          <p className="text-sm font-semibold text-slate-700 capitalize px-1">{rotuloPeriodo()}</p>

          <div className="flex-1"/>

          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300"/>
            <input ref={buscaRef} value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="procurar compromisso"
              className="w-52 pl-8 pr-7 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            {busca && (
              <button onClick={() => { setBusca(''); buscaRef.current?.focus() }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"><X size={13}/></button>
            )}
          </div>

          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {([['todos', 'todos'], ['pendentes', 'em aberto'], ['concluidos', 'feitos']] as const).map(([v, r]) => (
              <button key={v} onClick={() => setFiltro(v)}
                className={'px-2.5 py-1.5 text-[11px] font-semibold transition-colors '
                  + (filtro === v ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-50')}>
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-5">
          {erro && <p className="text-xs text-red-600 mb-3">{erro}</p>}

          {carregando ? (
            <div className="flex items-center gap-2 text-slate-400 py-16"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
          ) : busca.trim() ? (
            // Buscando, o calendário sai da frente: o que importa é a lista de
            // resultados, em ordem de data, venha de que dia vier.
            <div className="max-w-3xl space-y-1.5">
              <p className="text-xs text-slate-400 mb-2">
                {visiveis.length === 0 ? 'nada encontrado' : `${visiveis.length} ${visiveis.length === 1 ? 'resultado' : 'resultados'}`}
              </p>
              {visiveis.map(o => (
                <div key={o.compromisso_id + o.dia}>
                  <p className="text-[11px] text-slate-400 mb-0.5">
                    {dia(o.dia).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                  </p>
                  <Linha o={o}/>
                </div>
              ))}
            </div>
          ) : visao === 'mes' ? (
            <div className="max-w-5xl">
              <div className="grid grid-cols-7 gap-px mb-1">
                {SEMANA.map(s => <p key={s} className="text-[11px] font-semibold text-slate-400 text-center py-1">{s}</p>)}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: 42 }, (_, i) => somar(inicioGradeMes(foco), i)).map(d => {
                  const doDia = visiveis.filter(o => o.dia === d)
                  const doMes = dia(d).getMonth() === dia(foco).getMonth()
                  const ehHoje = d === hojeISO()
                  return (
                    <button key={d} onClick={() => { setFoco(d); setVisao('dia') }}
                      className={'text-left rounded-xl border p-1.5 min-h-[5.5rem] transition-colors '
                        + (ehHoje ? 'border-brand-300 bg-brand-50/40 ' : 'border-slate-100 hover:border-slate-200 ')
                        + (doMes ? 'bg-white' : 'bg-slate-50/60')}>
                      <p className={'text-[11px] font-semibold mb-1 tabular-nums '
                        + (ehHoje ? 'text-brand-600' : doMes ? 'text-slate-500' : 'text-slate-300')}>
                        {dia(d).getDate()}
                      </p>
                      <div className="space-y-0.5">
                        {doDia.slice(0, 3).map(o => (
                          <p key={o.compromisso_id + o.dia}
                            className={'text-[10px] leading-tight truncate rounded px-1 py-0.5 '
                              + (o.concluido ? 'bg-slate-100 text-slate-400 line-through' : 'bg-brand-50 text-brand-700')}>
                            {o.hora.slice(0, 5)} {o.titulo}
                          </p>
                        ))}
                        {doDia.length > 3 && (
                          <p className="text-[10px] text-slate-400 px-1">+{doDia.length - 3}</p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : visao === 'semana' ? (
            <div className="max-w-3xl space-y-4">
              {Array.from({ length: 7 }, (_, i) => somar(domingoDa(foco), i)).map(d => <DiaLista key={d} d={d}/>)}
            </div>
          ) : (
            <div className="max-w-2xl"><DiaLista d={foco}/></div>
          )}
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-800">{form.id ? 'Compromisso' : 'Novo compromisso'}</p>
              <button onClick={() => setForm(null)} className="p-1 text-slate-400"><X size={16}/></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">O quê</label>
                <input value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} className={campo} autoFocus/>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Detalhes (opcional)</label>
                <textarea value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} rows={3} className={campo}/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Dia</label>
                  <input type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} className={campo}/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Hora</label>
                  <input type="time" value={form.hora} onChange={e => setForm({ ...form, hora: e.target.value })} className={campo}/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Avisar antes</label>
                  <select value={form.antecedencia_min} onChange={e => setForm({ ...form, antecedencia_min: Number(e.target.value) })} className={campo}>
                    {[0, 5, 10, 15, 30, 60, 120].map(x => <option key={x} value={x}>{x === 0 ? 'na hora' : `${x} minutos antes`}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Repete</label>
                  <select value={form.repete} onChange={e => setForm({ ...form, repete: e.target.value })} className={campo}>
                    {REPETE.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                </div>
              </div>
              {form.repete !== 'nenhuma' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Repetir até (deixe vazio para sempre)</label>
                  <input type="date" value={form.repete_ate} onChange={e => setForm({ ...form, repete_ate: e.target.value })} className={campo}/>
                </div>
              )}
              {isAdmin && equipe.length > 0 && (
                <div>
                  {/* Delegar: o compromisso nasce na agenda da outra pessoa. Quem
                      lançou continua sem ver o resto da agenda dela. */}
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Na agenda de</label>
                  <select value={form.agent_id} onChange={e => setForm({ ...form, agent_id: e.target.value })} className={campo}>
                    {equipe.map(a => <option key={a.id} value={a.id}>{a.id === agent?.id ? `${a.name} (você)` : a.name}</option>)}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={form.avisar_whatsapp} className="rounded"
                  onChange={e => setForm({ ...form, avisar_whatsapp: e.target.checked })}/>
                avisar também no meu WhatsApp
              </label>
              {erro && <p className="text-xs text-red-600">{erro}</p>}
            </div>
            <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100">
              <button onClick={salvar} disabled={salvando || !form.titulo.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-semibold disabled:opacity-50">
                {salvando ? <Loader2 size={15} className="animate-spin"/> : null} Salvar
              </button>
              {form.id && (
                <button onClick={() => apagar(form.id!)} className="px-3 py-2.5 rounded-xl border border-slate-200 text-red-600 hover:bg-red-50">
                  <Trash2 size={15}/>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
