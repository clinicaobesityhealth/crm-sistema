'use client'
import { useState, useEffect } from 'react'
import { supabase, Professional, ProfessionalScheduleBlock, DiaSemana } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import {
  Plus, X, Save, Loader2, AlertCircle, Trash2, Pencil, ChevronDown, ChevronRight,
  Stethoscope, Clock, Coffee, Repeat, CalendarDays, Check
} from 'lucide-react'
import clsx from 'clsx'

const DIAS_SEMANA: { value: DiaSemana; label: string; short: string }[] = [
  { value: 'dom', label: 'Domingo', short: 'Dom' },
  { value: 'seg', label: 'Segunda-feira', short: 'Seg' },
  { value: 'ter', label: 'Terça-feira', short: 'Ter' },
  { value: 'qua', label: 'Quarta-feira', short: 'Qua' },
  { value: 'qui', label: 'Quinta-feira', short: 'Qui' },
  { value: 'sex', label: 'Sexta-feira', short: 'Sex' },
  { value: 'sab', label: 'Sábado', short: 'Sáb' },
]

const DIA_ORDER: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 }

function diaLabel(dia: string) {
  return DIAS_SEMANA.find(d => d.value === dia)?.label ?? dia
}
function diaShort(dia: string) {
  return DIAS_SEMANA.find(d => d.value === dia)?.short ?? dia
}
function fmtTime(t: string) {
  return t ? t.slice(0, 5) : ''
}

export default function AgendaConfigPage() {
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [blocksByProf, setBlocksByProf] = useState<Record<string, ProfessionalScheduleBlock[]>>({})
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [reminderEnabled, setReminderEnabled] = useState(true)
  const [reminderDays, setReminderDays] = useState('1')
  const [reminderTime, setReminderTime] = useState('10:00')
  const [savingReminder, setSavingReminder] = useState(false)
  const [reminderSaved, setReminderSaved] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: profs }, { data: blocks }, { data: settings }] = await Promise.all([
      supabase.from('professionals').select('*').order('nome'),
      supabase.from('professional_schedule_blocks').select('*'),
      supabase.from('clinic_settings').select('id,consulta_reminder_enabled,consulta_reminder_days_before,consulta_reminder_time').limit(1).maybeSingle(),
    ])
    setProfessionals(profs ?? [])
    const grouped: Record<string, ProfessionalScheduleBlock[]> = {}
    ;(blocks ?? []).forEach((b: ProfessionalScheduleBlock) => {
      if (!grouped[b.professional_id]) grouped[b.professional_id] = []
      grouped[b.professional_id].push(b)
    })
    Object.values(grouped).forEach(arr => arr.sort((a, b) =>
      (DIA_ORDER[a.dia_semana] - DIA_ORDER[b.dia_semana]) || a.hora_inicio.localeCompare(b.hora_inicio)
    ))
    setBlocksByProf(grouped)
    if (settings) {
      setReminderEnabled(settings.consulta_reminder_enabled !== false)
      setReminderDays(String(settings.consulta_reminder_days_before ?? 1))
      setReminderTime((settings.consulta_reminder_time ?? '10:00').slice(0, 5))
    }
    setLoading(false)
  }

  async function saveReminderConfig() {
    const days = Number(reminderDays)
    if (!Number.isInteger(days) || days < 0 || days > 30) return
    setSavingReminder(true); setReminderSaved(false)
    const { data: current } = await supabase.from('clinic_settings').select('id').limit(1).maybeSingle()
    const payload = {
      consulta_reminder_enabled: reminderEnabled,
      consulta_reminder_days_before: days,
      consulta_reminder_time: reminderTime,
      updated_at: new Date().toISOString(),
    }
    const result = current?.id
      ? await supabase.from('clinic_settings').update(payload).eq('id', current.id)
      : await supabase.from('clinic_settings').insert(payload)
    setSavingReminder(false)
    if (!result.error) { setReminderSaved(true); setTimeout(() => setReminderSaved(false), 2000) }
  }

  async function toggleAtivo(prof: Professional) {
    await supabase.from('professionals').update({ ativo: !prof.ativo, updated_at: new Date().toISOString() }).eq('id', prof.id)
    loadAll()
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Configuração de Agenda</h1>
            <p className="text-xs text-slate-400 mt-0.5">{professionals.length} profissional(is) cadastrado(s)</p>
          </div>
          <button onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors">
            <Plus size={15}/> Novo profissional
          </button>
        </div>

        <div className="max-w-3xl px-6 py-8 space-y-3">
          <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Confirmação automática de consultas</h2>
                <p className="text-xs text-slate-400 mt-0.5">Usa a Agenda de Disparos e não cria conversas paralelas.</p>
              </div>
              <Toggle checked={reminderEnabled} onChange={() => setReminderEnabled(v => !v)}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Dias antes da consulta</label>
                <input value={reminderDays} onChange={e => setReminderDays(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Horário do envio</label>
                <input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg"/>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={saveReminderConfig} disabled={savingReminder || !reminderTime}
                className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                {savingReminder ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} {reminderSaved ? 'Salvo!' : 'Salvar lembrete'}
              </button>
            </div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin mr-2"/> Carregando...
            </div>
          ) : professionals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Stethoscope size={28} className="text-slate-300 mb-2"/>
              <p className="text-sm text-slate-500">Nenhum profissional cadastrado ainda</p>
            </div>
          ) : (
            professionals.map(prof => (
              <ProfessionalCard
                key={prof.id}
                professional={prof}
                blocks={blocksByProf[prof.id] ?? []}
                expanded={expandedId === prof.id}
                onToggleExpand={() => setExpandedId(expandedId === prof.id ? null : prof.id)}
                onToggleAtivo={() => toggleAtivo(prof)}
                onChanged={loadAll}
              />
            ))
          )}
        </div>
      </div>

      {showNewModal && (
        <NewProfessionalModal
          onClose={() => setShowNewModal(false)}
          onCreated={(id) => { setShowNewModal(false); setExpandedId(id); loadAll() }}
        />
      )}
    </div>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={clsx(
        'relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
        checked ? 'bg-brand-600' : 'bg-slate-200',
        disabled && 'opacity-50 cursor-not-allowed'
      )}>
      <span className={clsx(
        'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
        checked && 'translate-x-4'
      )}/>
    </button>
  )
}

