'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { Plus, Loader2, Trash2, CalendarDays, Landmark, Building2, AlertCircle, MapPin, Save, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'

type Holiday = {
  id: string
  data: string
  nome: string
  abrangencia: 'nacional' | 'municipal' | null
  cidade: string | null
  created_at: string
}

function fmtDate(d: string) {
  // d vem como 'YYYY-MM-DD'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

export default function FeriadosPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [novaData, setNovaData] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [novaAbrangencia, setNovaAbrangencia] = useState<'nacional' | 'municipal'>('municipal')
  const [novaCidade, setNovaCidade] = useState('')
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // v47.06 — a "Localização da clínica" veio de Configurações → WhatsApp para cá.
  // É aqui que ela faz sentido: é o que define quais feriados municipais valem.
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')
  const [savingLocation, setSavingLocation] = useState(false)
  const [locationSaved, setLocationSaved] = useState(false)
  const [locationError, setLocationError] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: hol }, { data: settings }] = await Promise.all([
      supabase.from('holidays').select('*').order('data'),
      supabase.from('clinic_settings').select('id, cidade, estado').limit(1),
    ])
    setHolidays(hol ?? [])
    const cfg = settings?.[0] as any
    if (cfg?.id) setSettingsId(cfg.id)
    if (cfg?.cidade) { setCidade(cfg.cidade); setNovaCidade(cfg.cidade) }
    if (cfg?.estado) setEstado(cfg.estado)
    setLoading(false)
  }

  async function saveLocation() {
    setSavingLocation(true); setLocationError('')
    const payload = { cidade: cidade.trim() || null, estado: estado.trim().toUpperCase() || null }
    let query = supabase.from('clinic_settings').update(payload)
    query = settingsId ? query.eq('id', settingsId) : query.not('id', 'is', null)
    const { error: err } = await query
    setSavingLocation(false)
    if (err) { setLocationError('Erro ao salvar: ' + err.message); return }
    setCidade(payload.cidade || '')
    setEstado(payload.estado || '')
    if (payload.cidade) setNovaCidade(payload.cidade)
    setLocationSaved(true)
    setTimeout(() => setLocationSaved(false), 2500)
  }

  async function handleCreate() {
    if (!novaData || !novoNome.trim()) return
    if (novaAbrangencia === 'municipal' && !novaCidade.trim()) {
      setError('Informe a cidade para feriados municipais')
      return
    }
    setCreating(true)
    setError('')
    const { error: err } = await supabase.from('holidays').insert({
      data: novaData,
      nome: novoNome.trim(),
      abrangencia: novaAbrangencia,
      cidade: novaAbrangencia === 'municipal' ? novaCidade.trim() : null,
    })
    if (err) { setError('Erro ao salvar: ' + err.message); setCreating(false); return }
    setNovaData(''); setNovoNome('')
    setCreating(false)
    loadAll()
  }

  async function handleDelete(h: Holiday) {
    const aviso = h.abrangencia === 'nacional'
      ? `"${h.nome}" (${fmtDate(h.data)}) é um feriado NACIONAL. Removê-lo pode liberar horários de agenda indevidamente em todo o Brasil. Deseja mesmo excluir?`
      : `Excluir o feriado "${h.nome}" (${fmtDate(h.data)})? Isso liberará esse dia na agenda.`
    if (!confirm(aviso)) return
    setDeletingId(h.id)
    await supabase.from('holidays').delete().eq('id', h.id)
    setHolidays(prev => prev.filter(x => x.id !== h.id))
    setDeletingId(null)
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-800">Feriados</h1>
          <p className="text-xs text-slate-400 mt-0.5">Datas que bloqueiam o agendamento de horários</p>
        </div>

        <div className="max-w-2xl px-6 py-8">
          {/* Localização da clínica — veio de Configurações → WhatsApp na v47.06 */}
          <div className="bg-white border border-slate-100 rounded-xl p-4 mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-brand-500"/>
              <p className="text-sm font-medium text-slate-700">Localização da clínica</p>
            </div>
            <p className="text-xs text-slate-400">Define quais feriados municipais bloqueiam horários na agenda.</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-slate-500 mb-1 block">Cidade</label>
                <input value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Ex: São Paulo"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
              <div className="w-20">
                <label className="text-xs text-slate-500 mb-1 block">UF</label>
                <input value={estado} onChange={e => setEstado(e.target.value.toUpperCase())} placeholder="SP" maxLength={2}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 uppercase"/>
              </div>
            </div>
            {locationError && (
              <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{locationError}</div>
            )}
            <button onClick={saveLocation} disabled={savingLocation}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
              {savingLocation ? <Loader2 size={14} className="animate-spin"/> : locationSaved ? <CheckCircle2 size={14}/> : <Save size={14}/>}
              {locationSaved ? 'Salvo!' : 'Salvar localização'}
            </button>
          </div>

          {/* Novo feriado */}
          <div className="bg-white border border-slate-100 rounded-xl p-4 mb-6">
            <p className="text-sm font-medium text-slate-700 mb-3">Novo feriado municipal</p>
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <input type="date" value={novaData} onChange={e => setNovaData(e.target.value)}
                className="w-full sm:w-40 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="Nome do feriado..."
                className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              <select value={novaAbrangencia} onChange={e => setNovaAbrangencia(e.target.value as 'nacional' | 'municipal')}
                className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="municipal">Municipal</option>
                <option value="nacional">Nacional</option>
              </select>
            </div>
            {novaAbrangencia === 'municipal' && (
              <div className="mb-3">
                <input value={novaCidade} onChange={e => setNovaCidade(e.target.value)}
                  placeholder="Cidade"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
            )}
            {error && (
              <div className="mb-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                <AlertCircle size={14}/> {error}
              </div>
            )}
            <button onClick={handleCreate} disabled={creating || !novaData || !novoNome.trim()}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2">
              {creating ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>} Adicionar feriado
            </button>
          </div>

          {/* Lista */}
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin mr-2"/> Carregando...
            </div>
          ) : holidays.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <CalendarDays size={32} className="text-slate-300 mb-2"/>
              <p className="text-sm text-slate-500">Nenhum feriado cadastrado ainda</p>
            </div>
          ) : (
            <div className="space-y-2">
              {holidays.map(h => (
                <div key={h.id} className={clsx('bg-white border rounded-xl px-4 py-3 flex items-center gap-3',
                  h.abrangencia === 'nacional' ? 'border-slate-100' : 'border-brand-100')}>
                  <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                    h.abrangencia === 'nacional' ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-600')}>
                    {h.abrangencia === 'nacional' ? <Landmark size={16}/> : <Building2 size={16}/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-700">{h.nome}</span>
                      <span className={clsx('text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded',
                        h.abrangencia === 'nacional' ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-600')}>
                        {h.abrangencia === 'nacional' ? 'Nacional' : 'Municipal'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {fmtDate(h.data)}{h.cidade ? ` · ${h.cidade}` : ''}
                    </p>
                  </div>
                  <button onClick={() => handleDelete(h)} disabled={deletingId === h.id}
                    className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 disabled:opacity-50">
                    {deletingId === h.id ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
