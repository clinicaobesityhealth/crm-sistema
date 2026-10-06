'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { Plus, Trash2, Loader2, Zap, CheckCircle2, Smile, X } from 'lucide-react'

type QuickMsg = { id: string; shortcut: string; content: string; created_at: string }

const EMOJI_LIST = [
  '😊','😄','😃','🙏','👋','👍','✅','❤️','🎉','⭐',
  '🏥','💊','📅','⏰','📋','✏️','🔔','💬','❓','⚠️',
  '🚨','✔️','📞','📱','💡','🌟','🤝','😅','😬','🙌',
  '👏','🥳','😍','🤔','😢','😎','🫂','💪','🌈','🎯',
  '📍','📌','🗓️','⚡','🔥','💯','🆗','🆕','🔑','🎁',
]

export default function QuickMessagesPage() {
  const [messages, setMessages] = useState<QuickMsg[]>([])
  const [loading, setLoading] = useState(true)
  const [shortcut, setShortcut] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [error, setError] = useState('')
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)

  useEffect(() => { load() }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmoji(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('quick_messages')
      .select('*')
      .order('shortcut')
    if (err) console.error('Erro ao carregar:', err)
    setMessages(data ?? [])
    setLoading(false)
  }

  function insertEmoji(emoji: string) {
    const el = contentRef.current
    if (!el) { setContent(c => c + emoji); return }
    const start = el.selectionStart ?? content.length
    const end = el.selectionEnd ?? content.length
    const newVal = content.slice(0, start) + emoji + content.slice(end)
    setContent(newVal)
    // Reposiciona cursor após o emoji
    setTimeout(() => { el.focus(); el.setSelectionRange(start + emoji.length, start + emoji.length) }, 0)
    setShowEmoji(false)
  }

  async function handleAdd() {
    setError('')
    if (!shortcut.trim()) { setError('Digite um atalho.'); return }
    if (!content.trim()) { setError('Digite a mensagem.'); return }
    setSaving(true)
    const sc = shortcut.trim().startsWith('/') ? shortcut.trim() : '/' + shortcut.trim()
    const { error: err } = await supabase.from('quick_messages').insert({
      shortcut: sc,
      content: content.trim(),
      clinic_id: '00000000-0000-0000-0000-000000000001',
    })
    if (err) { setError('Erro: ' + err.message); setSaving(false); return }
    setShortcut('')
    setContent('')
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    await load()
  }

  async function handleDelete(id: string) {
    await supabase.from('quick_messages').delete().eq('id', id)
    setMessages(prev => prev.filter(m => m.id !== id))
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-brand-500"/>
            <h1 className="text-lg font-semibold text-slate-800">Mensagens Rápidas</h1>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            No chat, digite <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-brand-600">/atalho</code> para inserir rapidamente. Visível para toda a equipe.
          </p>
        </div>

        <div className="max-w-2xl px-6 py-6 space-y-6">

          {/* Formulário */}
          <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Nova mensagem rápida</h2>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                <X size={12}/>{error}
              </div>
            )}

            <div className="flex gap-3">
              <div className="w-36 flex-shrink-0">
                <label className="text-xs text-slate-400 mb-1 block font-medium">Atalho</label>
                <input value={shortcut}
                  onChange={e => setShortcut(e.target.value)}
                  placeholder="/ola"
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"/>
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-400 mb-1 block font-medium">Mensagem</label>
                <div className="relative">
                  <textarea
                    ref={contentRef}
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder="Olá! Como posso ajudar? 😊"
                    rows={3}
                    className="w-full px-3 py-2.5 pr-9 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"/>
                  {/* Botão emoji */}
                  <div className="absolute top-2 right-2" ref={emojiRef}>
                    <button onClick={() => setShowEmoji(v => !v)}
                      className="p-1 text-slate-400 hover:text-brand-500 hover:bg-slate-100 rounded">
                      <Smile size={14}/>
                    </button>
                    {showEmoji && (
                      <div className="absolute right-0 top-7 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-30 w-64">
                        <div className="grid grid-cols-10 gap-0.5">
                          {EMOJI_LIST.map(e => (
                            <button key={e} onClick={() => insertEmoji(e)}
                              className="text-base hover:bg-slate-100 rounded p-0.5 leading-none">
                              {e}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Preview */}
            {content && (
              <div className="flex items-start gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                <span className="text-xs text-slate-400 mt-0.5 flex-shrink-0">Preview:</span>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{content}</p>
              </div>
            )}

            <button onClick={handleAdd} disabled={saving || !shortcut || !content}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? <Loader2 size={13} className="animate-spin"/>
                : saved ? <CheckCircle2 size={13}/>
                : <Plus size={13}/>}
              {saved ? 'Adicionada!' : 'Adicionar'}
            </button>
          </div>

          {/* Lista */}
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-sm font-medium text-slate-600">
                {loading ? 'Carregando...' : `${messages.length} mensagem${messages.length !== 1 ? 's' : ''} cadastrada${messages.length !== 1 ? 's' : ''}`}
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-20 text-slate-400 text-sm">
                <Loader2 size={14} className="animate-spin mr-2"/>Carregando...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-slate-400 text-sm gap-1">
                <Zap size={20} className="text-slate-300"/>
                Nenhuma mensagem rápida ainda
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {messages.map(m => (
                  <div key={m.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50 group">
                    <code className="text-xs bg-brand-50 text-brand-700 px-2 py-1 rounded-lg font-mono flex-shrink-0 mt-0.5 border border-brand-100">
                      {m.shortcut}
                    </code>
                    <p className="flex-1 text-sm text-slate-700 whitespace-pre-wrap">{m.content}</p>
                    <button onClick={() => handleDelete(m.id)}
                      className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-50 rounded-lg text-slate-300 hover:text-red-500 flex-shrink-0 transition-all">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
