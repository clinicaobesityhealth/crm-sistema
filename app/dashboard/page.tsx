'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, startOfDay, endOfDay, subDays, addDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  AlertCircle,
  Bot,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  UserRoundCheck,
  Users,
  Wifi,
  WifiOff,
  Scissors,
} from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import { useAcessoCirurgias } from '@/lib/acessoCirurgias'
import { useAuth } from '@/lib/AuthContext'
import { useAiAssistantName } from '@/lib/useAiAssistantName'
import { supabase } from '@/lib/supabase'

type Period = 1 | 7 | 30

type DashboardStats = {
  activeConversations: number
  unassignedConversations: number
  messages: number
  inboundMessages: number
  outboundMessages: number
  newContacts: number
  appointmentsToday: number
  pendingDispatches: number
  overdueDispatches: number
  failedDispatches: number
  sofiaExcludedPatients: number
  cirurgiasProximas: number
  cirurgiasRealizadas: number
  cirurgiasSemAutorizacao: number
  cirurgiasValorProximas: number
}

type ActiveContact = {
  id: string
  full_name: string
  last_contacted_at: string | null
  assigned_to: string | null
}

type Cirurgia = {
  id: string
  paciente_nome: string
  data_cirurgia: string | null
  hospital: string | null
  procedimento_sigla: string | null
  status: string | null
  valor_cobrado: number | null
  data_autorizacao: string | null
}

type Appointment = {
  id: string
  paciente_nome: string
  profissional_nome: string
  data: string
  hora: string
  status: string
}

type TeamMember = {
  id: string
  name: string
  photo_url: string | null
  job_title: string | null
  last_seen_at: string | null
}

const emptyStats: DashboardStats = {
  activeConversations: 0,
  unassignedConversations: 0,
  messages: 0,
  inboundMessages: 0,
  outboundMessages: 0,
  newContacts: 0,
  appointmentsToday: 0,
  pendingDispatches: 0,
  overdueDispatches: 0,
  failedDispatches: 0,
  sofiaExcludedPatients: 0,
  cirurgiasProximas: 0,
  cirurgiasRealizadas: 0,
  cirurgiasSemAutorizacao: 0,
  cirurgiasValorProximas: 0,
}

