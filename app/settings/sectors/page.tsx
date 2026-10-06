'use client'
import { useState, useEffect } from 'react'
import { supabase, Sector } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import {
  Plus, Pencil, Trash2, X, Save, Loader2, Briefcase, Lock, AlertCircle
} from 'lucide-react'
import clsx from 'clsx'

const COLOR_OPTIONS = ['#0c8ee7', '#10b981', '#7c3aed', '#f59e0b', '#ef4444', '#ec4899', '#0891b2', '#475569']

export default function SectorsPage() {
  const [sectors, setSectors] = useState<Sector[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Sector | null>(null)

  useEffect(() => { loadSectors() }, [])

  async function loadSectors() {
    setLoading(true)
    const { data } = await supabase.from('sectors').select('*').order('created_at', { ascending: true })
    setSectors(data ?? [])
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setShowModal(true)
  }

  function openEdit(sector: Sector) {
    setEditing(sector)
    setShowModal(true)
  }

  async function handleDelete(sector: Sector) {
    if (!confirm(`Remover o setor "${sector.name}"? Pacientes vinculados a ele ficarão sem setor.`)) return
    await supabase.from('sectors').delete().eq('id', sector.id)
    loadSectors()
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Setores</h1>
            <p className="text-xs text-slate-400 mt-0.5">Organize os setores de atendimento da clínica</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors">
            <Plus size={15}/> Novo setor
          </button>
        </div>

        <div className="max-w-2xl px-6 py-8">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin mr-2"/> Carregando...
            </div>
          ) : sectors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Briefcase size={28} className="text-slate-300 mb-2"/>
              <p className="text-sm text-slate-500">Nenhum setor cadastrado ainda</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sectors.map(sector => (
                <div key={sector.id} className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-4 py-3.5">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: sector.color }}/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{sector.name}</p>
                  </div>
                  {sector.is_exclusive && (
                    <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded-full flex-shrink-0">
                      <Lock size={10}/> Exclusivo
                    </span>
                  )}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(sector)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-brand-600 transition-colors">
                      <Pencil size={14}/>
                    </button>
                    <button onClick={() => handleDelete(sector)} className="p-2 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors">
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
        <SectorModal
          sector={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); loadSectors() }}
        />
      )}
    </div>
  )
}

function SectorModal({ sector, onClose, onSaved }: { sector: Sector | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(sector?.name || '')
  const [color, setColor] = useState(sector?.color || COLOR_OPTIONS[0])
  const [isExclusive, setIsExclusive] = useState(sector?.is_exclusive || false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('O nome do setor é obrigatório.'); return }
    setSaving(true)
    setError('')

    const payload = { name: name.trim(), color, is_exclusive: isExclusive }

    const { error: err } = sector
      ? await supabase.from('sectors').update(payload).eq('id', sector.id)
      : await supabase.from('sectors').insert({ ...payload, clinic_id: '00000000-0000-0000-0000-000000000001' })

    setSaving(false)
    if (err) { setError('Não foi possível salvar. Verifique se já existe um setor com esse nome.'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">{sector ? 'Editar setor' : 'Novo setor'}</h2>
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
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Nome do setor</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Agendamento, Cirurgia, Cobrança..."
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Cor</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={clsx('w-8 h-8 rounded-full transition-all', color === c ? 'ring-2 ring-offset-2 ring-slate-400' : 'hover:scale-110')}
                />
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 px-3.5 py-3 bg-slate-50 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={isExclusive}
              onChange={e => setIsExclusive(e.target.checked)}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-slate-700">Setor exclusivo</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Só atendentes vinculados especificamente a este setor podem ver as conversas dele
                (ex: Médico). Atendentes com acesso a "todos os setores" não enxergam setores exclusivos.
              </p>
            </div>
          </label>
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
