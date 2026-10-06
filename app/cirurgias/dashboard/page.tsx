'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { useAcessoCirurgias } from '@/lib/acessoCirurgias'
import { diasUteisEntre } from '@/lib/alertasCirurgia'
import { Loader2, PieChart, Ban, CheckCircle2, Clock3 } from 'lucide-react'

// v48.112 — Dashboard de Cirurgias.
//
// Separado da lista (/cirurgias) e do dashboard geral (/dashboard) porque
// aqui a pergunta é outra: não "o que fazer hoje", mas "como está indo o
// módulo" — quantas realizam, quantas cancelam e por quê, e quanto tempo
// cada etapa do prazo do convênio está levando. É a mesma pergunta que uma
// planilha respondia antes, só que sem alguém contando linha por linha.

type CirurgiaLinha = {
  id: string
  categoria: string | null
  modalidade: string | null
  convenio: string | null
  motivo_cancelamento: string | null
  motivo_cancelamento_id: string | null
  data_pre_operatorio: string | null
  data_solicitado_hospital: string | null
  data_autorizacao: string | null
}

type Motivo = { id: string; nome: string }

const ehConvenio = (modalidade: string | null) => /conv[êe]nio|reembolso/i.test(modalidade || '')

// Mesma leitura ao meio-dia usada em lib/alertasCirurgia — data pura
// (aaaa-mm-dd) não pode virar o dia anterior por causa de fuso horário.
function paraData(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00') : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function mediaDiasUteis(pares: [string | null, string | null][]): { media: number | null; n: number } {
  const valores = pares
    .map(([a, b]) => {
      const da = paraData(a), db = paraData(b)
      if (!da || !db) return null
      return diasUteisEntre(da, db)
    })
    .filter((v): v is number => v !== null && v >= 0)
  if (valores.length === 0) return { media: null, n: 0 }
  return { media: Math.round((valores.reduce((s, v) => s + v, 0) / valores.length) * 10) / 10, n: valores.length }
}

function BarraLista({ itens, corBarra }: { itens: { rotulo: string; n: number }[]; corBarra: string }) {
  const max = Math.max(1, ...itens.map(i => i.n))
  return (
    <div className="space-y-2.5">
      {itens.map(i => (
        <div key={i.rotulo}>
          <div className="flex items-baseline justify-between text-xs mb-1">
            <span className="text-slate-600 font-medium truncate pr-2">{i.rotulo}</span>
            <span className="text-slate-400 shrink-0">{i.n}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={'h-full rounded-full ' + corBarra} style={{ width: `${(i.n / max) * 100}%` }}/>
          </div>
        </div>
      ))}
    </div>
  )
}