export default function DashboardPage() {
  const assistantName = useAiAssistantName()
  const { onlineIds } = useAuth()
  const [period, setPeriod] = useState<Period>(7)
  const [stats, setStats] = useState<DashboardStats>(emptyStats)
  const [recentContacts, setRecentContacts] = useState<ActiveContact[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [cirurgias, setCirurgias] = useState<Cirurgia[]>([])
  const veCirurgias = useAcessoCirurgias()
  const [team, setTeam] = useState<TeamMember[]>([])
  const [sofiaPaused, setSofiaPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const loadDashboard = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setLoadError(false)

    const now = new Date()
    const today = format(now, 'yyyy-MM-dd')
    const todayStart = startOfDay(now).toISOString()
    const todayEnd = endOfDay(now).toISOString()
    const periodStart = startOfDay(subDays(now, period - 1)).toISOString()
    const daqui30 = format(addDays(now, 30), 'yyyy-MM-dd')
    const nowIso = now.toISOString()

    const results = await Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true })
        .or('conversation_status.eq.active,conversation_status.is.null'),
      supabase.from('contacts').select('id', { count: 'exact', head: true })
        .is('assigned_to', null)
        .or('conversation_status.eq.active,conversation_status.is.null'),
      supabase.from('messages').select('direction')
        .gte('created_at', periodStart).lte('created_at', todayEnd).limit(10000),
      supabase.from('contacts').select('id', { count: 'exact', head: true })
        .gte('created_at', periodStart).lte('created_at', todayEnd),
      supabase.from('agendamentos').select('id', { count: 'exact', head: true })
        .eq('data', today).neq('status', 'Cancelada'),
      supabase.from('scheduled_messages').select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase.from('scheduled_messages').select('id', { count: 'exact', head: true })
        .eq('status', 'pending').lt('scheduled_for', nowIso),
      supabase.from('scheduled_messages').select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
      supabase.from('contacts').select('id', { count: 'exact', head: true })
        .contains('custom_fields', { sofia_never_respond: true }),
      supabase.from('contacts').select('id, full_name, last_contacted_at, assigned_to')
        .or('conversation_status.eq.active,conversation_status.is.null')
        .order('last_contacted_at', { ascending: false }).limit(6),
      supabase.from('agendamentos').select('id, paciente_nome, profissional_nome, data, hora, status')
        .eq('data', today).neq('status', 'Cancelada').order('hora', { ascending: true }).limit(6),
      supabase.from('agents').select('id, name, photo_url, job_title, last_seen_at').order('name'),
      supabase.from('clinic_settings').select('sofia_paused_global').limit(1),
      // v48.47 — Cirurgias no painel.
      //
      // Duas leituras, e não uma: o que vem pela frente e o que já passou. A
      // agenda cirúrgica é planejada com semanas de antecedência, então "hoje"
      // não diz quase nada — quem olha este painel quer saber o que está
      // marcado e o que ficou pendente de autorização.
      supabase.from('cirurgias')
        .select('id, paciente_nome, data_cirurgia, hospital, procedimento_sigla, status, valor_cobrado, data_autorizacao')
        .gte('data_cirurgia', today).lte('data_cirurgia', daqui30)
        .neq('categoria', 'cancelada')
        .order('data_cirurgia', { ascending: true }).limit(200),
      supabase.from('cirurgias').select('id', { count: 'exact', head: true })
        .gte('data_cirurgia', format(subDays(now, period - 1), 'yyyy-MM-dd')).lte('data_cirurgia', today)
        .neq('categoria', 'cancelada'),
    ])

    const anyError = results.some(result => result.error)
    const messageRows = results[2].data ?? []
    const proximas = ((results[13].data as Cirurgia[]) ?? [])
    setStats({
      activeConversations: results[0].count ?? 0,
      unassignedConversations: results[1].count ?? 0,
      messages: messageRows.filter((message: any) => message.direction !== 'internal').length,
      inboundMessages: messageRows.filter((message: any) => message.direction === 'inbound').length,
      outboundMessages: messageRows.filter((message: any) => message.direction === 'outbound').length,
      newContacts: results[3].count ?? 0,
      appointmentsToday: results[4].count ?? 0,
      pendingDispatches: results[5].count ?? 0,
      overdueDispatches: results[6].count ?? 0,
      failedDispatches: results[7].count ?? 0,
      sofiaExcludedPatients: results[8].count ?? 0,
      cirurgiasProximas: proximas.length,
      cirurgiasRealizadas: results[14].count ?? 0,
      cirurgiasSemAutorizacao: proximas.filter(c => !c.data_autorizacao).length,
      cirurgiasValorProximas: proximas.reduce((soma, c) => soma + (Number(c.valor_cobrado) || 0), 0),
    })
    setCirurgias(proximas.slice(0, 6))
    setRecentContacts((results[9].data as ActiveContact[]) ?? [])
    setAppointments((results[10].data as Appointment[]) ?? [])
    setTeam((results[11].data as TeamMember[]) ?? [])
    setSofiaPaused(Boolean(results[12].data?.[0]?.sofia_paused_global))
    setLoadError(anyError)
    setLastUpdated(new Date())
    setLoading(false)
    setRefreshing(false)
  }, [period])

  useEffect(() => {
    loadDashboard()

    const channel = supabase.channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => loadDashboard(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_messages' }, () => loadDashboard(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agendamentos' }, () => loadDashboard(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cirurgias' }, () => loadDashboard(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clinic_settings' }, () => loadDashboard(true))
      .subscribe()

    const timer = window.setInterval(() => loadDashboard(true), 60000)
    return () => {
      window.clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [loadDashboard])

  const onlineTeam = useMemo(() => team.filter(member => onlineIds.has(member.id)), [team, onlineIds])
  const totalActionItems = stats.unassignedConversations + stats.overdueDispatches + stats.failedDispatches
  const totalExternalMessages = stats.inboundMessages + stats.outboundMessages
  const inboundPercent = totalExternalMessages ? Math.round((stats.inboundMessages / totalExternalMessages) * 100) : 0
  const outboundPercent = totalExternalMessages ? 100 - inboundPercent : 0

  const metricCards = [
    {
      label: 'Conversas ativas', value: stats.activeConversations, helper: 'Em atendimento agora',
      icon: MessageSquare, color: 'bg-brand-50 text-brand-700', href: '/inbox',
    },
    {
      label: 'Mensagens no período', value: stats.messages, helper: `${stats.inboundMessages} recebidas · ${stats.outboundMessages} enviadas`,
      icon: Send, color: 'bg-emerald-50 text-emerald-700', href: '/inbox',
    },
    {
      label: 'Novos contatos', value: stats.newContacts, helper: period === 1 ? 'Cadastrados hoje' : `Últimos ${period} dias`,
      icon: Users, color: 'bg-violet-50 text-violet-700', href: '/contacts',
    },
    {
      label: 'Consultas hoje', value: stats.appointmentsToday, helper: 'Sem contar canceladas',
      icon: CalendarCheck, color: 'bg-sky-50 text-sky-700', href: '/agenda-medica',
    },
  ]

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <header className="bg-white border-b border-slate-100 px-5 sm:px-6 py-4">
          <div className="max-w-7xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Central operacional</h1>
              <p className="text-xs text-slate-400 mt-0.5 capitalize">
                {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
                {([1, 7, 30] as Period[]).map(value => (
                  <button key={value} onClick={() => setPeriod(value)}
                    className={`px-3 py-1.5 rounded-md transition-colors ${period === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {value === 1 ? 'Hoje' : `${value} dias`}
                  </button>
                ))}
              </div>
              <button onClick={() => loadDashboard(true)} disabled={refreshing}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                title="Atualizar dashboard">
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 py-6 max-w-7xl space-y-6">
          {loadError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <AlertCircle size={16} /> Alguns dados não puderam ser atualizados. Os demais indicadores continuam disponíveis.
            </div>
          )}

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {metricCards.map(card => (
              <Link key={card.label} href={card.href}
                className="group bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 hover:border-slate-200 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.color}`}><card.icon size={17} /></div>
                  {loading ? <Loader2 size={14} className="animate-spin text-slate-300" /> : <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500" />}
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-slate-800">{loading ? '—' : card.value}</p>
                <p className="text-sm font-medium text-slate-600 mt-1">{card.label}</p>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate">{card.helper}</p>
              </Link>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
            <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Precisa de ação agora</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Pendências que podem afetar o atendimento</p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${totalActionItems ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {loading ? '—' : totalActionItems}
                </span>
              </div>
              <div className="divide-y divide-slate-50">
                <ActionRow icon={UserRoundCheck} label="Conversas sem responsável" value={stats.unassignedConversations} href="/inbox" urgent={stats.unassignedConversations > 0} />
                <ActionRow icon={Clock3} label="Disparos pendentes e atrasados" value={stats.overdueDispatches} detail={`${stats.pendingDispatches} pendentes no total`} href="/agenda" urgent={stats.overdueDispatches > 0} />
                <ActionRow icon={AlertCircle} label="Disparos com falha" value={stats.failedDispatches} href="/agenda" urgent={stats.failedDispatches > 0} />
                <ActionRow icon={CalendarCheck} label="Consultas programadas para hoje" value={stats.appointmentsToday} href="/agenda-medica" />
              </div>
              {!loading && totalActionItems === 0 && (
                <div className="mx-5 mb-5 mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
                  <CheckCircle2 size={15} /> Nenhuma pendência crítica neste momento.
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-5">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">{assistantName}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Situação atual do atendimento automático</p>
                </div>
                <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${sofiaPaused ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${sofiaPaused ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  {sofiaPaused ? 'Pausada globalmente' : 'Ativa globalmente'}
                </div>
              </div>
              <div className={`rounded-2xl border p-4 ${sofiaPaused ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-100 bg-emerald-50/50'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${sofiaPaused ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}><Bot size={20} /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{sofiaPaused ? 'Equipe assumiu o atendimento' : 'Respostas automáticas liberadas'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{sofiaPaused ? `${assistantName} não responderá enquanto estiver pausada.` : 'Respeitando as exceções individuais dos pacientes.'}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">{assistantName} nunca atende</p>
                  <p className="text-xs text-slate-400">Exceção permanente no cadastro</p>
                </div>
                <span className="text-xl font-bold text-slate-800">{loading ? '—' : stats.sofiaExcludedPatients}</span>
              </div>
              <Link href="/inbox" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800">
                Abrir atendimentos <ChevronRight size={13} />
              </Link>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-3">
            <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden xl:col-span-1">
              <PanelHeader title="Agenda de hoje" subtitle={`${stats.appointmentsToday} consulta${stats.appointmentsToday === 1 ? '' : 's'} programada${stats.appointmentsToday === 1 ? '' : 's'}`} href="/agenda-medica" />
              {appointments.length === 0 ? (
                <EmptyState icon={CalendarClock} text="Nenhuma consulta programada hoje" />
              ) : (
                <div className="divide-y divide-slate-50">
                  {appointments.map(item => (
                    <div key={item.id} className="px-5 py-3 flex items-center gap-3">
                      <div className="w-12 text-center rounded-lg bg-brand-50 py-1.5 text-xs font-bold text-brand-700">{item.hora?.slice(0, 5)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{item.paciente_nome}</p>
                        <p className="text-xs text-slate-400 truncate">{item.profissional_nome}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden xl:col-span-1">
              <PanelHeader title="Conversas recentes" subtitle="Atendimentos ativos" href="/inbox" />
              {recentContacts.length === 0 ? (
                <EmptyState icon={MessageSquare} text="Nenhuma conversa ativa" />
              ) : (
                <div className="divide-y divide-slate-50">
                  {recentContacts.map(contact => (
                    <Link href="/inbox" key={contact.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
                      <Avatar name={contact.full_name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{contact.full_name || 'Paciente sem nome'}</p>
                        <p className={`text-xs ${contact.assigned_to ? 'text-slate-400' : 'text-amber-600 font-medium'}`}>{contact.assigned_to ? 'Com responsável' : 'Sem responsável'}</p>
                      </div>
                      <p className="text-[11px] text-slate-400 whitespace-nowrap">
                        {contact.last_contacted_at ? format(new Date(contact.last_contacted_at), 'HH:mm') : '—'}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden xl:col-span-1">
              <PanelHeader title="Equipe agora" subtitle={`${onlineTeam.length} de ${team.length} online`} />
              {team.length === 0 ? (
                <EmptyState icon={Users} text="Nenhum usuário encontrado" />
              ) : (
                <div className="divide-y divide-slate-50 max-h-[310px] overflow-y-auto">
                  {team.map(member => {
                    const isOnline = onlineIds.has(member.id)
                    return (
                      <div key={member.id} className="px-5 py-3 flex items-center gap-3">
                        <div className="relative"><Avatar name={member.name} image={member.photo_url} /><span className={`absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-white ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`} /></div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800 truncate">{member.name}</p>
                          <p className="text-xs text-slate-400 truncate">{member.job_title || 'Usuário'}</p>
                        </div>
                        <span className={`flex items-center gap-1 text-[11px] font-medium ${isOnline ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}{isOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          {/* v48.47 — Cirurgias no painel.
              Só aparece para quem tem acesso à agenda cirúrgica: nutrição,
              psicologia e clínica não veem cirurgia em tela nenhuma, e um painel
              não pode ser a porta dos fundos dessa regra. */}
          {veCirurgias === true && (
            <section className="grid gap-6 xl:grid-cols-3">
              <div className="bg-white border border-slate-100 rounded-2xl p-5 xl:col-span-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-violet-50 p-2 text-violet-700"><Scissors size={16}/></span>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-800">Cirurgias</h2>
                    <p className="text-xs text-slate-400">Próximos 30 dias</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-100 px-3 py-2.5">
                    <p className="text-xl font-bold text-slate-800">{loading ? '—' : stats.cirurgiasProximas}</p>
                    <p className="text-[11px] text-slate-400">marcadas</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 px-3 py-2.5">
                    <p className="text-xl font-bold text-slate-800">{loading ? '—' : stats.cirurgiasRealizadas}</p>
                    <p className="text-[11px] text-slate-400">no período</p>
                  </div>
                  {/* Sem autorização é o número que muda o dia de alguém: é
                      cirurgia marcada que pode não acontecer. */}
                  <div className={`rounded-xl border px-3 py-2.5 ${stats.cirurgiasSemAutorizacao > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-100'}`}>
                    <p className={`text-xl font-bold ${stats.cirurgiasSemAutorizacao > 0 ? 'text-amber-800' : 'text-slate-800'}`}>
                      {loading ? '—' : stats.cirurgiasSemAutorizacao}
                    </p>
                    <p className={`text-[11px] ${stats.cirurgiasSemAutorizacao > 0 ? 'text-amber-700' : 'text-slate-400'}`}>sem autorização</p>
                  </div>
                  <div className="rounded-xl border border-slate-100 px-3 py-2.5">
                    <p className="text-xl font-bold text-slate-800">
                      {loading ? '—' : stats.cirurgiasValorProximas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-[11px] text-slate-400">valor combinado</p>
                  </div>
                </div>
                <Link href="/cirurgias" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800">
                  Abrir agenda de cirurgias <ChevronRight size={13}/>
                </Link>
              </div>

              <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden xl:col-span-2">
                <PanelHeader title="Próximas cirurgias" subtitle="Em ordem de data" href="/cirurgias"/>
                {cirurgias.length === 0 ? (
                  <EmptyState icon={Scissors} text="Nenhuma cirurgia marcada para os próximos 30 dias"/>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {cirurgias.map(c => (
                      <div key={c.id} className="px-5 py-3 flex items-center gap-3">
                        <div className="w-14 text-center rounded-lg bg-violet-50 py-1.5 text-xs font-bold text-violet-700">
                          {c.data_cirurgia ? format(new Date(c.data_cirurgia + 'T12:00:00'), 'dd/MM') : '—'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800 truncate">{c.paciente_nome}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {[c.procedimento_sigla, c.hospital].filter(Boolean).join(' · ') || 'sem procedimento'}
                          </p>
                        </div>
                        {!c.data_autorizacao && (
                          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">sem autorização</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="bg-white border border-slate-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Movimento de mensagens</h2>
                <p className="text-xs text-slate-400 mt-0.5">Distribuição das mensagens no período selecionado</p>
              </div>
              <span className="text-xs text-slate-400">{stats.messages} no total</span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex">
              <div className="bg-brand-500 transition-all" style={{ width: `${inboundPercent}%` }} />
              <div className="bg-emerald-500 transition-all" style={{ width: `${outboundPercent}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <span className="flex items-center gap-2 text-slate-600"><span className="w-2.5 h-2.5 rounded-full bg-brand-500" />Recebidas: <strong>{stats.inboundMessages}</strong> ({inboundPercent}%)</span>
              <span className="flex items-center gap-2 text-slate-600"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Enviadas: <strong>{stats.outboundMessages}</strong> ({outboundPercent}%)</span>
            </div>
          </section>

          <p className="text-[11px] text-slate-400 text-right pb-2">
            {lastUpdated ? `Atualizado às ${format(lastUpdated, 'HH:mm:ss')} · atualização automática a cada minuto` : 'Carregando dados...'}
          </p>
        </div>
      </main>
    </div>
  )
}

function ActionRow({ icon: Icon, label, value, detail, href, urgent = false }: {
  icon: typeof AlertCircle
  label: string
  value: number
  detail?: string
  href: string
  urgent?: boolean
}) {
  return (
    <Link href={href} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${urgent ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}><Icon size={17} /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {detail && <p className="text-xs text-slate-400 mt-0.5">{detail}</p>}
      </div>
      <span className={`text-lg font-bold ${urgent ? 'text-rose-600' : 'text-slate-700'}`}>{value}</span>
      <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500" />
    </Link>
  )
}

function PanelHeader({ title, subtitle, href }: { title: string; subtitle: string; href?: string }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
      <div><h2 className="text-sm font-semibold text-slate-800">{title}</h2><p className="text-xs text-slate-400 mt-0.5">{subtitle}</p></div>
      {href && <Link href={href} className="text-xs font-semibold text-brand-700 hover:text-brand-800">Ver tudo</Link>}
    </div>
  )
}

function EmptyState({ icon: Icon, text }: { icon: typeof MessageSquare; text: string }) {
  return <div className="h-40 flex flex-col items-center justify-center text-slate-400"><Icon size={25} className="text-slate-300 mb-2" /><p className="text-xs">{text}</p></div>
}

function Avatar({ name, image }: { name: string; image?: string | null }) {
  const initials = (name || '?').split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()
  if (image) return <img src={image} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
  return <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold flex-shrink-0">{initials}</div>
}
