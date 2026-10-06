'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase, JobTitle } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { X, Camera, Save, Loader2, Eye, EyeOff, CheckCircle2, AlertCircle, LogOut, Link2 } from 'lucide-react'

type Props = { onClose: () => void }

export default function ProfileModal({ onClose }: Props) {
  const { agent, refreshAgent, signOut } = useAuth()
  const [name, setName] = useState(agent?.name || '')
  const [jobTitle, setJobTitle] = useState(agent?.job_title || '')
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])

  useEffect(() => {
    supabase.from('job_titles').select('*').order('name').then(({ data }) => setJobTitles(data ?? []))
  }, [])
  const [photoUrl, setPhotoUrl] = useState(agent?.photo_url || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingPass, setSavingPass] = useState(false)
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function handlePhoto(file: File) {
    if (!agent) return
    setUploading(true)
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${agent.id}.${ext}`
    await supabase.storage.from('agent-photos').upload(path, file, { upsert: true, contentType: file.type })
    const { data: { publicUrl } } = supabase.storage.from('agent-photos').getPublicUrl(path)
    const url = `${publicUrl}?t=${Date.now()}`
    setPhotoUrl(url)
    await supabase.from('agents').update({ photo_url: url }).eq('id', agent.id)
    await refreshAgent()
    setUploading(false)
    showToast('Foto atualizada!')
  }

  async function handleSaveProfile() {
    if (!agent) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('agents').update({
      name: name.trim(),
      job_title: jobTitle.trim() || null,
    }).eq('id', agent.id)
    if (err) { setError('Erro ao salvar: ' + err.message); setSaving(false); return }
    await refreshAgent()
    setSaving(false)
    showToast('Perfil atualizado!')
  }

  async function handleChangePassword() {
    if (!newPassword || !confirmPassword) { setError('Preencha a nova senha.'); return }
    if (newPassword !== confirmPassword) { setError('As senhas não coincidem.'); return }
    if (newPassword.length < 6) { setError('A senha deve ter pelo menos 6 caracteres.'); return }
    setSavingPass(true)
    setError('')
    const { error: err } = await supabase.auth.updateUser({ password: newPassword })
    if (err) { setError('Erro: ' + err.message); setSavingPass(false); return }
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    setSavingPass(false)
    showToast('Senha alterada com sucesso!')
  }

  async function handleLinkGoogle() {
    setLinkingGoogle(true)
    setError('')
    const { error: linkError } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/inbox`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (linkError) {
      setError('Não foi possível vincular a conta Google: ' + linkError.message)
      setLinkingGoogle(false)
    }
  }

  function avatarInitials(name: string) {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden relative">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Meu Perfil</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Toast */}
          {toast && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
              <CheckCircle2 size={14}/>{toast}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={14}/>{error}
            </div>
          )}

          {/* Foto */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              {photoUrl ? (
                <img src={photoUrl} className="w-20 h-20 rounded-full object-cover border-2 border-slate-100"/>
              ) : (
                <div className="w-20 h-20 rounded-full bg-brand-600 flex items-center justify-center text-white text-2xl font-bold">
                  {avatarInitials(name || 'U')}
                </div>
              )}
              <button onClick={() => fileRef.current?.click()}
                className="absolute bottom-0 right-0 w-7 h-7 bg-brand-600 hover:bg-brand-700 text-white rounded-full flex items-center justify-center shadow-lg">
                {uploading ? <Loader2 size={12} className="animate-spin"/> : <Camera size={12}/>}
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files?.[0] && handlePhoto(e.target.files[0])}/>
            <p className="text-xs text-slate-400">Clique no ícone para trocar a foto</p>
          </div>

          {/* Dados */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Dados pessoais</h3>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Nome</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Cargo / Função</label>
              <select value={jobTitle} onChange={e => setJobTitle(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">Selecione um cargo...</option>
                {jobTitles.map(jt => <option key={jt.id} value={jt.name}>{jt.name}</option>)}
                {jobTitle && !jobTitles.some(jt => jt.name === jobTitle) && (
                  <option value={jobTitle}>{jobTitle} (não está mais na lista)</option>
                )}
              </select>
            </div>
            <button onClick={handleSaveProfile} disabled={saving}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
              {saving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
              Salvar dados
            </button>
          </div>

          {/* Senha */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Alterar senha</h3>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="Nova senha (mín. 6 caracteres)"
                className="w-full px-3 py-2.5 pr-10 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              <button onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {showPass ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
            <input
              type={showPass ? 'text' : 'password'}
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Confirmar nova senha"
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            <button onClick={handleChangePassword} disabled={savingPass || !newPassword}
              className="w-full py-2.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
              {savingPass ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
              Alterar senha
            </button>
          </div>

          <div className="space-y-3 pt-1 border-t border-slate-100">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-4">Conta Google</h3>
            <p className="text-xs text-slate-400 leading-relaxed">Vincule um Google a esta conta já autorizada. O email do Google pode ser diferente, pois o vínculo é confirmado durante esta sessão.</p>
            <button onClick={handleLinkGoogle} disabled={linkingGoogle}
              className="w-full py-2.5 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-medium rounded-lg flex items-center justify-center gap-2">
              {linkingGoogle ? <Loader2 size={14} className="animate-spin"/> : <Link2 size={14}/>} Vincular acesso com Google
            </button>
          </div>

          {/* Sair — principalmente para mobile que não tem sidebar */}
          <div className="md:hidden pt-2 border-t border-slate-100">
            <button onClick={signOut}
              className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium rounded-lg flex items-center justify-center gap-2">
              <LogOut size={14}/> Sair da conta
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