function CardEtapa({ titulo, particular, convenio, porConvenio }: {
  titulo: string
  particular: { media: number | null; n: number }
  convenio: { media: number | null; n: number }
  porConvenio: { rotulo: string; media: number | null; n: number }[]
}) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock3 size={16} className="text-slate-400"/>
        <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
      </div>
      <p className="text-[11px] text-slate-400 mb-4">Em dias úteis — mesma unidade do prazo de 21 dias do convênio.</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] text-slate-400">Particular</p>
          <p className="text-xl font-semibold text-slate-800">{particular.media ?? '—'}{particular.media !== null && <span className="text-xs font-normal text-slate-400"> dias</span>}</p>
          <p className="text-[11px] text-slate-400">{particular.n} caso{particular.n === 1 ? '' : 's'}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] text-slate-400">Convênio (geral)</p>
          <p className="text-xl font-semibold text-slate-800">{convenio.media ?? '—'}{convenio.media !== null && <span className="text-xs font-normal text-slate-400"> dias</span>}</p>
          <p className="text-[11px] text-slate-400">{convenio.n} caso{convenio.n === 1 ? '' : 's'}</p>
        </div>
      </div>
      {porConvenio.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Por convênio</p>
          <div className="space-y-1.5">
            {porConvenio.map(c => (
              <div key={c.rotulo} className="flex items-center justify-between text-xs">
                <span className="text-slate-600 truncate pr-2">{c.rotulo}</span>
                <span className="text-slate-400 shrink-0">{c.media ?? '—'} dias · {c.n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function DashboardCirurgiasPage() {
  const veCirurgias = useAcessoCirurgias()
  const [linhas, setLinhas] = useState<CirurgiaLinha[]>([])
  const [motivos, setMotivos] = useState<Motivo[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    if (veCirurgias !== true) return
    Promise.all([
      supabase.from('cirurgias').select(
        'id, categoria, modalidade, convenio, motivo_cancelamento, motivo_cancelamento_id, data_pre_operatorio, data_solicitado_hospital, data_autorizacao'
      ),
      supabase.from('cirurgia_motivos_cancelamento').select('id, nome'),
    ]).then(([c, m]) => {
      setLinhas((c.data ?? []) as CirurgiaLinha[])
      setMotivos((m.data ?? []) as Motivo[])
      setCarregando(false)
    })
  }, [veCirurgias])

  const stats = useMemo(() => {
    const total = linhas.length
    const realizada = linhas.filter(l => l.categoria === 'realizada').length
    const aberta = linhas.filter(l => l.categoria === 'aberta' || (!l.categoria)).length
    const cancelada = linhas.filter(l => l.categoria === 'cancelada').length
    return { total, realizada, aberta, cancelada }
  }, [linhas])

  const motivosCancelamento = useMemo(() => {
    const canceladas = linhas.filter(l => l.categoria === 'cancelada')
    const nomeMotivo = new Map(motivos.map(m => [m.id, m.nome]))
    const contagem = new Map<string, number>()
    let naoCategorizado = 0
    for (const l of canceladas) {
      const nome = l.motivo_cancelamento_id ? nomeMotivo.get(l.motivo_cancelamento_id) : null
      if (nome) contagem.set(nome, (contagem.get(nome) ?? 0) + 1)
      else naoCategorizado++
    }
    const itens = Array.from(contagem.entries())
      .map(([rotulo, n]) => ({ rotulo, n }))
      .sort((a, b) => b.n - a.n)
    if (naoCategorizado > 0) itens.push({ rotulo: 'Não categorizado (cadastro anterior a esta lista)', n: naoCategorizado })
    return { itens, total: canceladas.length }
  }, [linhas, motivos])

  const etapaPreOpAgendamento = useMemo(() => {
    const pares = linhas.map(l => [l.data_pre_operatorio, l.data_solicitado_hospital, l.modalidade, l.convenio] as const)
    const particular = mediaDiasUteis(pares.filter(([, , mod]) => !ehConvenio(mod)).map(([a, b]) => [a, b]))
    const doConvenio = pares.filter(([, , mod]) => ehConvenio(mod))
    const convenio = mediaDiasUteis(doConvenio.map(([a, b]) => [a, b]))
    const porConvenioMap = new Map<string, [string | null, string | null][]>()
    for (const [a, b, , conv] of doConvenio) {
      const nome = (conv || '').trim() || 'Sem convênio informado'
      if (!porConvenioMap.has(nome)) porConvenioMap.set(nome, [])
      porConvenioMap.get(nome)!.push([a, b])
    }
    const porConvenio = Array.from(porConvenioMap.entries())
      .map(([rotulo, pares]) => ({ rotulo, ...mediaDiasUteis(pares) }))
      .sort((a, b) => b.n - a.n)
    return { particular, convenio, porConvenio }
  }, [linhas])

  const etapaAgendamentoAutorizacao = useMemo(() => {
    const pares = linhas.map(l => [l.data_solicitado_hospital, l.data_autorizacao, l.modalidade, l.convenio] as const)
    const particular = mediaDiasUteis(pares.filter(([, , mod]) => !ehConvenio(mod)).map(([a, b]) => [a, b]))
    const doConvenio = pares.filter(([, , mod]) => ehConvenio(mod))
    const convenio = mediaDiasUteis(doConvenio.map(([a, b]) => [a, b]))
    const porConvenioMap = new Map<string, [string | null, string | null][]>()
    for (const [a, b, , conv] of doConvenio) {
      const nome = (conv || '').trim() || 'Sem convênio informado'
      if (!porConvenioMap.has(nome)) porConvenioMap.set(nome, [])
      porConvenioMap.get(nome)!.push([a, b])
    }
    const porConvenio = Array.from(porConvenioMap.entries())
      .map(([rotulo, pares]) => ({ rotulo, ...mediaDiasUteis(pares) }))
      .sort((a, b) => b.n - a.n)
    return { particular, convenio, porConvenio }
  }, [linhas])

  if (veCirurgias === false) {
    return (
      <div className="flex h-screen bg-surface overflow-hidden">
        <Sidebar/>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <p className="text-sm font-semibold text-slate-700">Dashboard de Cirurgias</p>
            <p className="text-xs text-slate-400 mt-1">
              Seu cargo não tem acesso a esta área. Se precisar entrar, peça a um administrador
              para liberar em Configurações → Cargos.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-800">Dashboard de Cirurgias</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Realizadas, canceladas e o tempo de cada etapa do prazo do convênio
          </p>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 size={20} className="animate-spin"/>
          </div>
        ) : (
          <div className="px-6 py-6 max-w-5xl space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-100 rounded-2xl p-5">
                <div className="flex items-center gap-2 text-slate-400 mb-1"><Clock3 size={15}/><span className="text-[11px] font-medium uppercase tracking-wide">Em andamento</span></div>
                <p className="text-2xl font-semibold text-slate-800">{stats.aberta}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-5">
                <div className="flex items-center gap-2 text-emerald-500 mb-1"><CheckCircle2 size={15}/><span className="text-[11px] font-medium uppercase tracking-wide">Realizadas</span></div>
                <p className="text-2xl font-semibold text-slate-800">{stats.realizada}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-2xl p-5">
                <div className="flex items-center gap-2 text-red-500 mb-1"><Ban size={15}/><span className="text-[11px] font-medium uppercase tracking-wide">Canceladas</span></div>
                <p className="text-2xl font-semibold text-slate-800">{stats.cancelada}</p>
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-1">
                <PieChart size={16} className="text-slate-400"/>
                <h3 className="text-sm font-semibold text-slate-800">Motivos de cancelamento</h3>
              </div>
              <p className="text-[11px] text-slate-400 mb-4">{motivosCancelamento.total} cirurgia{motivosCancelamento.total === 1 ? '' : 's'} cancelada{motivosCancelamento.total === 1 ? '' : 's'} no total</p>
              {motivosCancelamento.itens.length === 0 ? (
                <p className="text-sm text-slate-400">Nenhum cancelamento registrado ainda.</p>
              ) : (
                <BarraLista itens={motivosCancelamento.itens} corBarra="bg-red-400"/>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <CardEtapa titulo="Pré-operatório → Agendamento" {...etapaPreOpAgendamento}/>
              <CardEtapa titulo="Agendamento → Autorização" {...etapaAgendamentoAutorizacao}/>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
