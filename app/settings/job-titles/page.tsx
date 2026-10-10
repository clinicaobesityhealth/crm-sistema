'use client'
import { useState, useEffect } from 'react'
import { supabase, JobTitle } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { Plus, Pencil, Trash2, X, Save, Loader2, Contact, AlertCircle, Scissors, AlarmClock, Stethoscope, Bell, Inbox } from 'lucide-react'

export default function JobTitlesPage() {
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<JobTitle | null>(null)

  useEffect(() => { loadJobTitles() }, [])

  async function loadJobTitles() {
    setLoading(true)
    const { data } = await supabase.from('job_titles').select('*').order('name', { ascending: true })
    setJobTitles(data ?? [])
    setLoading(false)
  }

  // Liga e desliga o acesso à agenda cirúrgica direto na lista. Administrador
  // sempre enxerga, independentemente do cargo — este botão vale para os demais.
  async function alternarCirurgias(jobTitle: any) {
    const { error } = await supabase.from('job_titles')
      .update({ ve_cirurgias: !jobTitle.ve_cirurgias }).eq('id', jobTitle.id)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    loadJobTitles()
  }

  // v48.68 — Mesma ideia para a agenda pessoal: o acesso vem do cargo, não da
  // pessoa, então quem entra novo na função já nasce com a agenda dela.
  async function alternarAgendaPessoal(jobTitle: any) {
    const { error } = await supabase.from('job_titles')
      .update({ ve_agenda_pessoal: !jobTitle.ve_agenda_pessoal }).eq('id', jobTitle.id)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    loadJobTitles()
  }

  // v48.175 — Prontuário é dado clínico sensível: por padrão só cargos de
  // médico enxergam (a migração já liga sozinha para cargos com "médic(o)"
  // no nome). Aqui dá pra ajustar cargo a cargo, igual aos outros dois.
  async function alternarProntuario(jobTitle: any) {
    const { error } = await supabase.from('job_titles')
      .update({ ve_prontuario: !jobTitle.ve_prontuario }).eq('id', jobTitle.id)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    loadJobTitles()
  }

  // v48.158 — Aviso de WhatsApp pessoal quando um paciente já em atendimento
  // com esse cargo manda mensagem com ela offline (ou é transferido pra ela).
  async function alternarAvisarAtendimento(jobTitle: any) {
    const { error } = await supabase.from('job_titles')
      .update({ avisar_atendimento: !jobTitle.avisar_atendimento }).eq('id', jobTitle.id)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    loadJobTitles()
  }

  // v48.177 — Aviso de WhatsApp pessoal quando um paciente cai no Inbox
  // (ainda sem atendente) e ninguém desse cargo está com o CRM aberto.
  async function alternarAvisarInbox(jobTitle: any) {
    const { error } = await supabase.from('job_titles')
      .update({ avisar_inbox: !jobTitle.avisar_inbox }).eq('id', jobTitle.id)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    loadJobTitles()
  }

  function openCreate() {
    setEditing(null)
    setShowModal(true)
  }

  function openEdit(jobTitle: JobTitle) {
    setEditing(jobTitle)
    setShowModal(true)
  }

  async function handleDelete(jobTitle: JobTitle) {
    if (!confirm(`Remover o cargo "${jobTitle.name}"? Atendentes que já têm esse cargo salvo não são alterados, só deixa de aparecer na lista pra novos cadastros.`)) return
    await supabase.from('job_titles').delete().eq('id', jobTitle.id)
    loadJobTitles()
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Cargos</h1>
            <p className="text-xs text-slate-400 mt-0.5">Lista de cargos disponíveis ao cadastrar um atendente. As marcas ao lado de cada um dizem se aquele cargo enxerga a agenda cirúrgica, tem agenda pessoal, vê o Prontuário e recebe avisos de WhatsApp pessoal (atendimento e Inbox) — administradores enxergam tudo sempre.</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors">
            <Plus size={15}/> Novo cargo
          </button>
        </div>

        <div className="max-w-2xl px-6 py-8">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin mr-2"/> Carregando...
            </div>
          ) : jobTitles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Contact size={28} className="text-slate-300 mb-2"/>
              <p className="text-sm text-slate-500">Nenhum cargo cadastrado ainda</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobTitles.map(jobTitle => (
                <div key={jobTitle.id} className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-4 py-3.5">
                  <Contact size={16} className="text-slate-300 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{jobTitle.name}</p>
                  </div>
                  <button
                    onClick={() => alternarCirurgias(jobTitle)}
                    title={(jobTitle as any).ve_cirurgias
                      ? 'Este cargo vê a agenda cirúrgica — clique para tirar'
                      : 'Este cargo não vê a agenda cirúrgica — clique para liberar'}
                    className={'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0 transition-colors '
                      + ((jobTitle as any).ve_cirurgias
                        ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200')}>
                    <Scissors size={12}/>
                    <span className="hidden sm:inline">{(jobTitle as any).ve_cirurgias ? 'vê cirurgias' : 'sem cirurgias'}</span>
                  </button>
                  <button
                    onClick={() => alternarAgendaPessoal(jobTitle)}
                    title={(jobTitle as any).ve_agenda_pessoal
                      ? 'Este cargo tem agenda pessoal — clique para tirar'
                      : 'Este cargo não tem agenda pessoal — clique para liberar'}
                    className={'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0 transition-colors '
                      + ((jobTitle as any).ve_agenda_pessoal
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200')}>
                    <AlarmClock size={12}/>
                    <span className="hidden sm:inline">{(jobTitle as any).ve_agenda_pessoal ? 'tem agenda' : 'sem agenda'}</span>
                  </button>
                  <button
                    onClick={() => alternarProntuario(jobTitle)}
                    title={(jobTitle as any).ve_prontuario
                      ? 'Este cargo vê o Prontuário (histórico clínico) — clique para tirar'
                      : 'Este cargo não vê o Prontuário — clique para liberar'}
                    className={'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0 transition-colors '
                      + ((jobTitle as any).ve_prontuario
                        ? 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200')}>
                    <Stethoscope size={12}/>
                    <span className="hidden sm:inline">{(jobTitle as any).ve_prontuario ? 'vê prontuário' : 'sem prontuário'}</span>
                  </button>
                  <button
                    onClick={() => alternarAvisarAtendimento(jobTitle)}
                    title={(jobTitle as any).avisar_atendimento
                      ? 'Recebe aviso de WhatsApp pessoal quando um paciente dela manda mensagem offline (ou é transferido) — clique para tirar'
                      : 'Não recebe esse aviso — clique para ligar'}
                    className={'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0 transition-colors '
                      + ((jobTitle as any).avisar_atendimento
                        ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200')}>
                    <Bell size={12}/>
                    <span className="hidden sm:inline">{(jobTitle as any).avisar_atendimento ? 'avisa atendimento' : 'sem aviso'}</span>
                  </button>
                  <button
                    onClick={() => alternarAvisarInbox(jobTitle)}
                    title={(jobTitle as any).avisar_inbox
                      ? 'Recebe aviso de WhatsApp pessoal quando cai paciente no Inbox e ninguém desse cargo está online — clique para tirar'
                      : 'Não recebe esse aviso — clique para ligar'}
                    className={'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0 transition-colors '
                      + ((jobTitle as any).avisar_inbox
                        ? 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200')}>
                    <Inbox size={12}/>
                    <span className="hidden sm:inline">{(jobTitle as any).avisar_inbox ? 'avisa inbox' : 'sem aviso inbox'}</span>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(jobTitle)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-brand-600 transition-colors">
                      <Pencil size={14}/>
                    </button>
                    <button onClick={() => handleDelete(jobTitle)} className="p-2 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors">
                      <Trash2 size={14}/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <JobTitleModal
          jobTitle={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); loadJobTitles() }}
        />
      )}
    </div>
  )
}

function JobTitleModal({ jobTitle, onClose, onSaved }: { jobTitle: JobTitle | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(jobTitle?.name || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('O nome do cargo é obrigatório.'); return }
    setSaving(true)
    setError('')

    const payload = { name: name.trim() }

    const { error: err } = jobTitle
      ? await supabase.from('job_titles').update(payload).eq('id', jobTitle.id)
      : await supabase.from('job_titles').insert({ ...payload, clinic_id: '00000000-0000-0000-0000-000000000001' })

    setSaving(false)
    if (err) { setError('Não foi possível salvar. Verifique se já existe um cargo com esse nome.'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">{jobTitle ? 'Editar cargo' : 'Novo cargo'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
            <X size={18}/>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Nome do cargo</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Médico(a), Secretária, Nutricionista..."
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
