'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import Sidebar from '@/components/Sidebar'
import { Plus, X, Send, Clock, CalendarClock, Loader2, CheckCircle2, Search, AlertCircle, Pencil, RotateCcw, Stethoscope, Trash2 } from 'lucide-react'
import { format, isPast, isToday, isTomorrow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'

type ScheduledMsg = {
  id: string
  contact_id: string
  content: string
  scheduled_for: string
  status: string
  origin: string
  created_at: string
  created_by?: string | null
  contact?: { full_name: string; phone: string }
  creator?: { name: string } | null
  medx_agendamento_id?: string | null
  agendamento_id?: string | null
  message_id?: string | null
}

const AUTO_ORIGINS = ['automatic_reminder', 'appointment_confirmation', 'retorno_followup', 'cirurgia']

// v48.111 — "Notícia" da cirurgia (solicitada ao hospital, autorizada, pré-op
// parado, suspensão de remédio) não nasce em scheduled_messages: nasce em
// cirurgia_avisos, porque tem que passar pela secretária antes de ir ao
// paciente (ver sincronizar_mensagens_cirurgia/avisar_suspensao_medicamentos
// no banco). Até aqui, só dava para ver essa fila abrindo cirurgia por
// cirurgia (MensagensEnviadas.tsx) — nada centralizava "o que ainda está
// esperando decisão". Por isso ela entra também nesta tela.
type AvisoMsg = {
  id: string
  cirurgia_id: string | null
  contact_id: string | null
  tipo: string
  titulo: string
  texto: string
  status: 'pendente' | 'descartado' | 'enviado'
  criado_em: string
  decidido_em: string | null
  contact?: { full_name: string; phone: string }
}

// Tira acentos e caixa para permitir buscar "joao" e encontrar "João".
function normalizeSearch(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export default function AgendaPage() {
  const { agent } = useAuth()
  const [msgs, setMsgs] = useState<ScheduledMsg[]>([])
  const [avisos, setAvisos] = useState<AvisoMsg[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editMsg, setEditMsg] = useState<any | null>(null)
  const [editAviso, setEditAviso] = useState<AvisoMsg | null>(null)
  const [filter, setFilter] = useState<'scheduled' | 'sent' | 'failed' | 'all'>('scheduled')
  const [search, setSearch] = useState('')
  const [onlyAuto, setOnlyAuto] = useState(false)

  useEffect(() => { loadMsgs() }, [filter])

  // Uma lista só, mensagens e avisos juntos, ordenada pela data que importa
  // pra cada um (quando vai sair / quando nasceu o aviso) — pra secretária
  // não ter que olhar duas telas pra saber o que falta decidir ou conferir.
  type ItemUnificado =
    | { key: string; quando: string; kind: 'msg'; msg: ScheduledMsg }
    | { key: string; quando: string; kind: 'aviso'; aviso: AvisoMsg }

  const itens: ItemUnificado[] = [
    ...msgs.map(m => ({ key: 'm:' + m.id, quando: m.scheduled_for, kind: 'msg' as const, msg: m })),
    ...avisos.map(a => ({ key: 'a:' + a.id, quando: a.decidido_em || a.criado_em, kind: 'aviso' as const, aviso: a })),
  ].sort((a, b) => a.quando.localeCompare(b.quando))

  const filteredItens = itens.filter(it => {
    if (it.kind === 'msg') {
      if (filter === 'scheduled' && onlyAuto && !AUTO_ORIGINS.includes(it.msg.origin)) return false
    }
    if (!search.trim()) return true
    // Remove acentos antes de comparar, para "joao" encontrar "João" mesmo
    // sem o usuário digitar o acento.
    const q = normalizeSearch(search)
    const name = normalizeSearch(it.kind === 'msg' ? ((it.msg.contact as any)?.full_name || '') : (it.aviso.contact?.full_name || ''))
    const content = normalizeSearch(it.kind === 'msg' ? (it.msg.content || '') : (it.aviso.texto || ''))
    const phone = it.kind === 'msg' ? ((it.msg.contact as any)?.phone || '') : (it.aviso.contact?.phone || '')
    return name.includes(q) || content.includes(q) || phone.includes(q)
  })

  async function loadMsgs() {
    setLoading(true)
    const base = supabase.from('scheduled_messages')
      .select('*, contact:contacts(full_name, phone), creator:agents(name)')
    // A aba "Agendado" busca por exclusão (tudo que não é enviado/falhou/cancelado/
    // substituído), não por uma lista fixa de valores — assim uma automação nova
    // (ex.: os lembretes de aniversário) que grave um status ainda não previsto aqui
    // continua aparecendo como agendada, em vez de sumir dessa aba.
    const query = filter !== 'all'
      ? (filter === 'scheduled'
          ? base.not('status', 'in', '(sent,failed,cancelled,cancelado,superseded)').order('scheduled_for', { ascending: true }).limit(100)
          : base.eq('status', filter).order('scheduled_for', { ascending: true }).limit(100))
      : base.order('scheduled_for', { ascending: true }).limit(100)

    // Avisos não têm "falha" própria (ver route.ts: enviar joga direto na fila
    // de mensagens, sem voltar aqui pra registrar se deu certo) — na aba Falha
    // não tem o que buscar.
    let avisosPromise: PromiseLike<{ data: any }> = Promise.resolve({ data: [] })
    if (filter !== 'failed') {
      let avisosQuery = supabase.from('cirurgia_avisos')
        .select('id, cirurgia_id, contact_id, tipo, titulo, texto, status, criado_em, decidido_em')
        // "Revisar medicações" é tarefa interna da equipe, não notícia para o
        // paciente — não pertence a uma agenda de disparos (ver route.ts).
        .neq('tipo', 'medicamentos_pendentes')
      if (filter === 'scheduled') avisosQuery = avisosQuery.in('status', ['pendente', 'descartado'])
      else if (filter === 'sent') avisosQuery = avisosQuery.eq('status', 'enviado')
      avisosPromise = avisosQuery.order('criado_em', { ascending: false }).limit(100)
    }

    const [{ data }, { data: avisosData }] = await Promise.all([query, avisosPromise])
    setMsgs((data as any) ?? [])

    // cirurgia_avisos.contact_id não tem FK declarada (é referência solta),
    // então o PostgREST não embuti o contato sozinho — busca à parte.
    const brutos = (avisosData as any[]) ?? []
    const idsContato = Array.from(new Set(brutos.map(a => a.contact_id).filter(Boolean)))
    let contatos: Record<string, { full_name: string; phone: string }> = {}
    if (idsContato.length) {
      const { data: cs } = await supabase.from('contacts').select('id, full_name, phone').in('id', idsContato)
      for (const c of (cs as any[]) ?? []) contatos[c.id] = { full_name: c.full_name, phone: c.phone }
    }
    setAvisos(brutos.map(a => ({ ...a, contact: a.contact_id ? contatos[a.contact_id] : undefined })))

    setLoading(false)
  }

  async function handleCancel(id: string) {
    await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', id)
    loadMsgs()
  }

  async function handleRetry(id: string) {
    await supabase.from('scheduled_messages').update({ status: 'scheduled', error_message: null }).eq('id', id)
    loadMsgs()
  }

  function authorLabel(msg: ScheduledMsg) {
    // A mensagem de cirurgia não é da Sofia: ela nasce do gatilho da agenda
    // cirúrgica. Dizer "Sofia" aqui faria a equipe procurar no lugar errado
    // quando precisasse entender de onde veio.
    if (msg.origin === 'cirurgia') return 'Agenda cirúrgica'
    if (AUTO_ORIGINS.includes(msg.origin)) return 'Sofia'
    return (msg.creator as any)?.name || null
  }

  // Trata como "ainda agendada" qualquer mensagem que não esteja explicitamente
  // enviada, cancelada, com falha ou substituída — mesmo status novos/desconhecidos
  // (ex.: os lembretes automáticos de aniversário) contam como agendada, nunca
  // como cancelada. Ver também statusColor/statusLabel acima.
  function isScheduledLike(status: string) {
    return !['sent', 'failed', 'cancelled', 'cancelado', 'superseded'].includes(status)
  }

  function dateLabel(dateStr: string, status: string) {
    const d = new Date(dateStr)
    const isActive = isScheduledLike(status)
    if (isActive && isPast(d)) return 'Atrasado'
    if (isToday(d)) return 'Hoje'
    if (isTomorrow(d)) return 'Amanhã'
    // Sempre com o ano — só dia e mês confunde quando há mensagens agendadas
    // pra datas em anos diferentes (ex.: retorno de 1 ano) perto uma da outra.
    return format(d, "d 'de' MMM 'de' yyyy", { locale: ptBR })
  }

  function statusColor(status: string) {
    if (status === 'sent') return 'bg-emerald-50 text-emerald-700'
    if (status === 'failed') return 'bg-red-50 text-red-700'
    if (status === 'cancelled' || status === 'cancelado' || status === 'superseded') return 'bg-slate-100 text-slate-500'
    // Qualquer status não reconhecido (ex.: um valor novo vindo de uma automação,
    // como os lembretes de aniversário) é tratado como agendado, e não como
    // cancelado — mostrar "Cancelado" por engano é bem pior do que mostrar
    // "Agendado" por engano.
    return 'bg-amber-50 text-amber-700'
  }

  function statusLabel(status: string) {
    if (status === 'sent') return 'Enviado'
    if (status === 'failed') return 'Falhou'
    if (status === 'superseded') return 'Substituído'
    if (status === 'cancelled' || status === 'cancelado') return 'Cancelado'
    // Ver comentário em statusColor: default seguro é "Agendado", não "Cancelado".
    return 'Agendado'
  }

  // Aviso é diferente de mensagem agendada: não tem hora certa pra sair, tem
  // uma DECISÃO pendente. "Descartado" ainda mostra como "Aguardando decisão"
  // de propósito (mesma lógica do MensagensEnviadas.tsx): quem descartou pode
  // mudar de ideia, e a próxima mudança de situação não cria outro igual.
  function avisoStatusColor(status: AvisoMsg['status']) {
    if (status === 'enviado') return 'bg-emerald-50 text-emerald-700'
    return 'bg-sky-50 text-sky-700'
  }
  function avisoStatusLabel(status: AvisoMsg['status']) {
    if (status === 'enviado') return 'Enviado'
    return 'Aguardando decisão'
  }

  // Sem "Atrasado" aqui: aviso não tem hora de saída pra se atrasar, só data
  // de quando nasceu (ou foi decidido) — reaproveitar dateLabel() daria
  // "Atrasado" pra qualquer aviso de ontem, o que não faz sentido nenhum.
  function avisoDateLabel(dateStr: string) {
    const d = new Date(dateStr)
    if (isToday(d)) return 'Hoje'
    if (isTomorrow(d)) return 'Amanhã'
    return format(d, "d 'de' MMM 'de' yyyy", { locale: ptBR })
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white border-b border-slate-100 px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {/* v48.134 — Era "Agenda de Disparos": no resto do sistema "disparo" é
                  o termo dos Disparos em massa (marketing, ver app/broadcasts), e essa
                  tela é outra coisa (mensagens agendadas por paciente — pré-op, pós-op,
                  confirmação, lembrete de remédio). O menu lateral já chamava de "Agenda
                  de Mensagens" (Sidebar.tsx); só o título da própria tela estava
                  desencontrado. Pedido do Jorge. */}
              <h1 className="text-lg font-semibold text-slate-800">Agenda de Mensagens</h1>
              <p className="text-xs text-slate-400 mt-0.5">Mensagens agendadas para pacientes</p>
            </div>
            <button onClick={() => setShowModal(true)} title="Nova mensagem agendada"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 sm:h-auto sm:w-auto sm:gap-2 sm:px-3.5 sm:py-2">
              <Plus size={15}/><span className="hidden sm:inline">Nova mensagem</span>
            </button>
          </div>
          <div className="mt-3 grid grid-cols-4 bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
              {[
                { k: 'scheduled' as const, label: 'Programadas' },
                { k: 'sent' as const, label: 'Enviadas' },
                { k: 'failed' as const, label: 'Falha' },
                { k: 'all' as const, label: 'Todas' },
              ].map(f => (
                <button key={f.k} onClick={() => setFilter(f.k)}
                  className={clsx('min-w-0 px-1.5 py-2 rounded-md transition-colors whitespace-nowrap sm:px-3 sm:py-1.5', filter === f.k ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')}>
                  {f.label}
                </button>
              ))}
          </div>
          <div className="mt-3 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone ou conteúdo da mensagem..."
              className="w-full max-w-md pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>
          {filter === 'scheduled' && (
            <label className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 select-none w-fit cursor-pointer">
              <input type="checkbox" checked={onlyAuto} onChange={e => setOnlyAuto(e.target.checked)}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"/>
              Somente automáticas (Auto)
            </label>
          )}
        </div>

        <div className="max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin mr-2"/>Carregando...</div>
          ) : filteredItens.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <CalendarClock size={32} className="text-slate-300 mb-2"/>
              <p className="text-sm text-slate-500">Nenhuma mensagem agendada</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItens.map(it => it.kind === 'aviso' ? (
                <div key={it.key} className="bg-white border border-slate-100 rounded-xl px-4 py-3.5 flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <Stethoscope size={16} className={it.aviso.status !== 'enviado' ? 'text-sky-500' : 'text-slate-300'}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {it.aviso.contact?.full_name || 'Paciente desconhecido'}
                      </p>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', avisoStatusColor(it.aviso.status))}>
                        {avisoStatusLabel(it.aviso.status)}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-medium flex-shrink-0">Cirurgia</span>
                    </div>
                    <p className="text-xs font-medium text-slate-500 mb-0.5">{it.aviso.titulo}</p>
                    <p className="text-sm text-slate-600 line-clamp-2 mb-1">{it.aviso.texto}</p>
                    <p className="text-xs text-slate-400 flex items-center gap-1 flex-wrap">
                      <Clock size={10}/>
                      {it.aviso.status === 'enviado' ? 'Enviado' : 'Criado'} {avisoDateLabel(it.quando)} às {format(new Date(it.quando), 'HH:mm')}
                      <span className="text-slate-300">· Espera aprovação da equipe</span>
                    </p>
                  </div>
                  {it.aviso.status !== 'enviado' && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => setEditAviso(it.aviso)}
                        className="p-1.5 hover:bg-brand-50 rounded-lg text-slate-300 hover:text-brand-500 transition-colors"
                        title="Revisar e enviar">
                        <Pencil size={14}/>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div key={it.key} className="bg-white border border-slate-100 rounded-xl px-4 py-3.5 flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <CalendarClock size={16} className={isScheduledLike(it.msg.status) ? 'text-brand-500' : 'text-slate-300'}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {(it.msg.contact as any)?.full_name || 'Paciente desconhecido'}
                      </p>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', statusColor(it.msg.status))}>
                        {statusLabel(it.msg.status)}
                      </span>
                      {['automatic_reminder', 'appointment_confirmation'].includes(it.msg.origin) && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-medium flex-shrink-0">Auto</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 line-clamp-2 mb-1">{it.msg.content}</p>
                    <p className="text-xs text-slate-400 flex items-center gap-1 flex-wrap">
                      <Clock size={10}/>
                      {dateLabel(it.msg.scheduled_for, it.msg.status)} às {format(new Date(it.msg.scheduled_for), 'HH:mm')}
                      {authorLabel(it.msg) && <span className="text-slate-300">· Programado por {authorLabel(it.msg)}</span>}
                    </p>
                  </div>
                  {isScheduledLike(it.msg.status) && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => setEditMsg(it.msg)}
                        className="p-1.5 hover:bg-brand-50 rounded-lg text-slate-300 hover:text-brand-500 transition-colors"
                        title="Editar">
                        <Pencil size={14}/>
                      </button>
                      <button onClick={() => handleCancel(it.msg.id)}
                        className="p-1.5 hover:bg-red-50 rounded-lg text-slate-300 hover:text-red-500 transition-colors"
                        title="Excluir">
                        <X size={14}/>
                      </button>
                    </div>
                  )}
                  {it.msg.status === 'failed' && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* v48.111 — Falhou quase sempre porque o texto/telefone tinha
                          algum problema (ex.: número inválido); reenviar do jeito que
                          está tende a falhar de novo. Editar aqui já deixa pronta pra
                          reenviar, sem precisar apagar e criar um disparo novo. */}
                      <button onClick={() => setEditMsg(it.msg)}
                        className="p-1.5 hover:bg-brand-50 rounded-lg text-slate-300 hover:text-brand-500 transition-colors"
                        title="Editar e reenviar">
                        <Pencil size={14}/>
                      </button>
                      <button onClick={() => handleRetry(it.msg.id)}
                        className="p-1.5 hover:bg-brand-50 rounded-lg text-slate-300 hover:text-brand-500 transition-colors"
                        title="Tentar reenviar do jeito que está">
                        <RotateCcw size={14}/>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <NewDispatchModal
          agentId={agent?.id ?? null}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); loadMsgs() }}
        />
      )}

      {editMsg && (
        <EditScheduledModal
          msg={editMsg}
          onClose={() => setEditMsg(null)}
          onSaved={() => { setEditMsg(null); loadMsgs() }}
        />
      )}

      {editAviso && (
        <EditAvisoModal
          aviso={editAviso}
          onClose={() => setEditAviso(null)}
          onSaved={() => { setEditAviso(null); loadMsgs() }}
        />
      )}
    </div>
  )
}