function ProfessionalCard({ professional, blocks, expanded, onToggleExpand, onToggleAtivo, onChanged }: {
  professional: Professional
  blocks: ProfessionalScheduleBlock[]
  expanded: boolean
  onToggleExpand: () => void
  onToggleAtivo: () => void
  onChanged: () => void
}) {
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [editingBlock, setEditingBlock] = useState<ProfessionalScheduleBlock | null>(null)

  function openNewBlock() { setEditingBlock(null); setShowBlockModal(true) }
  function openEditBlock(b: ProfessionalScheduleBlock) { setEditingBlock(b); setShowBlockModal(true) }

  async function handleDeleteBlock(b: ProfessionalScheduleBlock) {
    if (!confirm(`Remover o horário de ${diaLabel(b.dia_semana)} (${fmtTime(b.hora_inicio)}–${fmtTime(b.hora_fim)})?`)) return
    await supabase.from('professional_schedule_blocks').delete().eq('id', b.id)
    onChanged()
  }

  return (
    <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-slate-50 transition-colors" onClick={onToggleExpand}>
        {expanded ? <ChevronDown size={16} className="text-slate-400 flex-shrink-0"/> : <ChevronRight size={16} className="text-slate-400 flex-shrink-0"/>}
        <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 flex-shrink-0">
          <Stethoscope size={16}/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{professional.nome}</p>
          <p className="text-xs text-slate-400 truncate">
            ID Medx {professional.id_medx}{professional.especialidade ? ` · ${professional.especialidade}` : ''} · {blocks.length} horário(s)
          </p>
        </div>
        <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0',
          professional.ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
          {professional.ativo ? 'Ativo' : 'Inativo'}
        </span>
        <div onClick={e => e.stopPropagation()}>
          <Toggle checked={professional.ativo} onChange={onToggleAtivo}/>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-5 space-y-6 bg-slate-50/60">
          <ProfessionalForm key={professional.updated_at} professional={professional} onSaved={onChanged}/>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Clock size={14} className="text-brand-500"/> Horários de atendimento
              </h3>
              <button onClick={openNewBlock}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors">
                <Plus size={13}/> Adicionar horário
              </button>
            </div>

            {blocks.length === 0 ? (
              <p className="text-xs text-slate-400 px-1">Nenhum horário cadastrado ainda.</p>
            ) : (
              <div className="space-y-2">
                {blocks.map(b => (
                  <div key={b.id} className={clsx('flex items-center gap-3 bg-white border rounded-lg px-3.5 py-3',
                    b.ativo ? 'border-slate-200' : 'border-slate-100 opacity-60')}>
                    <span className="text-xs font-semibold text-slate-700 bg-slate-100 rounded-md px-2 py-1 flex-shrink-0 w-11 text-center">
                      {diaShort(b.dia_semana)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 flex items-center flex-wrap gap-x-2 gap-y-0.5">
                        <span>{fmtTime(b.hora_inicio)} – {fmtTime(b.hora_fim)}</span>
                        {b.almoco_inicio && b.almoco_fim && (
                          <span className="text-xs text-amber-600 inline-flex items-center gap-1">
                            <Coffee size={11}/> almoço {fmtTime(b.almoco_inicio)}–{fmtTime(b.almoco_fim)}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {b.duracao_min ? `${b.duracao_min} min` : `${professional.duracao_min} min (padrão)`}
                        {b.quinzenal && ` · Quinzenal (semana ${b.semana_quinzenal ?? '-'})`}
                        {!b.ativo && ' · Inativo'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openEditBlock(b)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-brand-600 transition-colors">
                        <Pencil size={13}/>
                      </button>
                      <button onClick={() => handleDeleteBlock(b)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors">
                        <Trash2 size={13}/>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showBlockModal && (
        <ScheduleBlockModal
          professional={professional}
          block={editingBlock}
          onClose={() => setShowBlockModal(false)}
          onSaved={() => { setShowBlockModal(false); onChanged() }}
        />
      )}
    </div>
  )
}

function ProfessionalForm({ professional, onSaved }: { professional: Professional; onSaved: () => void }) {
  const [nome, setNome] = useState(professional.nome)
  const [idMedx, setIdMedx] = useState(String(professional.id_medx))
  const [email, setEmail] = useState(professional.email || '')
  const [especialidade, setEspecialidade] = useState(professional.especialidade || '')
  const [areasText, setAreasText] = useState((professional.areas_de_atuacao || []).join(', '))
  const [duracaoMin, setDuracaoMin] = useState(String(professional.duracao_min))
  const [modalidade, setModalidade] = useState<string[]>(professional.modalidade || [])
  const [ativo, setAtivo] = useState(professional.ativo)
  const [valorComRetorno, setValorComRetorno] = useState(professional.valor_consulta_com_retorno?.toString() ?? '')
  const [valorSemRetorno, setValorSemRetorno] = useState(professional.valor_consulta_sem_retorno?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function toggleModalidade(m: string) {
    setModalidade(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }

  async function handleSave() {
    if (!nome.trim()) { setError('O nome é obrigatório.'); return }
    const idMedxNum = parseInt(idMedx, 10)
    if (!idMedx.trim() || isNaN(idMedxNum)) { setError('O ID Medx deve ser um número.'); return }
    const duracaoNum = parseInt(duracaoMin, 10)
    if (!duracaoMin.trim() || isNaN(duracaoNum) || duracaoNum <= 0) { setError('Informe uma duração padrão válida.'); return }

    setSaving(true); setError(''); setSaved(false)
    const payload = {
      nome: nome.trim(),
      id_medx: idMedxNum,
      email: email.trim() || null,
      especialidade: especialidade.trim() || null,
      areas_de_atuacao: areasText.split(',').map(s => s.trim()).filter(Boolean),
      duracao_min: duracaoNum,
      modalidade,
      ativo,
      valor_consulta_com_retorno: valorComRetorno.trim() ? Number(valorComRetorno.replace(',', '.')) : null,
      valor_consulta_sem_retorno: valorSemRetorno.trim() ? Number(valorSemRetorno.replace(',', '.')) : null,
      updated_at: new Date().toISOString(),
    }
    const { error: err } = await supabase.from('professionals').update(payload).eq('id', professional.id)
    setSaving(false)
    if (err) { setError('Não foi possível salvar. Verifique se o ID Medx já não está em uso.'); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onSaved()
  }

  async function handleDelete() {
    if (!confirm(`Remover "${professional.nome}" e todos os seus horários cadastrados? Essa ação não pode ser desfeita.`)) return
    await supabase.from('professionals').delete().eq('id', professional.id)
    onSaved()
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>{error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Nome completo</label>
          <input value={nome} onChange={e => setNome(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">ID Medx</label>
          <input value={idMedx} onChange={e => setIdMedx(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">E-mail de login (opcional)</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Ex: giovanni@obesityhealth.com.br"
          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        <p className="text-xs text-slate-400 mt-1.5">
          Se o médico tem login próprio no CRM com esse e-mail (em Configurações → Atendentes), a Agenda Médica
          dele mostra automaticamente só os horários dele. Deixe em branco se ele não acessa o CRM diretamente.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Especialidade</label>
        <input value={especialidade} onChange={e => setEspecialidade(e.target.value)} placeholder="Ex: Cirurgia bariátrica"
          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Áreas de atuação</label>
        <input value={areasText} onChange={e => setAreasText(e.target.value)}
          placeholder="Separadas por vírgula. Ex: Obesidade, Diabetes, Pós-bariátrica"
          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Duração padrão da consulta (min)</label>
          <input value={duracaoMin} onChange={e => setDuracaoMin(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Modalidade</label>
          <div className="flex gap-2">
            {['Presencial', 'Online'].map(m => {
              const on = modalidade.includes(m)
              return (
                <button key={m} type="button" onClick={() => toggleModalidade(m)}
                  className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold rounded-lg border-2 transition-colors',
                    on ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-slate-100 border-slate-300 text-slate-400')}>
                  {on ? <Check size={14}/> : <X size={14}/>}
                  {m}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Valor da consulta com retorno (R$)</label>
          <input value={valorComRetorno} onChange={e => setValorComRetorno(e.target.value)} placeholder="0,00" inputMode="decimal"
            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Valor da consulta sem retorno (R$)</label>
          <input value={valorSemRetorno} onChange={e => setValorSemRetorno(e.target.value)} placeholder="0,00" inputMode="decimal"
            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
      </div>

      <label className="flex items-center gap-3 px-3.5 py-3 bg-white border border-slate-200 rounded-lg cursor-pointer w-fit">
        <Toggle checked={ativo} onChange={() => setAtivo(a => !a)}/>
        <span className="text-sm font-medium text-slate-700">Profissional ativo</span>
      </label>

      <div className="flex items-center justify-between pt-1">
        <button onClick={handleDelete}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors">
          <Trash2 size={13}/> Remover profissional
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
          {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
          {saved ? 'Salvo!' : 'Salvar alterações'}
        </button>
      </div>
    </div>
  )
}

function NewProfessionalModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [nome, setNome] = useState('')
  const [idMedx, setIdMedx] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!nome.trim()) { setError('O nome é obrigatório.'); return }
    const idMedxNum = parseInt(idMedx, 10)
    if (!idMedx.trim() || isNaN(idMedxNum)) { setError('O ID Medx deve ser um número.'); return }
    setSaving(true); setError('')
    const { data, error: err } = await supabase.from('professionals')
      .insert({ nome: nome.trim(), id_medx: idMedxNum })
      .select('id')
      .single()
    setSaving(false)
    if (err || !data) { setError('Não foi possível criar. Verifique se o ID Medx já não está em uso.'); return }
    onCreated(data.id)
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Novo profissional</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"><X size={18}/></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>{error}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Nome completo</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Dr. João Jorge"
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">ID Medx</label>
            <input value={idMedx} onChange={e => setIdMedx(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="Ex: 123"
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>
          <p className="text-xs text-slate-400">
            Os demais dados (especialidade, valores, horários...) podem ser preenchidos depois de criar o profissional.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={handleCreate} disabled={saving}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
            Criar profissional
          </button>
        </div>
      </div>
    </div>
  )
}

function ScheduleBlockModal({ professional, block, onClose, onSaved }: {
  professional: Professional
  block: ProfessionalScheduleBlock | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!block
  const [diaSemana, setDiaSemana] = useState<DiaSemana>(block?.dia_semana ?? 'seg')
  const [horaInicio, setHoraInicio] = useState(block ? fmtTime(block.hora_inicio) : '08:00')
  const [horaFim, setHoraFim] = useState(block ? fmtTime(block.hora_fim) : '18:00')
  const [temAlmoco, setTemAlmoco] = useState(!!(block?.almoco_inicio && block?.almoco_fim))
  const [almocoInicio, setAlmocoInicio] = useState(block?.almoco_inicio ? fmtTime(block.almoco_inicio) : '12:00')
  const [almocoFim, setAlmocoFim] = useState(block?.almoco_fim ? fmtTime(block.almoco_fim) : '13:00')
  const [duracaoMin, setDuracaoMin] = useState(block?.duracao_min?.toString() ?? '')
  const [quinzenal, setQuinzenal] = useState(block?.quinzenal ?? false)
  const [semanaQuinzenal, setSemanaQuinzenal] = useState<'A' | 'B'>(block?.semana_quinzenal ?? 'A')
  const [valorComRetorno, setValorComRetorno] = useState(block?.valor_consulta_com_retorno?.toString() ?? '')
  const [valorSemRetorno, setValorSemRetorno] = useState(block?.valor_consulta_sem_retorno?.toString() ?? '')
  const [ativo, setAtivo] = useState(block?.ativo ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!horaInicio || !horaFim) { setError('Informe o horário de início e fim.'); return }
    if (horaFim <= horaInicio) { setError('O horário de término deve ser depois do início.'); return }
    if (temAlmoco && (!almocoInicio || !almocoFim || almocoFim <= almocoInicio)) {
      setError('Informe um intervalo de almoço válido, ou desative a opção de almoço.'); return
    }

    setSaving(true); setError('')
    const payload = {
      professional_id: professional.id,
      dia_semana: diaSemana,
      hora_inicio: horaInicio,
      hora_fim: horaFim,
      almoco_inicio: temAlmoco ? almocoInicio : null,
      almoco_fim: temAlmoco ? almocoFim : null,
      duracao_min: duracaoMin.trim() ? parseInt(duracaoMin, 10) : null,
      quinzenal,
      semana_quinzenal: quinzenal ? semanaQuinzenal : null,
      valor_consulta_com_retorno: valorComRetorno.trim() ? Number(valorComRetorno.replace(',', '.')) : null,
      valor_consulta_sem_retorno: valorSemRetorno.trim() ? Number(valorSemRetorno.replace(',', '.')) : null,
      ativo,
      updated_at: new Date().toISOString(),
    }

    const { error: err } = isEdit
      ? await supabase.from('professional_schedule_blocks').update(payload).eq('id', block!.id)
      : await supabase.from('professional_schedule_blocks').insert(payload)

    setSaving(false)
    if (err) { setError('Não foi possível salvar o horário. Tente novamente.'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800">
            {isEdit ? 'Editar horário' : 'Novo horário'} <span className="text-slate-400 font-normal">— {professional.nome}</span>
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>{error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1.5">
              <CalendarDays size={12}/> Dia da semana
            </label>
            <select value={diaSemana} onChange={e => setDiaSemana(e.target.value as DiaSemana)}
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              {DIAS_SEMANA.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Início do atendimento</label>
              <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Fim do atendimento</label>
              <input type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </div>
          </div>

          {/* Intervalo de almoço — campo novo, mantido bem visível conforme pedido */}
          <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-3.5">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={temAlmoco} onChange={e => setTemAlmoco(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"/>
              <span className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
                <Coffee size={14}/> Intervalo de almoço
              </span>
            </label>
            {temAlmoco && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Início do almoço</label>
                  <input type="time" value={almocoInicio} onChange={e => setAlmocoInicio(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Fim do almoço</label>
                  <input type="time" value={almocoFim} onChange={e => setAlmocoFim(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Duração da consulta neste horário (min)</label>
            <input value={duracaoMin} onChange={e => setDuracaoMin(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
              placeholder={`Padrão do profissional: ${professional.duracao_min} min`}
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>

          <div className="border border-slate-200 rounded-lg p-3.5">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={quinzenal} onChange={e => setQuinzenal(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"/>
              <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <Repeat size={14}/> Atendimento quinzenal
              </span>
            </label>
            {quinzenal && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Semana</label>
                <div className="flex gap-2">
                  {(['A', 'B'] as const).map(s => (
                    <button key={s} type="button" onClick={() => setSemanaQuinzenal(s)}
                      className={clsx('flex-1 py-2 text-sm font-medium rounded-lg border transition-colors',
                        semanaQuinzenal === s ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50')}>
                      Semana {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Valor com retorno (R$)</label>
              <input value={valorComRetorno} onChange={e => setValorComRetorno(e.target.value)} inputMode="decimal"
                placeholder={professional.valor_consulta_com_retorno != null ? `Padrão: ${professional.valor_consulta_com_retorno}` : '0,00'}
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Valor sem retorno (R$)</label>
              <input value={valorSemRetorno} onChange={e => setValorSemRetorno(e.target.value)} inputMode="decimal"
                placeholder={professional.valor_consulta_sem_retorno != null ? `Padrão: ${professional.valor_consulta_sem_retorno}` : '0,00'}
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </div>
          </div>

          <label className="flex items-center gap-3 px-3.5 py-3 bg-slate-50 rounded-lg cursor-pointer w-fit">
            <Toggle checked={ativo} onChange={() => setAtivo(a => !a)}/>
            <span className="text-sm font-medium text-slate-700">Horário ativo</span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} disabled={saving} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
            {isEdit ? 'Salvar horário' : 'Adicionar horário'}
          </button>
        </div>
      </div>
    </div>
  )
}
