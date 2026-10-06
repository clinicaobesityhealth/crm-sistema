'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, Professional, AgendaSlot, Agendamento } from '@/lib/supabase'
import { useAuth, isSecretaryJobTitle } from '@/lib/AuthContext'
import Sidebar from '@/components/Sidebar'
import {
  ChevronLeft, ChevronRight, Loader2, X, Lock, Unlock, AlertCircle, Info,
  CalendarDays, Users, Ban, CheckCircle2, Phone, ShieldAlert,
  Search, UserPlus, CalendarPlus, Mail, CreditCard, ArrowLeft, BadgeCheck, Stethoscope,
  Video, MapPin, Clock
} from 'lucide-react'
import {
  format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameMonth, isToday, parseISO
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'
import { modalidadeDaConsulta, rotuloModalidade, type Modalidade } from '@/lib/modalidadeConsulta'
import { contemTermo } from '@/lib/texto'
import { buscarAgendamentosMedxCached } from '@/lib/medxAgendamentos'
import { comNomeAtualDoContato } from '@/lib/nomeAtualPaciente'
import ProntuarioPanel from '@/components/ProntuarioPanel'

// ─────────────────────────────────────────────────────────────────────────
// Tipos e helpers locais
// ─────────────────────────────────────────────────────────────────────────

type Holiday = { id: string; data: string; nome: string; abrangencia: 'nacional' | 'municipal' | null; cidade: string | null }

type SlotState = 'disponivel' | 'ocupado' | 'cancelado' | 'bloqueado' | 'indisponivel'

type MainView = 'dia' | 'semana' | 'mes' | 'disponiveis' | 'realizados' | 'cancelados'

// v48.162 — "Com/sem retorno" e "cobrar/não cobrar" só existem no MedX (a tabela
// agendamentos do CRM não guarda isso). MedxInfo é o que a Agenda Médica busca
// ao vivo (via lib/medxAgendamentos.ts) e associa a cada agendamento pelo
// medx_agendamento_id, pra mostrar o mesmo dado que já aparece na aba MedX do
// paciente (ConversationSidePanel) — sem duplicar a lógica de busca/parse.
type MedxInfo = { planoRetorno: string; cobranca: string; modalidade?: string | null }

// v48.164 — modalidade (presencial/online) sempre foi um campo manual (ninguém
// sincronizava do MedX). Agora que já buscamos o agendamento no MedX para saber
// retorno/cobrança, aproveitamos para sugerir a modalidade também quando a
// equipe ainda não marcou manualmente — sem isso, consultas como as da Bruna
// (presencial no MedX) ficavam sem emoji na grade só porque ninguém clicou em
// "Presencial" ainda.
function medxParaModalidade(m?: string | null): Modalidade {
  if (m === 'ONLINE') return 'online'
  if (m === 'PRESENCIAL') return 'presencial'
  return null
}

// Busca, para um conjunto de agendamentos "ocupados" (já confirmados pelo MedX),
// a informação de retorno/cobrança — agrupando por paciente pra não repetir a
// mesma busca no MedX várias vezes quando a pessoa tem mais de uma consulta
// no período visível.
async function carregarMedxInfo(appointments: Agendamento[]): Promise<Map<string, MedxInfo>> {
  const ocupados = appointments.filter(a => (a.status === 'Confirmada' || a.status === 'Realizada') && a.paciente_nome)
  const mapa = new Map<string, MedxInfo>()
  if (ocupados.length === 0) return mapa

  const porPaciente = new Map<string, Agendamento>()
  ocupados.forEach(a => {
    const chave = `${a.paciente_nome}|${a.paciente_telefone || ''}`
    if (!porPaciente.has(chave)) porPaciente.set(chave, a)
  })

  await Promise.all(Array.from(porPaciente.values()).map(async ref => {
    try {
      const { agendamentos: encontrados } = await buscarAgendamentosMedxCached({ nome: ref.paciente_nome, telefone: ref.paciente_telefone })
      encontrados.forEach(e => {
        if (e.medx_agendamento_id) mapa.set(e.medx_agendamento_id, { planoRetorno: e.planoRetorno, cobranca: e.cobranca, modalidade: e.modalidade })
      })
    } catch {}
  }))

  return mapa
}

function fmtHora(t: string) { return t ? t.slice(0, 5) : '' }
function fmtDataStr(d: Date) { return format(d, 'yyyy-MM-dd') }
function fmtDataBR(d: string) { return d ? d.split('-').reverse().join('/') : '' }
function capitalize(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }

// Regra de exibição: um cancelamento sempre "vence" visualmente (equipe precisa ver que
// o horário foi cancelado, mesmo que o slot já tenha voltado a ficar disponível para
// reagendamento). Bloqueio manual só é considerado quando não há agendamento ativo.
function slotState(slot: AgendaSlot, ag?: Agendamento): SlotState {
  if (ag && ag.status === 'Cancelada') return 'cancelado'
  if (ag && (ag.status === 'Confirmada' || ag.status === 'Realizada')) return 'ocupado'
  if (slot.bloqueado) return 'bloqueado'
  if (slot.disponivel) return 'disponivel'
  return 'indisponivel'
}

// Um mesmo horário pode conservar registros cancelados no histórico e depois receber
// um novo agendamento. Nesse caso, a consulta ativa sempre deve prevalecer na grade.
function buildAgendamentoMap(rows: Agendamento[]): Map<string, Agendamento> {
  const map = new Map<string, Agendamento>()
  rows.forEach(agendamento => {
    const current = map.get(agendamento.slot_id)
    if (!current || (current.status === 'Cancelada' && agendamento.status !== 'Cancelada')) {
      map.set(agendamento.slot_id, agendamento)
    }
  })
  return map
}

// Corrige também cancelamentos antigos: se só existem registros cancelados para o
// slot e ele não foi bloqueado manualmente, o horário volta a ficar agendável.
async function releaseCancelledSlots(slots: AgendaSlot[], rows: Agendamento[]) {
  const activeSlotIds = new Set(rows.filter(a => a.status !== 'Cancelada').map(a => a.slot_id))
  const cancelledOnlyIds = Array.from(new Set(
    rows.filter(a => a.status === 'Cancelada' && !activeSlotIds.has(a.slot_id)).map(a => a.slot_id)
  ))
  if (cancelledOnlyIds.length === 0) return

  slots.forEach(slot => {
    if (cancelledOnlyIds.includes(slot.slot_id) && !slot.bloqueado) {
      slot.disponivel = true
      slot.agendamento_id = null
    }
  })

  await supabase.from('agenda_slots').update({ disponivel: true, agendamento_id: null })
    .in('slot_id', cancelledOnlyIds)
    .eq('bloqueado', false)
}

const STATE_STYLES: Record<SlotState, string> = {
  disponivel: 'bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 cursor-pointer',
  // v48.164 — Antes usava a cor da marca (bg-brand-600), que nesta clínica está
  // configurada como um verde bem escuro — de longe parecia preto, e dava pra
  // confundir com "não confirmado". Trocado por um verde fixo e claro, que não
  // depende da cor da marca de cada clínica.
  ocupado: 'bg-emerald-500 border border-emerald-500 text-white hover:bg-emerald-600 cursor-pointer',
  cancelado: 'bg-slate-100 border border-slate-200 text-slate-400 line-through hover:bg-slate-200 cursor-pointer',
  bloqueado: 'bg-amber-100 border border-amber-300 text-amber-800 hover:bg-amber-200 cursor-pointer',
  indisponivel: 'bg-slate-50 border border-slate-100 text-slate-300 cursor-not-allowed',
}

// v48.161 — Dentro de "ocupado" tem uma distinção que importa: o paciente já
// confirmou a consulta pelo link de WhatsApp (patient_confirmed_at) ou ainda
// não? "status === 'Confirmada'" é outra coisa — vem do MedX e só diz que a
// consulta está lá, não que o paciente respondeu ao link. Preto puxa o olho
// pra quem ainda falta confirmar.
// v48.164 — Trocado de preto (bg-slate-900) para vermelho claro, a pedido do
// Jorge: preto demais destacava igual ao "ocupado confirmado" quando a cor da
// marca também saía escura, e vermelho claro é mais intuitivo pra "atenção,
// falta confirmar" do que preto.
const OCUPADO_NAO_CONFIRMADO = 'bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 cursor-pointer'

const STATE_LABELS: Record<SlotState, string> = {
  disponivel: 'Disponível', ocupado: 'Ocupado', cancelado: 'Cancelado', bloqueado: 'Bloqueado', indisponivel: 'Indisponível',
}

// ─────────────────────────────────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────────────────────────────────

export default function AgendaMedicaPage() {
  const { agent, isAdmin } = useAuth()
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [loadingProfs, setLoadingProfs] = useState(true)
  const [mainView, setMainView] = useState<MainView>('dia')
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string>('todos')
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())

  useEffect(() => {
    supabase.from('professionals').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => { setProfessionals(data ?? []); setLoadingProfs(false) })
  }, [])

  // Regra de visibilidade: admin e secretária veem a agenda de todos os
  // profissionais, como sempre foi. Um "usuário comum" (ex: o próprio
  // médico logando com a conta dele) vê só a própria agenda, desde que o
  // e-mail de login dele esteja vinculado ao cadastro do profissional em
  // Configurações -> Config. Agenda. Sem esse vínculo cadastrado, cai no
  // comportamento de sempre (vê tudo) -- não quebra ninguém que ainda não
  // tem o e-mail preenchido lá.
  const isSecretary = isSecretaryJobTitle(agent?.job_title)
  const myProfessional = useMemo(() => {
    if (!agent?.email) return null
    return professionals.find(p => p.email && p.email.trim().toLowerCase() === agent.email.trim().toLowerCase()) || null
  }, [professionals, agent?.email])
  // v48.47 — A brecha do e-mail não vinculado foi fechada.
  //
  // Antes, quem não era admin nem secretária e AINDA não tinha o e-mail
  // vinculado a um profissional caía no "vê tudo". Ou seja: bastava esquecer de
  // preencher um campo em Config. Agenda para a pessoa enxergar a agenda de
  // todos os médicos — o oposto do que a regra queria dizer.
  //
  // Agora a restrição não depende de acerto de cadastro: quem não é admin nem
  // secretária vê só a própria agenda, e se não houver profissional vinculado,
  // não vê agenda nenhuma — com um aviso explicando o que fazer, em vez de uma
  // tela vazia sem explicação.
  const restrictToOwnAgenda = !isAdmin && !isSecretary
  const semVinculo = restrictToOwnAgenda && !myProfessional
  const visibleProfessionals = restrictToOwnAgenda
    ? (myProfessional ? professionals.filter(p => p.id === myProfessional.id) : [])
    : professionals

  useEffect(() => {
    if (restrictToOwnAgenda && myProfessional) setSelectedProfessionalId(myProfessional.id)
  }, [restrictToOwnAgenda, myProfessional])

  function goPrev() {
    if (mainView === 'mes') setSelectedDate(d => subMonths(d, 1))
    else if (mainView === 'semana') setSelectedDate(d => subWeeks(d, 1))
    else setSelectedDate(d => subDays(d, 1))
  }
  function goNext() {
    if (mainView === 'mes') setSelectedDate(d => addMonths(d, 1))
    else if (mainView === 'semana') setSelectedDate(d => addWeeks(d, 1))
    else setSelectedDate(d => addDays(d, 1))
  }
  function goToday() { setSelectedDate(new Date()) }

  function jumpToDay(d: Date, profId?: string) {
    setSelectedDate(d)
    if (profId) setSelectedProfessionalId(profId)
    setMainView('dia')
  }

  const dateLabel = mainView === 'mes'
    ? capitalize(format(selectedDate, "MMMM 'de' yyyy", { locale: ptBR }))
    : mainView === 'semana'
    ? `${format(startOfWeek(selectedDate, { weekStartsOn: 0 }), 'd/MM')} – ${format(endOfWeek(selectedDate, { weekStartsOn: 0 }), 'd/MM/yyyy')}`
    : capitalize(format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR }))

  // Versão curta do rótulo, só pra caber numa linha só no celular (evita que o
  // date-picker nativo "quebre linha" e duplique a informação da data).
  const dateLabelShort = mainView === 'mes'
    ? capitalize(format(selectedDate, "MMM/yyyy", { locale: ptBR }))
    : mainView === 'semana'
    ? `${format(startOfWeek(selectedDate, { weekStartsOn: 0 }), 'd/MM')}–${format(endOfWeek(selectedDate, { weekStartsOn: 0 }), 'd/MM')}`
    : capitalize(format(selectedDate, "EEE, d 'de' MMM", { locale: ptBR }))

  function handleDateInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.value) setSelectedDate(parseISO(e.target.value))
  }

  const showDateNav = mainView !== 'cancelados' && mainView !== 'realizados'

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Agenda Médica</h1>
              <p className="text-xs text-slate-400 mt-0.5">Grade de consultas, horários livres, bloqueios e cancelamentos</p>
            </div>

            <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs font-medium overflow-x-auto">
              {[
                { k: 'dia' as const, label: 'Dia' },
                { k: 'semana' as const, label: 'Semana' },
                { k: 'mes' as const, label: 'Mês' },
                { k: 'disponiveis' as const, label: 'Disponíveis' },
                { k: 'realizados' as const, label: 'Realizados' },
                { k: 'cancelados' as const, label: 'Cancelados' },
              ].map(v => (
                <button key={v.k} onClick={() => setMainView(v.k)}
                  className={clsx('px-3 py-1.5 rounded-md transition-colors whitespace-nowrap', mainView === v.k ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {showDateNav && (
            <div className="flex items-center gap-2 mt-3.5 flex-wrap">
              <button onClick={goPrev} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500"><ChevronLeft size={15}/></button>
              <button onClick={goNext} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500"><ChevronRight size={15}/></button>
              <button onClick={goToday} className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">Hoje</button>

              {/* Desktop/tablet (sm+): rótulo completo + date-picker nativo lado a lado, como sempre foi. */}
              <p className="hidden sm:block text-sm font-medium text-slate-700 mx-1">{dateLabel}</p>
              <input type="date" value={fmtDataStr(selectedDate)}
                onChange={handleDateInputChange}
                className="hidden sm:block ml-auto px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>

              {/* Celular: um único controle compacto (rótulo curto por cima de um
                  input date invisível cobrindo a área toda) — evita a quebra de
                  linha que duplicava a data em 2 lugares. */}
              <div className="sm:hidden ml-auto relative">
                <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap">
                  <CalendarDays size={13} className="text-slate-400"/>
                  {dateLabelShort}
                </span>
                <input type="date" value={fmtDataStr(selectedDate)}
                  onChange={handleDateInputChange}
                  aria-label="Selecionar data"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-0.5">
            {!restrictToOwnAgenda && (
              <button onClick={() => setSelectedProfessionalId('todos')}
                className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0',
                  selectedProfessionalId === 'todos' ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50')}>
                <Users size={12}/> Todos
              </button>
            )}
            {visibleProfessionals.map(p => (
              <button key={p.id} onClick={() => setSelectedProfessionalId(p.id)}
                className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0',
                  selectedProfessionalId === p.id ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50')}>
                {p.nome}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-6">
          {mainView !== 'cancelados' && mainView !== 'realizados' && <Legend/>}

          {loadingProfs ? <LoadingBlock/> : semVinculo ? (
            /* Sem profissional vinculado ao login, a agenda fica vazia. Dizer
               por quê é obrigação: tela em branco sem explicação vira chamado
               de suporte e desconfiança de que o sistema quebrou. */
            <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
              <p className="text-sm font-semibold text-amber-900">Sua agenda ainda não está vinculada</p>
              <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                Você vê apenas a sua própria agenda de consultas, e o seu login ainda não está ligado a
                nenhum profissional cadastrado. Peça a um administrador para abrir
                <strong> Configurações → Config. Agenda</strong> e preencher o seu e-mail no cadastro do
                profissional. Feito isso, a sua agenda aparece aqui.
              </p>
            </div>
          ) : (
            <>
              {mainView === 'dia' && (
                <DayView professionals={visibleProfessionals} selectedProfessionalId={selectedProfessionalId} date={selectedDate}
                  onEscolherProfissional={setSelectedProfessionalId}/>
              )}
              {mainView === 'semana' && (
                <WeekView professionals={visibleProfessionals} selectedProfessionalId={selectedProfessionalId} date={selectedDate} onJump={jumpToDay}/>
              )}
              {mainView === 'mes' && (
                <MonthView professionals={visibleProfessionals} selectedProfessionalId={selectedProfessionalId} date={selectedDate} onJump={(d) => jumpToDay(d)}/>
              )}
              {mainView === 'disponiveis' && (
                <DisponiveisView professionals={visibleProfessionals} selectedProfessionalId={selectedProfessionalId} date={selectedDate}/>
              )}
              {mainView === 'realizados' && (
                <RealizadosView professionals={visibleProfessionals} selectedProfessionalId={selectedProfessionalId}/>
              )}
              {mainView === 'cancelados' && (
                <CanceladosView professionals={visibleProfessionals} selectedProfessionalId={selectedProfessionalId}/>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Pequenos blocos reutilizáveis
// ─────────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex items-center gap-4 flex-wrap mb-4 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200 inline-block"/>Disponível</span>
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"/>Ocupado (paciente confirmou)</span>
      {/* v48.161 — Vermelho claro = o paciente ainda não confirmou pelo link de
          WhatsApp. Antes, "Confirmada" (status do MedX) e "ocupado" eram tratados
          como a mesma coisa na grade, e não tinha como ver de relance quem ainda
          não confirmou de verdade com o paciente. */}
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-50 border border-red-200 inline-block"/>Ocupado (paciente não confirmou)</span>
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100 border border-slate-200 inline-block"/>Cancelado</span>
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block"/>Bloqueado</span>
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-50 border border-slate-100 inline-block"/>Indisponível</span>
    </div>
  )
}

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
      <Loader2 size={16} className="animate-spin mr-2"/>Carregando...
    </div>
  )
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="flex flex-col items-center justify-center h-40 text-center text-sm text-slate-400 px-4">{text}</div>
}

function HolidayBanner({ holidays }: { holidays: Holiday[] }) {
  return (
    <div className="flex flex-col items-center justify-center h-56 text-center bg-slate-100 border border-slate-200 rounded-xl">
      <CalendarDays size={28} className="text-slate-300 mb-2"/>
      {holidays.map(h => (
        <p key={h.id} className="text-sm font-medium text-slate-500">Feriado: {h.nome}{h.cidade ? ` (${h.cidade})` : ''}</p>
      ))}
      <p className="text-xs text-slate-400 mt-1">Não há grade de horários neste dia.</p>
    </div>
  )
}

function SlotChip({ slot, agendamento, onClick, compact, medxInfo }: {
  slot: AgendaSlot; agendamento?: Agendamento; onClick: () => void; compact?: boolean; medxInfo?: MedxInfo
}) {
  const state = slotState(slot, agendamento)
  const disabled = state === 'indisponivel'
  // v48.161 — "Ocupado" se abre em dois: confirmado pelo paciente (verde/brand,
  // como já era) ou ainda não (preto). patient_confirmed_at é quem decide —
  // não o status do MedX, que é outra coisa (ver OCUPADO_NAO_CONFIRMADO acima).
  const confirmadoPeloPaciente = !!agendamento?.patient_confirmed_at
  let title = STATE_LABELS[state]
  if (state === 'bloqueado' && slot.motivo_bloqueio) title += `: ${slot.motivo_bloqueio}`
  // v48.164 — modalidade manual (marcada pela equipe) tem prioridade; na
  // ausência dela, usa a modalidade que o MedX já informa para o agendamento,
  // em vez de ficar sem mostrar nada.
  const modalidade = modalidadeDaConsulta(agendamento) ?? medxParaModalidade(medxInfo?.modalidade)
  if ((state === 'ocupado' || state === 'cancelado') && agendamento) {
    title += ` — ${agendamento.paciente_nome}`
    if (modalidade) title += ` (${rotuloModalidade(modalidade)})`
    if (state === 'ocupado') title += confirmadoPeloPaciente ? ' — paciente confirmou' : ' — paciente ainda não confirmou'
    // v48.162 — mesma informação de retorno/cobrança que já aparece na aba MedX.
    if (medxInfo) title += ` — ${medxInfo.planoRetorno}${medxInfo.cobranca === 'NÃO COBRAR' ? ' — não cobrar' : ''}`
  }

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'w-full rounded-lg px-2 text-left transition-colors', compact ? 'py-1' : 'py-1.5',
        state === 'ocupado' && !confirmadoPeloPaciente ? OCUPADO_NAO_CONFIRMADO : STATE_STYLES[state],
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold">{fmtHora(slot.hora_inicio)}</span>
        {state === 'bloqueado' && <Lock size={10} className="flex-shrink-0"/>}
        {/* v48.24 — Online ou presencial direto no horário da grade. Sem isso,
            saber se a consulta é por vídeo exige abrir uma por uma — e é a
            informação que decide se alguém precisa estar na clínica.
            v48.161 — Emoji em vez do ícone: bate o olho mais rápido num
            quadrado de 24px do que o ícone pequeno batia. */}
        {state === 'ocupado' && modalidade && (
          <span className="text-[11px] leading-none flex-shrink-0">{modalidade === 'online' ? '💻' : '📍'}</span>
        )}
        {state === 'cancelado' && <Ban size={10} className="flex-shrink-0"/>}
      </div>
      {(state === 'ocupado' || state === 'cancelado') && agendamento && (
        <>
          <p className="text-[10px] truncate mt-0.5 opacity-90">{agendamento.paciente_nome}</p>
          {modalidade && (
            <p className="text-[9px] uppercase tracking-wide opacity-75">{rotuloModalidade(modalidade)}</p>
          )}
          {/* v48.162 — Com/sem retorno e cobrar/não cobrar, igual já aparece na aba
              MedX do paciente. Só "não cobrar" é destacado — "cobrar" é o caso comum
              e escrever isso em toda consulta só poluiria o card. */}
          {state === 'ocupado' && medxInfo && (
            <p className="text-[9px] uppercase tracking-wide opacity-75">
              {medxInfo.planoRetorno}{medxInfo.cobranca === 'NÃO COBRAR' ? ' · não cobrar' : ''}
            </p>
          )}
        </>
      )}
      {state === 'bloqueado' && slot.motivo_bloqueio && (
        <p className="text-[10px] truncate mt-0.5 opacity-80">{slot.motivo_bloqueio}</p>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Modais de ação (bloquear / desbloquear / detalhes)
// ─────────────────────────────────────────────────────────────────────────

// A escolha de online/presencial, dentro do cartão da consulta.
//
// Grava na hora, sem botão de salvar: é um campo só, e pedir confirmação para
// marcar "online" seria cerimônia demais para o que a secretária faz dezenas de
// vezes por dia.
function EscolherModalidade({ agendamento, editavel, onTrocou, sugestaoMedx }: {
  agendamento: Agendamento; editavel: boolean; onTrocou: () => void; sugestaoMedx?: Modalidade
}) {
  const [salvando, setSalvando] = useState<Modalidade>(null)
  const [erro, setErro] = useState('')
  const atual = modalidadeDaConsulta(agendamento)
  // v48.164 — atual é o que está gravado no banco (manual); atualExibicao é só
  // pra decidir o que mostrar/destacar quando ninguém marcou ainda, usando o
  // que o MedX já diz. Clicar continua gravando a partir de `atual` de verdade,
  // então um clique em cima da sugestão simplesmente confirma ela no banco.
  const atualExibicao = atual ?? sugestaoMedx ?? null

  async function marcar(m: Exclude<Modalidade, null>) {
    if (salvando) return
    setSalvando(m); setErro('')
    // Clicar no que já está marcado desmarca — é como se volta atrás de um
    // clique errado sem precisar de um terceiro botão "limpar".
    const novo = atual === m ? null : m
    const { error } = await supabase.from('agendamentos').update({ modalidade: novo }).eq('id', agendamento.id)
    setSalvando(null)
    if (error) { setErro('Não foi possível salvar. A coluna "modalidade" já existe no banco?'); return }
    onTrocou()
  }

  if (!editavel) {
    if (!atualExibicao) return null
    return (
      <span className={clsx('ml-2 inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full',
        atualExibicao === 'online' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700')}>
        {atualExibicao === 'online' ? <Video size={12}/> : <MapPin size={12}/>} {rotuloModalidade(atualExibicao)}
      </span>
    )
  }

  const botao = (m: Exclude<Modalidade, null>, cor: string) => clsx(
    'inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors',
    atualExibicao === m ? cor : 'border-slate-200 text-slate-400 hover:bg-slate-50')

  return (
    <div className="ml-2 inline-flex flex-col gap-1 align-middle">
      <div className="inline-flex items-center gap-1.5">
        <button type="button" onClick={() => marcar('presencial')} disabled={!!salvando}
          title="Marcar como presencial"
          className={botao('presencial', 'bg-emerald-50 border-emerald-200 text-emerald-700')}>
          {salvando === 'presencial' ? <Loader2 size={11} className="animate-spin"/> : <MapPin size={11}/>} Presencial
        </button>
        <button type="button" onClick={() => marcar('online')} disabled={!!salvando}
          title="Marcar como online"
          className={botao('online', 'bg-violet-50 border-violet-200 text-violet-700')}>
          {salvando === 'online' ? <Loader2 size={11} className="animate-spin"/> : <Video size={11}/>} Online
        </button>
        {erro && <span className="text-[11px] text-red-600">{erro}</span>}
      </div>
      {/* v48.164 — quando ninguém marcou manualmente ainda, mas o MedX já diz
          qual é a modalidade, o botão correspondente já aparece destacado —
          esse textinho explica o porquê, pra não parecer que alguém já clicou. */}
      {!atual && sugestaoMedx && (
        <span className="text-[10px] text-slate-400">Sugestão do MedX — clique para confirmar</span>
      )}
    </div>
  )
}

function SlotActionModal({ slot, agendamento, professionals, onClose, onChanged, medxInfo }: {
  slot: AgendaSlot; agendamento?: Agendamento; professionals: Professional[]; onClose: () => void; onChanged: () => void; medxInfo?: MedxInfo
}) {
  const state = slotState(slot, agendamento)
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showAgendar, setShowAgendar] = useState(false)
  const [showProntuario, setShowProntuario] = useState(false)
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [cancelMotivo, setCancelMotivo] = useState('')
  const [cancelSaving, setCancelSaving] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const professional = professionals.find(p => p.id === slot.professional_id)

  const [showRemarcarForm, setShowRemarcarForm] = useState(false)
  const [remarcarProfId, setRemarcarProfId] = useState('')
  const [remarcarData, setRemarcarData] = useState('')
  const [remarcarSlots, setRemarcarSlots] = useState<AgendaSlot[]>([])
  const [loadingRemarcarSlots, setLoadingRemarcarSlots] = useState(false)
  const [remarcandoSlotId, setRemarcandoSlotId] = useState<string | null>(null)
  const [remarcarError, setRemarcarError] = useState('')

  function abrirRemarcar() {
    setRemarcarError('')
    setRemarcarProfId(slot.professional_id || '')
    setRemarcarData(slot.data || '')
    setShowRemarcarForm(true)
  }

  useEffect(() => {
    if (!showRemarcarForm || !remarcarProfId || !remarcarData) { setRemarcarSlots([]); return }
    setLoadingRemarcarSlots(true)
    supabase.from('agenda_slots').select('*')
      .eq('professional_id', remarcarProfId)
      .eq('data', remarcarData)
      .eq('disponivel', true)
      .eq('bloqueado', false)
      .order('hora_inicio')
      .then(({ data }) => { setRemarcarSlots(data ?? []); setLoadingRemarcarSlots(false) })
  }, [showRemarcarForm, remarcarProfId, remarcarData])

  async function handleRemarcar(novoSlot: AgendaSlot) {
    if (!agendamento) return
    setRemarcandoSlotId(novoSlot.slot_id); setRemarcarError('')
    try {
      const resp = await fetch(WH_REMARCAR_CONSULTA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agendamento_id: agendamento.id, novo_slot_id: novoSlot.slot_id }),
      })
      const data = await resp.json().catch(() => null)
      if (!resp.ok || data?.success === false) {
        setRemarcarError(data?.message || data?.error || 'Não foi possível remarcar esta consulta.')
        setRemarcandoSlotId(null)
        return
      }
      onChanged()
    } catch {
      setRemarcarError('Não foi possível remarcar (falha de conexão). Tente novamente.')
      setRemarcandoSlotId(null)
    }
  }

  async function handleBlock() {
    setSaving(true); setError('')
    // v48.50 — Pelo slot_id, que é a chave que o resto da agenda usa. O "id"
    // nem sempre vem preenchido, e um update que não acha a linha não dá erro:
    // simplesmente não faz nada, e a tela fingia que tinha feito.
    const { data: mudou, error: err } = await supabase.from('agenda_slots').update({
      bloqueado: true, motivo_bloqueio: motivo.trim() || null, disponivel: false, bloqueado_em: new Date().toISOString(),
    }).eq('slot_id', slot.slot_id).select('slot_id')
    if (!err && (!mudou || mudou.length === 0)) { setSaving(false); setError('O horário não foi encontrado para bloquear. Atualize a tela e tente de novo.'); return }
    setSaving(false)
    if (err) { setError('Não foi possível bloquear este horário.'); return }
    onChanged()
  }

  async function handleCancelConsulta() {
    if (!agendamento) return
    setCancelSaving(true); setCancelError('')
    try {
      const resp = await fetch(WH_CANCELAR_CONSULTA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agendamento_id: agendamento.id, motivo: cancelMotivo.trim() || null }),
      })
      const data = await resp.json().catch(() => null)
      if (!resp.ok || !data?.success) {
        setCancelError(data?.error || 'Não foi possível cancelar esta consulta. Tente novamente.')
        setCancelSaving(false)
        return
      }
      const { error: releaseError } = await supabase.from('agenda_slots').update({
        disponivel: true,
        agendamento_id: null,
      }).eq('slot_id', slot.slot_id).eq('bloqueado', false)
      if (releaseError) {
        setCancelError('A consulta foi cancelada, mas o horário não pôde ser liberado. Atualize a agenda e tente novamente.')
        setCancelSaving(false)
        return
      }
      setCancelSaving(false)
      onChanged()
    } catch {
      setCancelError('Não foi possível cancelar esta consulta (falha de conexão). Tente novamente.')
      setCancelSaving(false)
    }
  }

  // v48.50 — Desbloquear não funcionava.
  //
  // O update procurava o horário pelo campo "id", e a agenda inteira trabalha
  // com "slot_id". Quando o "id" não batia, o banco não achava nada, não
  // reclamava, e a tela fechava como se tivesse desbloqueado. O horário ficava
  // amarelo para sempre.
  //
  // Agora vai pelo slot_id e confere quantas linhas mudaram: se nenhuma, diz.
  // E se o horário já tiver consulta marcada, ele é desbloqueado sem virar
  // "livre" — liberar em cima de um paciente seria pior que não desbloquear.
  async function handleUnblock() {
    setSaving(true); setError('')
    const { data: mudou, error: err } = await supabase.from('agenda_slots').update({
      bloqueado: false, motivo_bloqueio: null, bloqueado_em: null, disponivel: !slot.agendamento_id,
    }).eq('slot_id', slot.slot_id).select('slot_id')
    setSaving(false)
    if (err) { setError('Não foi possível desbloquear este horário: ' + err.message); return }
    if (!mudou || mudou.length === 0) { setError('O horário não foi encontrado para desbloquear. Atualize a tela e tente de novo.'); return }
    onChanged()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{fmtHora(slot.hora_inicio)} – {fmtHora(slot.hora_fim)}</h2>
            <p className="text-xs text-slate-400">{slot.profissional_nome} · {fmtDataBR(slot.data)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={18}/></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>{error}
            </div>
          )}

          {(state === 'ocupado' || state === 'cancelado') && agendamento && (
            <div className="space-y-2.5">
              {/* v48.161 — Isto aqui tinha virado uma fonte de confusão: o selo
                  mostrava agendamento.status (ex.: "Confirmada"), que é o status
                  do MedX — só diz que a consulta está lá, não que o PACIENTE
                  confirmou. Agora o selo grande é sobre o paciente de verdade
                  (patient_confirmed_at / patient_declined_at, gravados pelo
                  link de confirmação), e o status do MedX vira um textinho
                  pequeno no canto, só pra quem precisa conferir a sincronização. */}
              <div className="flex items-center justify-between gap-2">
                <span className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full',
                  state === 'cancelado' ? 'bg-slate-100 text-slate-500'
                    : agendamento.patient_confirmed_at ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500')}>
                  {state === 'cancelado' ? <Ban size={12}/>
                    : agendamento.patient_confirmed_at ? <CheckCircle2 size={12}/>
                    : <Clock size={12}/>}
                  {state === 'cancelado' ? agendamento.status
                    : agendamento.patient_confirmed_at ? 'Paciente confirmou'
                    : agendamento.patient_declined_at ? 'Paciente respondeu que não vem'
                    : 'Paciente ainda não confirmou'}
                </span>
                {state === 'ocupado' && (
                  <span className="text-[10px] text-slate-400 flex-shrink-0">
                    {agendamento.status === 'Confirmada' || agendamento.status === 'Realizada' ? 'MEDX ok' : `MEDX: ${agendamento.status}`}
                  </span>
                )}
              </div>
              {/* v48.31 — Online ou presencial.
                  O selo existia desde a v48.24, mas nunca aparecia: a informação
                  não estava em lugar nenhum, nem vinha do MedX. Agora quem sabe
                  da consulta marca aqui, em um clique, e o cartão da grade passa
                  a mostrar. */}
              <EscolherModalidade
                agendamento={agendamento}
                editavel={state === 'ocupado'}
                onTrocou={onChanged}
                sugestaoMedx={medxParaModalidade(medxInfo?.modalidade)}/>
              {/* v48.162 — Com/sem retorno e cobrar/não cobrar, vindos do MedX (mesma
                  fonte e lógica da aba MedX do paciente, só que já aplicada aqui direto
                  na Agenda Médica, pra não precisar abrir o contato pra ver). */}
              {state === 'ocupado' && medxInfo && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {medxInfo.planoRetorno}
                  </span>
                  <span className={clsx('inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full',
                    medxInfo.cobranca === 'NÃO COBRAR' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>
                    {medxInfo.cobranca}
                  </span>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-slate-400 mb-0.5">Paciente</p>
                <p className="text-sm text-slate-800 font-medium">{agendamento.paciente_nome}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400 mb-0.5 flex items-center gap-1"><Phone size={11}/> Telefone</p>
                <p className="text-sm text-slate-700">{agendamento.paciente_telefone || '—'}</p>
              </div>
              <p className="text-xs text-slate-400">
                Duração: {agendamento.duracao_min} min{agendamento.origem ? ` · Origem: ${agendamento.origem}` : ''}
              </p>
              {/* v48.163 — Prontuário completo (histórico + resumo por IA), direto daqui,
                  sem precisar abrir o contato nem o MedX. */}
              {state === 'ocupado' && (
                <button type="button" onClick={() => setShowProntuario(true)}
                  className="flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors">
                  <Stethoscope size={13}/> Ver prontuário
                </button>
              )}

              {state === 'cancelado' && agendamento.motivo_cancelamento && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-0.5">Motivo do cancelamento</p>
                  <p className="text-sm text-slate-700">{agendamento.motivo_cancelamento}</p>
                </div>
              )}

              {state === 'cancelado' && (
                <p className="text-[11px] text-slate-400 italic">
                  Reagendamentos são feitos pelo fluxo normal de atendimento — esta tela é só consulta.
                </p>
              )}

              {state === 'ocupado' && !showCancelForm && !showRemarcarForm && (
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <button onClick={abrirRemarcar}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-medium rounded-lg transition-colors">
                    <CalendarPlus size={14}/> Remarcar consulta
                  </button>
                  <button onClick={() => setShowCancelForm(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-lg transition-colors">
                    <Ban size={14}/> Cancelar consulta
                  </button>
                </div>
              )}

              {state === 'ocupado' && showRemarcarForm && (
                <div className="pt-2 border-t border-slate-100 space-y-2.5">
                  {remarcarError && (
                    <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>{remarcarError}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <select value={remarcarProfId} onChange={e => setRemarcarProfId(e.target.value)}
                      className="text-xs border border-slate-200 rounded-md px-2 py-1.5 flex-1 min-w-0">
                      <option value="">Selecione o profissional</option>
                      {professionals.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                    <input type="date" value={remarcarData} onChange={e => setRemarcarData(e.target.value)}
                      className="text-xs border border-slate-200 rounded-md px-2 py-1.5"/>
                  </div>
                  {loadingRemarcarSlots ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                      <Loader2 size={12} className="animate-spin"/> Buscando horários...
                    </div>
                  ) : (!remarcarProfId || !remarcarData) ? (
                    <p className="text-xs text-slate-400 py-1">Selecione profissional e data.</p>
                  ) : remarcarSlots.length === 0 ? (
                    <p className="text-xs text-slate-400 py-1">Nenhum horário disponível nesta data.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {remarcarSlots.map(s => (
                        <button key={s.slot_id} disabled={!!remarcandoSlotId} onClick={() => handleRemarcar(s)}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 flex items-center gap-1">
                          {remarcandoSlotId === s.slot_id && <Loader2 size={10} className="animate-spin"/>}
                          {fmtHora(s.hora_inicio)}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setShowRemarcarForm(false); setRemarcarError('') }} disabled={!!remarcandoSlotId}
                    className="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 text-sm font-medium rounded-lg transition-colors">
                    Voltar
                  </button>
                </div>
              )}

              {state === 'ocupado' && showCancelForm && (
                <div className="pt-2 border-t border-slate-100 space-y-2.5">
                  {cancelError && (
                    <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>{cancelError}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Motivo do cancelamento</label>
                    <textarea value={cancelMotivo} onChange={e => setCancelMotivo(e.target.value)} rows={2}
                      placeholder="Ex: Paciente desmarcou, imprevisto, remarcação solicitada..."
                      className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"/>
                    <p className="text-[11px] text-slate-400 mt-1">Fica registrado para acompanhamento futuro do relacionamento com o paciente.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowCancelForm(false); setCancelError('') }} disabled={cancelSaving}
                      className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 text-sm font-medium rounded-lg transition-colors">
                      Voltar
                    </button>
                    <button onClick={handleCancelConsulta} disabled={cancelSaving}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                      {cancelSaving ? <Loader2 size={14} className="animate-spin"/> : <Ban size={14}/>} Confirmar cancelamento
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {state === 'indisponivel' && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-sm">
              <Info size={14} className="flex-shrink-0 mt-0.5"/> Este horário não está disponível para agendamento.
            </div>
          )}

          {state === 'bloqueado' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                <Lock size={14} className="flex-shrink-0 mt-0.5"/>
                <div>
                  <p className="font-medium">Horário bloqueado manualmente</p>
                  {slot.motivo_bloqueio && <p className="mt-0.5">{slot.motivo_bloqueio}</p>}
                  {slot.bloqueado_em && (
                    <p className="mt-1 text-xs text-amber-600">Desde {format(parseISO(slot.bloqueado_em), "d/MM/yyyy 'às' HH:mm")}</p>
                  )}
                </div>
              </div>
              <button onClick={handleUnblock} disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin"/> : <Unlock size={14}/>} Desbloquear horário
              </button>
            </div>
          )}

          {state === 'disponivel' && (
            <div className="space-y-3">
              <button onClick={() => setShowAgendar(true)} disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                <CalendarPlus size={14}/> Agendar paciente
              </button>
              <div className="pt-1 border-t border-slate-100">
                <p className="text-sm text-slate-600 mt-2">Ou, se preferir, bloqueie este horário para impedir novos agendamentos.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Motivo do bloqueio (opcional, mas recomendado)</label>
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                  placeholder="Ex: Reunião, folga, procedimento externo..."
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"/>
              </div>
              <button onClick={handleBlock} disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin"/> : <Lock size={14}/>} Bloquear este horário
              </button>
            </div>
          )}

          {state === 'cancelado' && slot.disponivel && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <p className="text-sm text-slate-600">Este horário voltou a ficar livre após o cancelamento. Você pode agendar outro paciente ou bloqueá-lo se necessário.</p>
              <button onClick={() => setShowAgendar(true)} disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                <CalendarPlus size={14}/> Agendar paciente
              </button>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Motivo do bloqueio (opcional)</label>
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"/>
              </div>
              <button onClick={handleBlock} disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin"/> : <Lock size={14}/>} Bloquear este horário
              </button>
            </div>
          )}
        </div>
      </div>

      {showAgendar && professional && (
        <AgendarModal
          slot={slot}
          professional={professional}
          onClose={() => setShowAgendar(false)}
          onScheduled={() => { setShowAgendar(false); onChanged() }}
        />
      )}

      {showProntuario && agendamento && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Prontuário</h2>
                <p className="text-xs text-slate-400">{agendamento.paciente_nome}</p>
              </div>
              <button onClick={() => setShowProntuario(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={18}/></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ProntuarioPanel nome={agendamento.paciente_nome} telefone={agendamento.paciente_telefone}/>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Modal de agendamento manual (busca paciente existente ou cadastra novo,
// cria a ficha/atendimento no MedX quando necessário, e grava no CRM).
// ─────────────────────────────────────────────────────────────────────────

// Contrato do webhook n8n que faz a ponte com o MedX (login, criação de
// ficha de paciente se for novo, criação do atendimento) e grava o retorno
// no Supabase (agendamentos + agenda_slots). Ver workflow "Agendar Consulta".
const N8N_AGENDAR_WEBHOOK = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-agendar-consulta'
const WH_CANCELAR_CONSULTA = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-cancelar-consulta'
const WH_REMARCAR_CONSULTA = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-remarcar-consulta'

type PacienteBusca = {
  id: string
  full_name: string
  phone: string | null
  cpf: string | null
  medx_id: string | null
}

function AgendarModal({ slot, professional, onClose, onScheduled }: {
  slot: AgendaSlot; professional: Professional; onClose: () => void; onScheduled: () => void
}) {
  const [step, setStep] = useState<'busca' | 'novo' | 'confirmar'>('busca')
  const [busca, setBusca] = useState('')
  // v48.153 — antes buscava no Supabase com `.ilike()`, que não ignora acento
  // (Postgres compara "José" ≠ "jose") nem as variações de grafia de nome
  // próprio (Xavier/Chavier). Contatos já resolve isso carregando a lista uma
  // vez e filtrando no cliente com contemTermo — aqui é o mesmo padrão, só
  // que a lista carrega quando o modal abre, não a cada tecla digitada.
  const [todosContatos, setTodosContatos] = useState<PacienteBusca[]>([])
  const [carregandoContatos, setCarregandoContatos] = useState(true)
  const [selecionado, setSelecionado] = useState<PacienteBusca | null>(null)

  // Dados do paciente novo (ou complementados de um existente sem alguns campos)
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [cpf, setCpf] = useState('')
  const [nascimento, setNascimento] = useState('')
  const [email, setEmail] = useState('')

  const [comRetorno, setComRetorno] = useState(false)
  const [modalidade, setModalidade] = useState<string>(professional.modalidade?.[0] || 'Presencial')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Busca de dados existentes no MedX (evita perguntar de novo pro paciente o que ele já informou lá)
  const [medxBuscando, setMedxBuscando] = useState(false)
  const [medxBuscado, setMedxBuscado] = useState(false)
  const [medxEncontradoId, setMedxEncontradoId] = useState<string | null>(null)

  async function buscarNoMedx() {
    if (!nome.trim() && !telefone.trim() && !cpf.trim()) return
    setMedxBuscando(true)
    try {
      const resp = await fetch('/api/medx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), telefone: telefone.trim(), cpf: cpf.trim() }),
      })
      const json = await resp.json().catch(() => ({}))
      const pac = json?.paciente
      if (pac?.resultado === 'encontrado') {
        if (!nome.trim() && pac.nome) setNome(pac.nome)
        if (pac.celular) setTelefone(pac.celular)
        if (pac.cpf) setCpf(pac.cpf)
        if (pac.nascimento) setNascimento(String(pac.nascimento).slice(0, 10))
        if (pac.email) setEmail(pac.email)
        setMedxEncontradoId(pac.Id_do_Cliente ? String(pac.Id_do_Cliente) : null)
      } else {
        setMedxEncontradoId(null)
      }
    } catch {
      // busca no MedX é só uma ajuda pra pré-preencher — se falhar, segue o cadastro manual normalmente
    } finally {
      setMedxBuscando(false)
      setMedxBuscado(true)
    }
  }

  useEffect(() => {
    // v48.153 — mesmo limite usado em Contatos (lib/texto.ts explica o porquê
    // de carregar bastante coisa: quem não é atendido há tempo também precisa
    // aparecer na busca).
    supabase.from('contacts')
      .select('id, full_name, phone, cpf, medx_id')
      .order('full_name')
      .limit(2000)
      .then(({ data }) => {
        setTodosContatos((data as PacienteBusca[]) ?? [])
        setCarregandoContatos(false)
      })
  }, [])

  const buscando = carregandoContatos
  const resultados = useMemo(() => {
    const q = busca.trim()
    if (q.length < 2) return []
    return todosContatos
      .filter(p => contemTermo(q, p.full_name, p.phone, p.cpf))
      .slice(0, 10)
  }, [busca, todosContatos])

  function escolherExistente(p: PacienteBusca) {
    setSelecionado(p)
    setNome(p.full_name || '')
    setTelefone(p.phone || '')
    setCpf(p.cpf || '')
    setMedxEncontradoId(p.medx_id || null)
    setMedxBuscado(false)
    setStep('confirmar')
  }

  function comecarNovoCadastro() {
    setSelecionado(null)
    setNome(busca && !busca.match(/\d/) ? busca : '')
    setTelefone(busca && busca.match(/\d/) ? busca : '')
    setCpf(''); setNascimento(''); setEmail('')
    setMedxEncontradoId(null); setMedxBuscado(false)
    setStep('novo')
  }

  const modalidades = professional.modalidade?.length ? professional.modalidade : ['Presencial']

  async function handleConfirmar() {
    if (!nome.trim() || !telefone.trim()) { setError('Nome e telefone são obrigatórios.'); return }
    if (!selecionado && !cpf.trim() && !medxEncontradoId) { setError('CPF é obrigatório para criar a ficha no MedX (ou busque o cadastro que já existe no MedX).'); return }
    setSaving(true); setError('')
    let createdManualSlot = false
    try {
      const isManualSlot = slot.slot_id.startsWith('avulso_')
      if (isManualSlot) {
        const { data: existing } = await supabase.from('agenda_slots')
          .select('slot_id, disponivel, agendamento_id').eq('slot_id', slot.slot_id).maybeSingle()
        if (existing && (!existing.disponivel || existing.agendamento_id)) {
          setError('Este horário avulso já está ocupado. Escolha outro horário.')
          setSaving(false)
          return
        }
        if (!existing) {
          const { error: slotError } = await supabase.from('agenda_slots').insert({
            slot_id: slot.slot_id,
            professional_id: slot.professional_id,
            id_medx: slot.id_medx,
            profissional_nome: slot.profissional_nome || professional.nome,
            data: slot.data,
            hora_inicio: slot.hora_inicio,
            hora_fim: slot.hora_fim,
            disponivel: true,
            especialidade: professional.especialidade || null,
            agendamento_id: null,
            id_tipo_consulta: null,
            bloqueado: false,
            motivo_bloqueio: null,
            bloqueado_em: null,
          })
          if (slotError) {
            setError('Não foi possível criar o horário avulso na agenda: ' + slotError.message)
            setSaving(false)
            return
          }
          createdManualSlot = true
        }
      }
      const resp = await fetch(N8N_AGENDAR_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_id: slot.slot_id,
          professional_id: slot.professional_id,
          id_medx: slot.id_medx,
          data: slot.data,
          hora_inicio: slot.hora_inicio,
          hora_fim: slot.hora_fim,
          contact_id: selecionado?.id ?? null,
          medx_id: selecionado?.medx_id ?? medxEncontradoId ?? null,
          paciente: { nome: nome.trim(), telefone: telefone.trim(), cpf: cpf.trim() || null, data_nascimento: nascimento || null, email: email.trim() || null },
          com_retorno: comRetorno,
          modalidade,
          horario_avulso: slot.slot_id.startsWith('avulso_'),
        }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || json?.success === false) {
        if (createdManualSlot) await supabase.from('agenda_slots').delete().eq('slot_id', slot.slot_id).is('agendamento_id', null)
        setError(json?.error || 'Não foi possível concluir o agendamento. Tente novamente.')
        setSaving(false)
        return
      }
      onScheduled()
    } catch (e) {
      if (createdManualSlot) await supabase.from('agenda_slots').delete().eq('slot_id', slot.slot_id).is('agendamento_id', null)
      setError('Não foi possível falar com o servidor de agendamento. Tente novamente em instantes.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {step !== 'busca' && (
              <button onClick={() => { setError(''); setStep('busca') }} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400">
                <ArrowLeft size={16}/>
              </button>
            )}
            <div>
              <h2 className="text-base font-semibold text-slate-800">Agendar paciente</h2>
              <p className="text-xs text-slate-400">{professional.nome} · {fmtDataBR(slot.data)} às {fmtHora(slot.hora_inicio)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={18}/></button>
        </div>

        <div className="px-5 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>{error}
            </div>
          )}

          {step === 'busca' && (
            <div className="space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                <input autoFocus type="text" value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Nome, telefone ou CPF do paciente..."
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>

              {buscando && <p className="text-xs text-slate-400 px-1">Buscando...</p>}

              {!buscando && busca.trim().length >= 2 && resultados.length === 0 && (
                <p className="text-xs text-slate-400 px-1">Nenhum paciente encontrado com esse termo.</p>
              )}

              {resultados.length > 0 && (
                <div className="space-y-1.5">
                  {resultados.map(p => (
                    <button key={p.id} onClick={() => escolherExistente(p)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 rounded-lg text-left transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {(p.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{p.full_name}</p>
                        <p className="text-xs text-slate-400 truncate">{p.phone || 'sem telefone'}</p>
                      </div>
                      {p.medx_id ? (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full flex-shrink-0"><BadgeCheck size={11}/> MedX</span>
                      ) : (
                        <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full flex-shrink-0">sem MedX</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <button onClick={comecarNovoCadastro}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-dashed border-slate-300 hover:border-brand-400 hover:bg-brand-50/50 text-slate-500 hover:text-brand-700 text-sm font-medium rounded-lg transition-colors">
                <UserPlus size={14}/> Cadastrar novo paciente
              </button>
            </div>
          )}

          {step === 'novo' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-xs">
                <Info size={13} className="flex-shrink-0 mt-0.5"/> Paciente novo — a ficha será criada no MedX e no CRM ao confirmar.
              </div>

              <button type="button" onClick={buscarNoMedx} disabled={medxBuscando || (!nome.trim() && !telefone.trim() && !cpf.trim())}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-brand-300 hover:bg-brand-50/50 disabled:opacity-50 text-brand-700 text-xs font-medium rounded-lg transition-colors">
                {medxBuscando ? <Loader2 size={12} className="animate-spin"/> : <Stethoscope size={12}/>}
                {medxBuscando ? 'Buscando no MedX...' : 'Já tem cadastro no MedX? Buscar e preencher automaticamente'}
              </button>
              {medxBuscado && medxEncontradoId && (
                <div className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-xs">
                  <BadgeCheck size={13} className="flex-shrink-0"/> Cadastro encontrado no MedX — dados preenchidos abaixo, confira antes de continuar.
                </div>
              )}
              {medxBuscado && !medxEncontradoId && (
                <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-xs">
                  <Info size={13} className="flex-shrink-0"/> Nada encontrado no MedX com esses dados — preencha manualmente.
                </div>
              )}

              <PacienteForm nome={nome} setNome={setNome} telefone={telefone} setTelefone={setTelefone}
                cpf={cpf} setCpf={setCpf} nascimento={nascimento} setNascimento={setNascimento} email={email} setEmail={setEmail}/>
              <button onClick={() => { if (!nome.trim() || !telefone.trim() || (!cpf.trim() && !medxEncontradoId)) { setError('Nome, telefone e CPF são obrigatórios (ou busque o cadastro no MedX).'); return }; setError(''); setStep('confirmar') }}
                className="w-full px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors">
                Continuar
              </button>
            </div>
          )}

          {step === 'confirmar' && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
                <p className="text-sm font-medium text-slate-800">{nome}</p>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><Phone size={10}/>{telefone}{cpf ? ` · CPF ${cpf}` : ''}</p>
                {(selecionado?.medx_id || medxEncontradoId) && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full mt-1.5"><BadgeCheck size={11}/> Já vinculado ao MedX</span>
                )}
              </div>

              {selecionado && !cpf.trim() && !medxEncontradoId && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs">
                    <AlertCircle size={13} className="flex-shrink-0 mt-0.5"/> O cadastro desse paciente está incompleto (falta CPF) — complete abaixo ou busque no MedX para não precisar perguntar de novo.
                  </div>
                  <button type="button" onClick={buscarNoMedx} disabled={medxBuscando}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-brand-300 hover:bg-brand-50/50 disabled:opacity-50 text-brand-700 text-xs font-medium rounded-lg transition-colors">
                    {medxBuscando ? <Loader2 size={12} className="animate-spin"/> : <Stethoscope size={12}/>}
                    {medxBuscando ? 'Buscando no MedX...' : 'Buscar cadastro no MedX'}
                  </button>
                  {medxBuscado && !medxEncontradoId && (
                    <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-xs">
                      <Info size={13} className="flex-shrink-0"/> Nada encontrado no MedX — preencha o CPF manualmente abaixo.
                    </div>
                  )}
                </div>
              )}

              {(!selecionado || !cpf.trim()) && (
                <PacienteForm nome={nome} setNome={setNome} telefone={telefone} setTelefone={setTelefone}
                  cpf={cpf} setCpf={setCpf} nascimento={nascimento} setNascimento={setNascimento} email={email} setEmail={setEmail} compact/>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Tipo de consulta</label>
                <div className="flex gap-2">
                  {[{ v: false, label: 'Consulta (paga)' }, { v: true, label: 'Retorno (não pago)' }].map(o => (
                    <button key={String(o.v)} type="button" onClick={() => setComRetorno(o.v)}
                      className={clsx('flex-1 py-2 text-xs font-semibold rounded-lg border-2 transition-colors',
                        comRetorno === o.v ? 'bg-brand-50 border-brand-500 text-brand-700' : 'bg-white border-slate-200 text-slate-400')}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {modalidades.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Modalidade</label>
                  <div className="flex gap-2">
                    {modalidades.map(m => (
                      <button key={m} type="button" onClick={() => setModalidade(m)}
                        className={clsx('flex-1 py-2 text-xs font-semibold rounded-lg border-2 transition-colors',
                          modalidade === m ? 'bg-brand-50 border-brand-500 text-brand-700' : 'bg-white border-slate-200 text-slate-400')}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={handleConfirmar} disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {saving ? <Loader2 size={14} className="animate-spin"/> : <CalendarPlus size={14}/>}
                {saving ? 'Agendando...' : 'Confirmar agendamento'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PacienteForm({ nome, setNome, telefone, setTelefone, cpf, setCpf, nascimento, setNascimento, email, setEmail, compact }: {
  nome: string; setNome: (v: string) => void
  telefone: string; setTelefone: (v: string) => void
  cpf: string; setCpf: (v: string) => void
  nascimento: string; setNascimento: (v: string) => void
  email: string; setEmail: (v: string) => void
  compact?: boolean
}) {
  return (
    <div className="space-y-2.5">
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Nome completo *</label>
        <input type="text" value={nome} onChange={e => setNome(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1 flex items-center gap-1"><Phone size={10}/> Telefone *</label>
          <input type="text" value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(11) 99999-9999"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1 flex items-center gap-1"><CreditCard size={10}/> CPF *</label>
          <input type="text" value={cpf} onChange={e => setCpf(e.target.value)} placeholder="000.000.000-00"
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Nascimento</label>
          <input type="date" value={nascimento} onChange={e => setNascimento(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1 flex items-center gap-1"><Mail size={10}/> Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
      </div>
    </div>
  )
}

// v48.31 — Bloquear a agenda de UM profissional, e não o dia inteiro da clínica.
//
// Antes, o que era bloqueado dependia do filtro que estava no alto da tela: com
// "todos" selecionado — que é como a grade costuma ficar — o bloqueio pegava
// todos os profissionais do dia. Quem queria fechar a tarde de um médico
// fechava a agenda da clínica inteira, e só descobria depois.
//
// Agora a escolha é feita aqui dentro, explícita, com duas perguntas:
// de quem, e de que horas a que horas.
function DayBlockModal({ dateStr, professionals, preSelecionados, onClose, onChanged }: {
  dateStr: string
  professionals: Professional[]
  preSelecionados: string[]
  onClose: () => void
  onChanged: () => void
}) {
  // v48.50 — O mesmo lugar agora BLOQUEIA e DESBLOQUEIA.
  //
  // Bloquear o dia existia; desfazer, não. Quem bloqueava por engano — ou o
  // médico que desistiu do congresso — tinha que abrir horário por horário, e
  // mesmo assim não conseguia, porque o desbloqueio individual procurava o
  // horário pelo campo errado. As duas coisas foram consertadas aqui.
  const [modo, setModo] = useState<'bloquear' | 'desbloquear'>('bloquear')
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [feito, setFeito] = useState('')
  const [escolhidos, setEscolhidos] = useState<string[]>(preSelecionados)
  const [diaInteiro, setDiaInteiro] = useState(true)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [slotsDia, setSlotsDia] = useState<AgendaSlot[] | null>(null)

  // Todos os horários do dia, de todos os profissionais: livres para bloquear,
  // bloqueados para desbloquear. Uma leitura só, e a conta aparece ANTES de
  // apertar o botão — que é a diferença entre confiar e torcer.
  useEffect(() => {
    supabase.from('agenda_slots').select('*').eq('data', dateStr)
      .then(({ data }) => setSlotsDia(data ?? []))
  }, [dateStr])

  function dentroDaFaixa(hora: string) {
    if (diaInteiro) return true
    const h = (hora || '').slice(0, 5)
    if (de && h < de) return false
    if (ate && h >= ate) return false
    return true
  }

  const candidatos = (slotsDia ?? []).filter(s => modo === 'bloquear'
    ? (s.disponivel && !s.bloqueado)
    : s.bloqueado)

  const alvo = candidatos.filter(s =>
    escolhidos.includes(s.professional_id || '') && dentroDaFaixa(s.hora_inicio))

  const porProfissional = professionals.map(p => ({
    ...p,
    candidatos: candidatos.filter(s => s.professional_id === p.id).length,
    alvo: alvo.filter(s => s.professional_id === p.id).length,
  }))

  function alternar(id: string) {
    setEscolhidos(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id])
  }

  async function handleConfirm() {
    if (escolhidos.length === 0) { setError('Escolha pelo menos um profissional.'); return }
    if (!diaInteiro && !de && !ate) { setError('Diga a partir de que horas, até que horas, ou marque o dia inteiro.'); return }
    if (alvo.length === 0) {
      setError(modo === 'bloquear'
        ? 'Não há horário livre nesse intervalo para quem você escolheu.'
        : 'Não há horário bloqueado nesse intervalo para quem você escolheu.')
      return
    }

    setSaving(true); setError(''); setFeito('')
    let alterados = 0

    if (modo === 'bloquear') {
      // Pelos slot_id que a tela contou, e não por um filtro repetido no banco:
      // o que é bloqueado é exatamente o que foi mostrado ali em cima.
      const { data, error: err } = await supabase.from('agenda_slots').update({
        bloqueado: true, motivo_bloqueio: motivo.trim() || null, disponivel: false, bloqueado_em: new Date().toISOString(),
      }).in('slot_id', alvo.map(s => s.slot_id)).select('slot_id')
      if (err) { setSaving(false); setError('Não foi possível bloquear: ' + err.message); return }
      alterados = data?.length || 0
    } else {
      // Dois grupos: o horário sem paciente volta a ficar livre; o que já tem
      // consulta marcada só perde o bloqueio, continua ocupado. Liberar um
      // horário por cima de um paciente seria pior do que não desbloquear.
      const semPaciente = alvo.filter(s => !s.agendamento_id).map(s => s.slot_id)
      const comPaciente = alvo.filter(s => !!s.agendamento_id).map(s => s.slot_id)
      if (semPaciente.length) {
        const { data, error: err } = await supabase.from('agenda_slots').update({
          bloqueado: false, motivo_bloqueio: null, bloqueado_em: null, disponivel: true,
        }).in('slot_id', semPaciente).select('slot_id')
        if (err) { setSaving(false); setError('Não foi possível desbloquear: ' + err.message); return }
        alterados += data?.length || 0
      }
      if (comPaciente.length) {
        const { data, error: err } = await supabase.from('agenda_slots').update({
          bloqueado: false, motivo_bloqueio: null, bloqueado_em: null,
        }).in('slot_id', comPaciente).select('slot_id')
        if (err) { setSaving(false); setError('Não foi possível desbloquear: ' + err.message); return }
        alterados += data?.length || 0
      }
    }

    setSaving(false)
    // Conferência do que o banco realmente mudou. Se a tela contou 8 e o banco
    // mudou 0, alguém precisa saber — não pode fechar como se estivesse feito.
    if (alterados === 0) {
      setError('Nenhum horário foi alterado. Atualize a tela e tente de novo; se continuar, me avise.')
      return
    }
    if (alterados < alvo.length) {
      setFeito(`${alterados} de ${alvo.length} horários foram ${modo === 'bloquear' ? 'bloqueados' : 'desbloqueados'}. Os outros mudaram enquanto isso.`)
    }
    onChanged()
  }

  const cor = modo === 'bloquear'
    ? { borda: 'border-amber-300 bg-amber-50', aviso: 'bg-amber-50 border-amber-200 text-amber-800', botao: 'bg-amber-600 hover:bg-amber-700' }
    : { borda: 'border-emerald-300 bg-emerald-50', aviso: 'bg-emerald-50 border-emerald-200 text-emerald-800', botao: 'bg-emerald-600 hover:bg-emerald-700' }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{modo === 'bloquear' ? 'Bloquear horários' : 'Desbloquear horários'}</h2>
            <p className="text-xs text-slate-400">{fmtDataBR(dateStr)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={18}/></button>
        </div>

        <div className="px-5 py-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            {(['bloquear', 'desbloquear'] as const).map(m => (
              <button key={m} onClick={() => { setModo(m); setError(''); setFeito('') }}
                className={clsx('flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold',
                  modo === m ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500')}>
                {m === 'bloquear' ? <Lock size={13}/> : <Unlock size={13}/>}
                {m === 'bloquear' ? 'Bloquear' : 'Desbloquear'}
              </button>
            ))}
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>{error}
            </div>
          )}
          {feito && (
            <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-sm">{feito}</div>
          )}

          <div>
            <p className="text-xs font-medium text-slate-500 mb-1.5">De quem</p>
            <div className="space-y-1">
              {porProfissional.map(p => (
                <label key={p.id}
                  className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm',
                    escolhidos.includes(p.id) ? cor.borda : 'border-slate-200 hover:bg-slate-50',
                    p.candidatos === 0 && 'opacity-50')}>
                  <input type="checkbox" checked={escolhidos.includes(p.id)}
                    onChange={() => alternar(p.id)} className="rounded"/>
                  <span className="flex-1 text-slate-700">{p.nome}</span>
                  <span className="text-xs text-slate-400">
                    {slotsDia === null ? '...'
                      : p.candidatos === 0 ? (modo === 'bloquear' ? 'sem horário livre' : 'nada bloqueado')
                      : `${p.candidatos} ${modo === 'bloquear' ? 'livre' : 'bloqueado'}${p.candidatos > 1 ? 's' : ''}`}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 mb-1.5">Quando</p>
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5 text-slate-600">
                <input type="radio" checked={diaInteiro} onChange={() => setDiaInteiro(true)}/> Dia inteiro
              </label>
              <label className="flex items-center gap-1.5 text-slate-600">
                <input type="radio" checked={!diaInteiro} onChange={() => setDiaInteiro(false)}/> Só um intervalo
              </label>
            </div>
            {!diaInteiro && (
              <div className="flex items-center gap-2 mt-2">
                <input type="time" value={de} onChange={e => setDe(e.target.value)}
                  className="px-2.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"/>
                <span className="text-xs text-slate-400">até</span>
                <input type="time" value={ate} onChange={e => setAte(e.target.value)}
                  className="px-2.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"/>
              </div>
            )}
          </div>

          <div className={clsx('flex items-start gap-2 px-3 py-2.5 border rounded-lg text-sm', cor.aviso)}>
            <ShieldAlert size={15} className="flex-shrink-0 mt-0.5"/>
            {slotsDia === null ? (
              <span>Conferindo os horários...</span>
            ) : alvo.length === 0 ? (
              <span>{modo === 'bloquear' ? 'Nenhum horário livre no que você escolheu — nada seria bloqueado.' : 'Nenhum horário bloqueado no que você escolheu — nada seria desbloqueado.'}</span>
            ) : (
              <span>
                <strong>{alvo.length} horário{alvo.length > 1 ? 's' : ''}</strong> ser
                {alvo.length > 1 ? 'ão' : 'á'} {modo === 'bloquear' ? 'bloqueado' : 'desbloqueado'}{alvo.length > 1 ? 's' : ''}:{' '}
                {porProfissional.filter(p => p.alvo > 0).map(p => `${p.nome} (${p.alvo})`).join(', ')}.
                {' '}{modo === 'bloquear' ? 'Consultas já marcadas não são tocadas.' : 'Horários com consulta marcada continuam ocupados.'}
              </span>
            )}
          </div>

          {modo === 'bloquear' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Motivo do bloqueio (opcional, mas recomendado)</label>
              <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                placeholder="Ex: congresso, cirurgia no período, ausência do médico..."
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"/>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button onClick={handleConfirm} disabled={saving || alvo.length === 0}
            className={clsx('px-5 py-2.5 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2', cor.botao)}>
            {saving ? <Loader2 size={14} className="animate-spin"/> : modo === 'bloquear' ? <Lock size={14}/> : <Unlock size={14}/>}
            {modo === 'bloquear' ? 'Bloquear' : 'Desbloquear'} {alvo.length > 0 ? alvo.length : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Visão Dia
// ─────────────────────────────────────────────────────────────────────────

function DayView({ professionals, selectedProfessionalId, date, onEscolherProfissional }: {
  professionals: Professional[]; selectedProfessionalId: string; date: Date
  // v48.71 — Clicar no nome no alto da coluna abre a agenda só daquele médico.
  // Com "Todos" ligado, a grade fica larga e é preciso rolar para o lado; o
  // nome é onde a pessoa já está olhando quando decide "quero ver só esta".
  onEscolherProfissional?: (id: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<AgendaSlot[]>([])
  const [agMap, setAgMap] = useState<Map<string, Agendamento>>(new Map())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [activeSlot, setActiveSlot] = useState<AgendaSlot | null>(null)
  const [showDayBlockModal, setShowDayBlockModal] = useState(false)
  const [manualTime, setManualTime] = useState('')
  const [manualSlot, setManualSlot] = useState<AgendaSlot | null>(null)
  // v48.162 — retorno/cobrança (só existem no MedX, não na tabela agendamentos do
  // CRM). Busca separada e não-bloqueante: a grade aparece na hora com o que já
  // tinha, e os selos de retorno/cobrança vão completando conforme a busca no
  // MedX responde (pode ser perceptível com muitas consultas no dia).
  const [medxInfoMap, setMedxInfoMap] = useState<Map<string, MedxInfo>>(new Map())

  const dateStr = fmtDataStr(date)
  const dateStrRef = useRef(dateStr)
  dateStrRef.current = dateStr

  useEffect(() => { load() }, [dateStr, selectedProfessionalId])

  async function load() {
    setLoading(true)
    let slotQ = supabase.from('agenda_slots').select('*').eq('data', dateStr).order('hora_inicio')
    if (selectedProfessionalId !== 'todos') slotQ = slotQ.eq('professional_id', selectedProfessionalId)
    let agQ = supabase.from('agendamentos').select('*').eq('data', dateStr)
    if (selectedProfessionalId !== 'todos') agQ = agQ.eq('professional_id', selectedProfessionalId)
    const [{ data: slotsData }, { data: agData }, { data: holData }] = await Promise.all([
      slotQ.limit(2000),
      agQ.limit(2000),
      supabase.from('holidays').select('*').eq('data', dateStr),
    ])
    const loadedSlots = (slotsData ?? []) as AgendaSlot[]
    const loadedAppointments = await comNomeAtualDoContato((agData ?? []) as Agendamento[])
    await releaseCancelledSlots(loadedSlots, loadedAppointments)
    setSlots(loadedSlots)
    setAgMap(buildAgendamentoMap(loadedAppointments))
    setHolidays(holData ?? [])
    setLoading(false)
    setMedxInfoMap(new Map()) // limpa os selos do dia anterior enquanto busca os novos
    const dataDaBusca = dateStr
    carregarMedxInfo(loadedAppointments).then(mapa => {
      if (dateStrRef.current === dataDaBusca) setMedxInfoMap(mapa)
    })
  }

  const columns = selectedProfessionalId === 'todos'
    ? professionals
    : professionals.filter(p => p.id === selectedProfessionalId)

  const timeRows = useMemo(() => {
    const set = new Set<string>()
    slots.forEach(s => set.add(s.hora_inicio))
    return Array.from(set).sort()
  }, [slots])

  const slotByProfTime = useMemo(() => {
    const m = new Map<string, AgendaSlot>()
    slots.forEach(s => m.set(`${s.professional_id}_${s.hora_inicio}`, s))
    return m
  }, [slots])

  if (loading) return <LoadingBlock/>
  if (holidays.length > 0) return <HolidayBanner holidays={holidays}/>
  if (columns.length === 0) return <EmptyBlock text="Nenhum profissional para exibir."/>

  // O botão não promete mais o que vai bloquear: quem decide isso é a própria
  // janela, onde dá para escolher o profissional e o intervalo.
  const blockLabel = 'Bloquear horários'

  function openManualSchedule() {
    const professional = professionals.find(p => p.id === selectedProfessionalId)
    if (!professional || !/^([01]\d|2[0-3]):[0-5]\d$/.test(manualTime)) return
    const [hour, minute] = manualTime.split(':').map(Number)
    const endTotal = hour * 60 + minute + (professional.duracao_min || 60)
    const endTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`
    setManualSlot({
      id: `avulso_${professional.id_medx}_${dateStr}_${manualTime.replace(':', '')}`,
      slot_id: `avulso_${professional.id_medx}_${dateStr}_${manualTime.replace(':', '')}`,
      professional_id: professional.id,
      id_medx: professional.id_medx,
      profissional_nome: professional.nome,
      data: dateStr,
      hora_inicio: manualTime,
      hora_fim: endTime,
      disponivel: false,
      especialidade: professional.especialidade,
      agendamento_id: null,
      id_tipo_consulta: null,
      bloqueado: false,
      motivo_bloqueio: null,
      bloqueado_em: null,
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-400">{timeRows.length} horário(s) no dia</p>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {selectedProfessionalId !== 'todos' && (
            <div className="flex items-center gap-1.5">
              <input type="time" value={manualTime} onChange={e => setManualTime(e.target.value)} aria-label="Horário avulso"
                className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              <button onClick={openManualSchedule} disabled={!manualTime}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 disabled:opacity-50 rounded-lg transition-colors">
                <CalendarPlus size={13}/> Agendar horário avulso
              </button>
            </div>
          )}
          <button onClick={() => setShowDayBlockModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors">
            <Lock size={13}/> {blockLabel} / desbloquear
          </button>
        </div>
      </div>

      {timeRows.length === 0 ? (
        <EmptyBlock text="Nenhum horário de agenda gerado para este dia."/>
      ) : (
        <div className="bg-white border border-slate-100 rounded-xl overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="sticky left-0 bg-white text-left text-xs font-semibold text-slate-500 px-3 py-2.5 w-20">Horário</th>
                {columns.map(p => {
                  // Só faz sentido "abrir a agenda dele" quando há mais de uma
                  // coluna. Com uma só, o clique não levaria a lugar nenhum.
                  const podeAbrir = !!onEscolherProfissional && columns.length > 1
                  const conteudo = (
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                        {p.nome.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="truncate">{p.nome}</span>
                    </div>
                  )
                  return (
                    <th key={p.id} className="text-left text-xs font-semibold text-slate-600 px-3 py-2.5 min-w-[160px]">
                      {podeAbrir ? (
                        <button type="button" onClick={() => onEscolherProfissional!(p.id)}
                          title={`Ver só a agenda de ${p.nome}`}
                          className="w-full text-left hover:text-brand-600 transition-colors">
                          {conteudo}
                        </button>
                      ) : conteudo}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {timeRows.map(t => (
                <tr key={t} className="border-b border-slate-50 last:border-0">
                  <td className="sticky left-0 bg-white text-xs font-medium text-slate-500 px-3 py-2">{fmtHora(t)}</td>
                  {columns.map(p => {
                    const slot = slotByProfTime.get(`${p.id}_${t}`)
                    const ag = slot ? agMap.get(slot.slot_id) : undefined
                    return (
                      <td key={p.id} className="px-2 py-1.5">
                        {slot ? (
                          <SlotChip slot={slot} agendamento={ag} onClick={() => setActiveSlot(slot)}
                            medxInfo={ag?.medx_agendamento_id ? medxInfoMap.get(ag.medx_agendamento_id) : undefined}/>
                        ) : (
                          <div className="text-center text-slate-200 text-xs py-2">—</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeSlot && (
        <SlotActionModal
          slot={activeSlot}
          agendamento={agMap.get(activeSlot.slot_id)}
          professionals={professionals}
          onClose={() => setActiveSlot(null)}
          onChanged={() => { setActiveSlot(null); load() }}
          medxInfo={(() => {
            const id = agMap.get(activeSlot.slot_id)?.medx_agendamento_id
            return id ? medxInfoMap.get(id) : undefined
          })()}
        />
      )}

      {manualSlot && (() => {
        const professional = professionals.find(p => p.id === manualSlot.professional_id)
        return professional ? (
          <AgendarModal slot={manualSlot} professional={professional}
            onClose={() => setManualSlot(null)}
            onScheduled={() => { setManualSlot(null); setManualTime(''); load() }}/>
        ) : null
      })()}

      {showDayBlockModal && (
        <DayBlockModal
          dateStr={dateStr}
          professionals={professionals}
          preSelecionados={selectedProfessionalId === 'todos' ? [] : [selectedProfessionalId]}
          onClose={() => setShowDayBlockModal(false)}
          onChanged={() => { setShowDayBlockModal(false); load() }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Visão Semana
// ─────────────────────────────────────────────────────────────────────────

function WeekView({ professionals, selectedProfessionalId, date, onJump }: {
  professionals: Professional[]; selectedProfessionalId: string; date: Date; onJump: (d: Date, profId?: string) => void
}) {
  const weekStart = startOfWeek(date, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(date, { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd })
  const startStr = fmtDataStr(weekStart)
  const endStr = fmtDataStr(weekEnd)

  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<AgendaSlot[]>([])
  const [agMap, setAgMap] = useState<Map<string, Agendamento>>(new Map())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [activeSlot, setActiveSlot] = useState<AgendaSlot | null>(null)

  useEffect(() => { load() }, [startStr, endStr, selectedProfessionalId])

  async function load() {
    setLoading(true)
    let slotQ = supabase.from('agenda_slots').select('*').gte('data', startStr).lte('data', endStr).order('hora_inicio')
    if (selectedProfessionalId !== 'todos') slotQ = slotQ.eq('professional_id', selectedProfessionalId)
    let agQ = supabase.from('agendamentos').select('*').gte('data', startStr).lte('data', endStr)
    if (selectedProfessionalId !== 'todos') agQ = agQ.eq('professional_id', selectedProfessionalId)
    const [{ data: slotsData }, { data: agData }, { data: holData }] = await Promise.all([
      slotQ.limit(5000),
      agQ.limit(5000),
      supabase.from('holidays').select('*').gte('data', startStr).lte('data', endStr),
    ])
    const loadedSlots = (slotsData ?? []) as AgendaSlot[]
    const loadedAppointments = await comNomeAtualDoContato((agData ?? []) as Agendamento[])
    await releaseCancelledSlots(loadedSlots, loadedAppointments)
    setSlots(loadedSlots)
    setAgMap(buildAgendamentoMap(loadedAppointments))
    setHolidays(holData ?? [])
    setLoading(false)
  }

  if (loading) return <LoadingBlock/>

  const holidaySet = new Set(holidays.map(h => h.data))

  if (selectedProfessionalId !== 'todos') {
    return (
      <div>
        <div className="grid grid-cols-7 gap-2">
          {days.map(d => {
            const dStr = fmtDataStr(d)
            const daySlots = slots.filter(s => s.data === dStr).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
            const isHoliday = holidaySet.has(dStr)
            const hol = holidays.find(h => h.data === dStr)
            return (
              <div key={dStr} className={clsx('bg-white border rounded-xl overflow-hidden flex flex-col', isToday(d) ? 'border-brand-300' : 'border-slate-100')}>
                <div className={clsx('px-2 py-2 text-center border-b', isToday(d) ? 'bg-brand-50 border-brand-100' : 'bg-slate-50 border-slate-100')}>
                  <p className="text-[10px] uppercase font-semibold text-slate-400">{capitalize(format(d, 'EEE', { locale: ptBR }))}</p>
                  <p className={clsx('text-sm font-bold', isToday(d) ? 'text-brand-700' : 'text-slate-700')}>{format(d, 'd')}</p>
                </div>
                <div className="p-1.5 space-y-1 flex-1 min-h-[120px] max-h-[420px] overflow-y-auto">
                  {isHoliday ? (
                    <p className="text-[10px] text-slate-400 text-center px-1 py-3">Feriado{hol ? `: ${hol.nome}` : ''}</p>
                  ) : daySlots.length === 0 ? (
                    <p className="text-[10px] text-slate-300 text-center px-1 py-3">Sem horários</p>
                  ) : (
                    daySlots.map(s => (
                      <SlotChip key={s.id} slot={s} agendamento={agMap.get(s.slot_id)} onClick={() => setActiveSlot(s)} compact/>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {activeSlot && (
          <SlotActionModal slot={activeSlot} agendamento={agMap.get(activeSlot.slot_id)} professionals={professionals} onClose={() => setActiveSlot(null)}
            onChanged={() => { setActiveSlot(null); load() }}/>
        )}
      </div>
    )
  }

  // "Todos" — painel geral: resumo por dia x profissional (grid completo ficaria ilegível)
  return (
    <div>
      <div className="bg-white border border-slate-100 rounded-xl overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="sticky left-0 bg-white text-left text-xs font-semibold text-slate-500 px-3 py-2.5 min-w-[160px]">Profissional</th>
              {days.map(d => (
                <th key={fmtDataStr(d)} className={clsx('text-center text-xs font-semibold px-2 py-2.5 min-w-[100px]', isToday(d) ? 'text-brand-700' : 'text-slate-600')}>
                  {capitalize(format(d, 'EEE', { locale: ptBR }))} {format(d, 'd')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {professionals.map(p => (
              <tr key={p.id} className="border-b border-slate-50 last:border-0">
                <td className="sticky left-0 bg-white text-sm font-medium text-slate-700 px-3 py-2.5">{p.nome}</td>
                {days.map(d => {
                  const dStr = fmtDataStr(d)
                  if (holidaySet.has(dStr)) {
                    return <td key={dStr} className="px-2 py-2.5 text-center text-[10px] text-slate-400">Feriado</td>
                  }
                  const daySlots = slots.filter(s => s.professional_id === p.id && s.data === dStr)
                  let livres = 0, ocupados = 0, bloqueados = 0
                  daySlots.forEach(s => {
                    const st = slotState(s, agMap.get(s.slot_id))
                    if (st === 'disponivel') livres++
                    else if (st === 'ocupado') ocupados++
                    else if (st === 'bloqueado') bloqueados++
                  })
                  return (
                    <td key={dStr} className="px-2 py-2.5 text-center">
                      <button onClick={() => onJump(d, p.id)}
                        disabled={daySlots.length === 0}
                        className={clsx('w-full rounded-lg px-1.5 py-1.5 text-[10px] leading-tight transition-colors',
                          daySlots.length === 0 ? 'text-slate-300 cursor-default' : 'hover:bg-slate-50 cursor-pointer')}>
                        {daySlots.length === 0 ? '—' : (
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            <span className="text-emerald-600 font-semibold">{livres}L</span>
                            <span className="text-brand-600 font-semibold">{ocupados}O</span>
                            {bloqueados > 0 && <span className="text-amber-600 font-semibold">{bloqueados}B</span>}
                          </div>
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">L = livres · O = ocupados · B = bloqueados. Clique numa célula para abrir o dia daquele profissional.</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Visão Mês
// ─────────────────────────────────────────────────────────────────────────

function MonthView({ professionals, selectedProfessionalId, date, onJump }: {
  professionals: Professional[]; selectedProfessionalId: string; date: Date; onJump: (d: Date) => void
}) {
  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })
  const startStr = fmtDataStr(gridStart)
  const endStr = fmtDataStr(gridEnd)

  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<AgendaSlot[]>([])
  const [agMap, setAgMap] = useState<Map<string, Agendamento>>(new Map())
  const [holidays, setHolidays] = useState<Holiday[]>([])

  useEffect(() => { load() }, [startStr, endStr, selectedProfessionalId])

  async function load() {
    setLoading(true)
    let slotQ = supabase.from('agenda_slots').select('*').gte('data', startStr).lte('data', endStr)
    if (selectedProfessionalId !== 'todos') slotQ = slotQ.eq('professional_id', selectedProfessionalId)
    let agQ = supabase.from('agendamentos').select('*').gte('data', startStr).lte('data', endStr)
    if (selectedProfessionalId !== 'todos') agQ = agQ.eq('professional_id', selectedProfessionalId)
    const [{ data: slotsData }, { data: agData }, { data: holData }] = await Promise.all([
      slotQ.limit(8000),
      agQ.limit(8000),
      supabase.from('holidays').select('*').gte('data', startStr).lte('data', endStr),
    ])
    const loadedSlots = (slotsData ?? []) as AgendaSlot[]
    const loadedAppointments = await comNomeAtualDoContato((agData ?? []) as Agendamento[])
    await releaseCancelledSlots(loadedSlots, loadedAppointments)
    setSlots(loadedSlots)
    setAgMap(buildAgendamentoMap(loadedAppointments))
    setHolidays(holData ?? [])
    setLoading(false)
  }

  if (loading) return <LoadingBlock/>

  const holidaySet = new Set(holidays.map(h => h.data))

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(w => (
          <div key={w} className="text-center text-[10px] font-semibold text-slate-400 uppercase py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map(d => {
          const dStr = fmtDataStr(d)
          const inMonth = isSameMonth(d, date)
          const isHoliday = holidaySet.has(dStr)
          const hol = holidays.find(h => h.data === dStr)
          const daySlots = slots.filter(s => s.data === dStr)
          let livres = 0, ocupados = 0, bloqueados = 0
          daySlots.forEach(s => {
            const st = slotState(s, agMap.get(s.slot_id))
            if (st === 'disponivel') livres++
            else if (st === 'ocupado') ocupados++
            else if (st === 'bloqueado') bloqueados++
          })
          return (
            <button key={dStr} onClick={() => onJump(d)}
              className={clsx('h-24 rounded-xl border p-2 flex flex-col items-start text-left transition-colors',
                !inMonth && 'opacity-40',
                isHoliday ? 'bg-slate-100 border-slate-200' : 'bg-white border-slate-100 hover:border-brand-300 hover:bg-brand-50/40')}>
              <span className={clsx('text-xs font-semibold mb-1',
                isToday(d) ? 'w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center' : 'text-slate-600')}>
                {format(d, 'd')}
              </span>
              {isHoliday ? (
                <span className="text-[9px] text-slate-500 leading-tight">Feriado{hol ? `: ${hol.nome}` : ''}</span>
              ) : daySlots.length > 0 ? (
                <div className="flex flex-col gap-0.5 mt-auto">
                  <span className="text-[9px] text-emerald-600 font-medium">{livres} livres</span>
                  <span className="text-[9px] text-brand-600 font-medium">{ocupados} agendados</span>
                  {bloqueados > 0 && <span className="text-[9px] text-amber-600 font-medium">{bloqueados} bloq.</span>}
                </div>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Visão Disponíveis
// ─────────────────────────────────────────────────────────────────────────

function DisponiveisView({ professionals, selectedProfessionalId, date }: {
  professionals: Professional[]; selectedProfessionalId: string; date: Date
}) {
  const dateStr = fmtDataStr(date)
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<AgendaSlot[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [activeSlot, setActiveSlot] = useState<AgendaSlot | null>(null)

  useEffect(() => { load() }, [dateStr, selectedProfessionalId])

  async function load() {
    setLoading(true)
    let q = supabase.from('agenda_slots').select('*').eq('data', dateStr).eq('disponivel', true).eq('bloqueado', false).order('hora_inicio')
    if (selectedProfessionalId !== 'todos') q = q.eq('professional_id', selectedProfessionalId)
    const [{ data: slotsData }, { data: holData }] = await Promise.all([
      q.limit(2000),
      supabase.from('holidays').select('*').eq('data', dateStr),
    ])
    setSlots(slotsData ?? [])
    setHolidays(holData ?? [])
    setLoading(false)
  }

  if (loading) return <LoadingBlock/>
  if (holidays.length > 0) return <HolidayBanner holidays={holidays}/>

  const columns = selectedProfessionalId === 'todos' ? professionals : professionals.filter(p => p.id === selectedProfessionalId)
  const byProf = new Map<string, AgendaSlot[]>()
  columns.forEach(p => byProf.set(p.id, slots.filter(s => s.professional_id === p.id)))

  if (slots.length === 0) return <EmptyBlock text="Nenhum horário livre neste dia (para o filtro atual)."/>

  return (
    <div>
      <p className="text-xs text-slate-400 mb-3">{slots.length} horário(s) livre(s)</p>
      <div className={clsx('grid gap-3', columns.length > 1 ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 max-w-sm')}>
        {columns.map(p => {
          const list = byProf.get(p.id) ?? []
          if (list.length === 0) return null
          return (
            <div key={p.id} className="bg-white border border-slate-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-slate-600 mb-2 truncate">{p.nome} <span className="text-slate-400 font-normal">({list.length})</span></p>
              <div className="flex flex-wrap gap-1.5">
                {list.map(s => (
                  <button key={s.id} onClick={() => setActiveSlot(s)}
                    className="px-2 py-1 text-[11px] font-medium bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 rounded-md transition-colors">
                    {fmtHora(s.hora_inicio)}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {activeSlot && (
        <SlotActionModal slot={activeSlot} agendamento={undefined} professionals={professionals} onClose={() => setActiveSlot(null)}
          onChanged={() => { setActiveSlot(null); load() }}/>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Visão Realizados
// ─────────────────────────────────────────────────────────────────────────

function RealizadosView({ professionals, selectedProfessionalId }: {
  professionals: Professional[]; selectedProfessionalId: string
}) {
  const todayStr = fmtDataStr(new Date())
  const [dataInicio, setDataInicio] = useState(fmtDataStr(subDays(new Date(), 30)))
  const [dataFim, setDataFim] = useState(todayStr)
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Agendamento[]>([])

  useEffect(() => { load() }, [dataInicio, dataFim, selectedProfessionalId])

  async function load() {
    setLoading(true)
    let q = supabase.from('agendamentos').select('*').eq('status', 'Realizada')
      .gte('data', dataInicio).lte('data', dataFim)
      .order('data', { ascending: false }).order('hora', { ascending: false }).limit(500)
    if (selectedProfessionalId !== 'todos') q = q.eq('professional_id', selectedProfessionalId)
    const { data } = await q
    setRows(await comNomeAtualDoContato(data ?? []))
    setLoading(false)
  }

  const filtered = useMemo(() => {
    // v48.153 — `.toLowerCase()` puro não ignora acento nem "ch"/"x"; troca
    // pelo mesmo contemTermo usado em Contatos e no restante da Agenda Médica.
    if (!busca.trim()) return rows
    return rows.filter(r => contemTermo(busca, r.paciente_nome, r.paciente_telefone))
  }, [rows, busca])

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4 bg-white border border-slate-100 rounded-xl px-4 py-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1">De</label>
          <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
            className="px-2.5 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1">Até</label>
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="px-2.5 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] font-medium text-slate-500 mb-1">Buscar paciente</label>
          <input type="text" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome ou telefone..."
            className="w-full px-2.5 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <p className="text-xs text-slate-400">{filtered.length} consulta(s) realizada(s) no período</p>
      </div>

      {loading ? <LoadingBlock/> : filtered.length === 0 ? (
        <EmptyBlock text="Nenhuma consulta realizada no período selecionado."/>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => (
            <div key={r.id} className="bg-white border border-slate-100 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={16}/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{r.paciente_nome}</p>
                <p className="text-xs text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                  <span className="flex items-center gap-1"><Phone size={10}/>{r.paciente_telefone || '—'}</span>
                  <span>· {r.profissional_nome}</span>
                  <span>· {fmtDataBR(r.data)} às {r.hora}</span>
                  {modalidadeDaConsulta(r) && (
                    <span className="flex items-center gap-1">
                      · {modalidadeDaConsulta(r) === 'online' ? <Video size={10}/> : <MapPin size={10}/>}
                      {rotuloModalidade(modalidadeDaConsulta(r))}
                    </span>
                  )}
                </p>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 flex-shrink-0">Realizada</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Visão Cancelados
// ─────────────────────────────────────────────────────────────────────────

function CanceladosView({ professionals, selectedProfessionalId }: {
  professionals: Professional[]; selectedProfessionalId: string
}) {
  const todayStr = fmtDataStr(new Date())
  const [dataInicio, setDataInicio] = useState(fmtDataStr(subDays(new Date(), 30)))
  const [dataFim, setDataFim] = useState(todayStr)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Agendamento[]>([])

  useEffect(() => { load() }, [dataInicio, dataFim, selectedProfessionalId])

  async function load() {
    setLoading(true)
    let q = supabase.from('agendamentos').select('*').eq('status', 'Cancelada')
      .gte('data', dataInicio).lte('data', dataFim)
      .order('data', { ascending: false }).order('hora', { ascending: false }).limit(500)
    if (selectedProfessionalId !== 'todos') q = q.eq('professional_id', selectedProfessionalId)
    const { data } = await q
    setRows(await comNomeAtualDoContato(data ?? []))
    setLoading(false)
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4 bg-white border border-slate-100 rounded-xl px-4 py-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1">De</label>
          <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
            className="px-2.5 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1">Até</label>
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="px-2.5 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <p className="text-xs text-slate-400 ml-auto">{rows.length} cancelamento(s) no período</p>
      </div>

      {loading ? <LoadingBlock/> : rows.length === 0 ? (
        <EmptyBlock text="Nenhum agendamento cancelado no período selecionado."/>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="bg-white border border-slate-100 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0">
                <Ban size={16}/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{r.paciente_nome}</p>
                <p className="text-xs text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                  <span className="flex items-center gap-1"><Phone size={10}/>{r.paciente_telefone || '—'}</span>
                  <span>· {r.profissional_nome}</span>
                  <span>· {fmtDataBR(r.data)} às {r.hora}</span>
                  {modalidadeDaConsulta(r) && (
                    <span className="flex items-center gap-1">
                      · {modalidadeDaConsulta(r) === 'online' ? <Video size={10}/> : <MapPin size={10}/>}
                      {rotuloModalidade(modalidadeDaConsulta(r))}
                    </span>
                  )}
                </p>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 flex-shrink-0">Cancelada</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