function EditScheduledModal({ msg, onClose, onSaved }: { msg: any; onClose: () => void; onSaved: () => void }) {
  // v48.111 — Editar uma mensagem que FALHOU é diferente de editar uma ainda
  // programada: aqui o objetivo é corrigir o que causou a falha (número,
  // texto) e já deixar pronta pra tentar de novo — não só trocar o texto e
  // deixar "Falhou" na tela. Por isso Salvar, quando a origem é uma falha,
  // também volta o status pra "scheduled" e limpa o erro (mesma coisa que o
  // botão de reenviar faz, só que com o conteúdo já corrigido).
  const isFailed = msg.status === 'failed'
  const d = new Date(msg.scheduled_for)
  const [content, setContent] = useState(msg.content)
  const [date, setDate] = useState(format(d, 'yyyy-MM-dd'))
  const [time, setTime] = useState(format(d, 'HH:mm'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!content.trim()) { setError('Escreva a mensagem'); return }
    if (!date || !time) { setError('Defina data e hora'); return }
    const newDateTime = new Date(`${date}T${time}:00`)
    // Numa falha, o horário original já passou (é por isso que ela já foi
    // processada e falhou) — exigir data futura aqui só atrapalharia quem só
    // quer corrigir o texto e reenviar o quanto antes.
    if (!isFailed && newDateTime < new Date()) { setError('A data/hora deve ser no futuro'); return }
    setSaving(true)
    const dados: Record<string, any> = { content: content.trim(), scheduled_for: newDateTime.toISOString() }
    if (isFailed) { dados.status = 'scheduled'; dados.error_message = null }
    const { error: err } = await supabase.from('scheduled_messages').update(dados)
      .eq('id', msg.id).in('status', ['pending', 'scheduled', 'failed'])  // só edita se ainda programada ou com falha
    if (err) { setError('Erro ao salvar: ' + err.message); setSaving(false); return }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">{isFailed ? 'Corrigir e reenviar' : 'Editar agendamento'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {error && <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"><AlertCircle size={14}/>{error}</div>}
          {isFailed && msg.error_message && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-red-600 text-xs">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5"/>
              <span><strong>Motivo da falha:</strong> {msg.error_message}</span>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Mensagem</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={4}
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"/>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-slate-500 mb-1 block">Data</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"/>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-slate-500 mb-1 block">Hora</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"/>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
            {saving ? <Loader2 size={13} className="animate-spin"/> : <CheckCircle2 size={13}/>}
            {isFailed ? 'Salvar e reenviar' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// v48.111 — Aviso de cirurgia (notícia ao paciente) espera decisão humana,
// não tem "hora agendada" — Salvar aqui é sempre "revisei, pode ir" ou
// "não vai". Reaproveita a mesma API que já existe pra isso (MensagensEnviadas.tsx
// dentro da cirurgia), só que agora acessível desta lista central.
function EditAvisoModal({ aviso, onClose, onSaved }: { aviso: AvisoMsg; onClose: () => void; onSaved: () => void }) {
  const [texto, setTexto] = useState(aviso.texto)
  const [busy, setBusy] = useState<'enviar' | 'descartar' | ''>('')
  const [error, setError] = useState('')

  async function chamar(acao: 'enviar' | 'reenviar' | 'descartar') {
    if (acao !== 'descartar' && !texto.trim()) { setError('Escreva a mensagem'); return }
    setBusy(acao === 'descartar' ? 'descartar' : 'enviar'); setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/cirurgias/avisos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ id: aviso.id, acao, texto }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
      onSaved()
    } catch (e: any) { setError(e?.message || 'Não foi possível.'); setBusy('') }
  }

  const acaoEnviar = aviso.status === 'descartado' ? 'reenviar' : 'enviar'

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">{aviso.titulo}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-400">
            {aviso.status === 'descartado'
              ? 'Esta notícia foi descartada antes — revise e mande, ou deixe como está.'
              : 'Esta notícia espera aprovação antes de ir ao paciente — revise o texto, corrija se precisar, e decida.'}
          </p>
          {error && <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"><AlertCircle size={14}/>{error}</div>}
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={6}
            className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"/>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          <button onClick={() => chamar('descartar')} disabled={!!busy}
            title="Não mandar — se a situação mudar de novo, nasce outra pendência"
            className="px-3.5 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 flex items-center gap-1.5">
            {busy === 'descartar' ? <Loader2 size={13} className="animate-spin"/> : <Trash2 size={13}/>}
            Descartar
          </button>
          <button onClick={onClose} disabled={!!busy} className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Fechar</button>
          <button onClick={() => chamar(acaoEnviar)} disabled={!!busy || !texto.trim()}
            className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
            {busy === 'enviar' ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>}
            Enviar agora
          </button>
        </div>
      </div>
    </div>
  )
}

export function NewDispatchModal({ agentId, onClose, onSaved, initialContact }: { agentId: string | null; onClose: () => void; onSaved: () => void; initialContact?: {id: string; full_name: string; phone: string | null} | null }) {
  const [contacts, setContacts] = useState<{id: string; full_name: string; phone: string | null}[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [selectedContact, setSelectedContact] = useState<{id: string; full_name: string; phone: string | null} | null>(initialContact ?? null)
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<'now' | 'later'>('later')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('contacts').select('id,full_name,phone').ilike('full_name', `%${contactSearch}%`).limit(10)
      .then(({ data }) => setContacts(data ?? []))
  }, [contactSearch])

  async function handleSave() {
    if (!selectedContact || !content.trim()) { setError('Selecione um contato e escreva a mensagem.'); return }
    if (mode === 'later' && (!date || !time)) { setError('Informe data e hora para o agendamento.'); return }
    setSaving(true)
    const scheduledFor = mode === 'now' ? new Date().toISOString() : new Date(`${date}T${time}:00`).toISOString()
    const { error: err } = await supabase.from('scheduled_messages').insert({
      contact_id: selectedContact.id, content: content.trim(),
      scheduled_for: scheduledFor, status: mode === 'now' ? 'pending' : 'pending',
      origin: 'manual', created_by: agentId,
    })
    setSaving(false)
    if (err) { setError('Não foi possível salvar.'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800">Nova mensagem agendada</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>{error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Paciente</label>
            {selectedContact ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-brand-50 border border-brand-200 rounded-lg">
                <span className="text-sm font-medium text-brand-700 flex-1">{selectedContact.full_name}</span>
                <button onClick={() => setSelectedContact(null)} className="text-brand-400 hover:text-brand-700"><X size={14}/></button>
              </div>
            ) : (
              <div>
                <div className="relative mb-1">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input value={contactSearch} onChange={e => setContactSearch(e.target.value)}
                    placeholder="Buscar paciente..."
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                </div>
                {contacts.length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                    {contacts.map(c => (
                      <button key={c.id} onClick={() => setSelectedContact(c)}
                        className="w-full text-left px-3 py-2 hover:bg-brand-50 text-sm border-b border-slate-50 last:border-0">
                        <span className="font-medium text-slate-800">{c.full_name}</span>
                        <span className="text-slate-400 ml-2 text-xs">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Mensagem</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={4}
              placeholder="Digite a mensagem que será enviada ao paciente..."
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"/>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Quando enviar?</label>
            <div className="flex gap-2 mb-3">
              {(['now', 'later'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-lg border transition-colors',
                    mode === m ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50')}>
                  {m === 'now' ? <><Send size={13}/> Enviar agora</> : <><Clock size={13}/> Agendar</>}
                </button>
              ))}
            </div>
            {mode === 'later' && (
              <div className="flex gap-2">
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="flex-1 px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                <input type="time" value={time} onChange={e => setTime(e.target.value)}
                  className="w-28 px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} disabled={saving} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>}
            {mode === 'now' ? 'Enviar agora' : 'Agendar'}
          </button>
        </div>
      </div>
    </div>
  )
}
