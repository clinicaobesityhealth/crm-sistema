'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { Plus, X, Tag as TagIcon, Loader2, Trash2, Check, Pencil } from 'lucide-react'
import clsx from 'clsx'

type Tag = { id: string; name: string; color: string }

const COLORS = ['#64748b', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0])
  const [creating, setCreating] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => { loadTags() }, [])

  async function loadTags() {
    setLoading(true)
    const { data } = await supabase.from('tags').select('*').order('name')
    setTags(data ?? [])
    setLoading(false)
  }

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    const { error } = await supabase.from('tags').insert({ name: newName.trim(), color: newColor })
    if (error) { alert('Erro: ' + error.message); setCreating(false); return }
    setNewName(''); setNewColor(COLORS[0]); setCreating(false)
    loadTags()
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir a tag "${name}"? Ela será removida da lista, mas os contatos que já a possuem mantêm.`)) return
    await supabase.from('tags').delete().eq('id', id)
    loadTags()
  }

  async function handleSaveEdit(id: string) {
    if (!editName.trim()) return
    await supabase.from('tags').update({ name: editName.trim() }).eq('id', id)
    setEditId(null); setEditName('')
    loadTags()
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-800">Tags</h1>
          <p className="text-xs text-slate-400 mt-0.5">Gerencie as etiquetas para organizar contatos</p>
        </div>

        <div className="max-w-2xl px-6 py-8">
          {/* Criar nova */}
          <div className="bg-white border border-slate-100 rounded-xl p-4 mb-6">
            <p className="text-sm font-medium text-slate-700 mb-3">Nova tag</p>
            <div className="flex gap-2 mb-3">
              <input value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="Nome da tag..."
                className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              <button onClick={handleCreate} disabled={creating || !newName.trim()}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2">
                {creating ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>} Criar
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Cor:</span>
              {COLORS.map(c => (
                <button key={c} onClick={() => setNewColor(c)}
                  className={clsx('w-6 h-6 rounded-full transition-transform', newColor === c && 'ring-2 ring-offset-2 ring-slate-400 scale-110')}
                  style={{ backgroundColor: c }}/>
              ))}
            </div>
          </div>

          {/* Lista */}
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin mr-2"/>Carregando...</div>
          ) : tags.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <TagIcon size={32} className="text-slate-300 mb-2"/>
              <p className="text-sm text-slate-500">Nenhuma tag criada ainda</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tags.map(tag => (
                <div key={tag.id} className="bg-white border border-slate-100 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }}/>
                  {editId === tag.id ? (
                    <input value={editName} onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSaveEdit(tag.id)}
                      className="flex-1 px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-brand-500" autoFocus/>
                  ) : (
                    <span className="flex-1 text-sm font-medium text-slate-700">{tag.name}</span>
                  )}
                  {editId === tag.id ? (
                    <button onClick={() => handleSaveEdit(tag.id)} className="p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-500"><Check size={14}/></button>
                  ) : (
                    <button onClick={() => { setEditId(tag.id); setEditName(tag.name) }} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><Pencil size={14}/></button>
                  )}
                  <button onClick={() => handleDelete(tag.id, tag.name)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500"><Trash2 size={14}/></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
