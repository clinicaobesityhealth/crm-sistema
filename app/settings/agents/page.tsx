'use client'
import { useState, useEffect } from 'react'
import { supabase, Agent, Sector, JobTitle } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import PhotoCapture from '@/components/PhotoCapture'
import { Plus, X, Save, Loader2, AlertCircle, Shield, User, Pencil, UserCheck, Clock3, UserX, Link2, KeyRound, Trash2 } from 'lucide-react'
import clsx from 'clsx'

const N8N_WEBHOOK = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-criar-atendente'

type RegistrationRequest = {
  id: string
  user_id: string
  email: string
  full_name: string
  provider: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [pending, setPending] = useState<RegistrationRequest[]>([])
  const [approving, setApproving] = useState<RegistrationRequest | null>(null)
  const [rejecting, setRejecting] = useState<RegistrationRequest | null>(null)
  const [linking, setLinking] = useState<RegistrationRequest | null>(null)
  const [notice, setNotice] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    loadAll()
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null))
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: ag }, { data: se }, { data: jt }, { data: req }] = await Promise.all([
      supabase.from('agents').select('*').order('name'),
      supabase.from('sectors').select('*').order('name'),
      supabase.from('job_titles').select('*').order('name'),
      supabase.from('user_registration_requests').select('*').eq('status', 'pending').order('created_at'),
    ])
    setAgents(ag ?? [])
    setSectors(se ?? [])
    setJobTitles(jt ?? [])
    setPending((req ?? []) as RegistrationRequest[])
    setLoading(false)
  }

  function avatarInitials(name: string) {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Atendentes</h1>
            <p className="text-xs text-slate-400 mt-0.5">{agents.length} atendente(s) cadastrado(s)</p>
          </div>
          <button onClick={() => { setEditing(null); setShowModal(true) }}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors">
            <Plus size={15}/> Novo atendente
          </button>
        </div>

        <div className="max-w-3xl px-6 py-8 space-y-6">
          {notice && <div className="flex items-start gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800"><UserCheck size={16} className="mt-0.5 flex-shrink-0"/><span>{notice}</span><button onClick={() => setNotice('')} className="ml-auto text-emerald-600"><X size={15}/></button></div>}
          {pending.length > 0 && <section>
            <div className="flex items-center gap-2 mb-3"><Clock3 size={16} className="text-amber-600"/><h2 className="text-sm font-semibold text-slate-700">Cadastros aguardando aprovação</h2><span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{pending.length}</span></div>
            <div className="space-y-2">
              {pending.map(req => <div key={req.id} className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white text-amber-700 flex items-center justify-center font-bold">{avatarInitials(req.full_name || req.email)}</div>
                <div className="flex-1 min-w-0"><p className="text-sm font-medium text-slate-800 truncate">{req.full_name || 'Novo usuário'}</p><p className="text-xs text-slate-500 truncate">{req.email} · {req.provider === 'google' ? 'Google' : 'Email e senha'}</p></div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button onClick={() => setLinking(req)} className="px-3 py-2 rounded-lg bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 text-xs font-medium flex items-center gap-1.5"><Link2 size={14}/> Vincular a existente</button>
                  <button onClick={() => setRejecting(req)} className="px-3 py-2 rounded-lg bg-white border border-red-200 hover:bg-red-50 text-red-700 text-xs font-medium flex items-center gap-1.5"><UserX size={14}/> Recusar</button>
                  <button onClick={() => setApproving(req)} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1.5"><UserCheck size={14}/> Configurar e aprovar</button>
                </div>
              </div>)}
            </div>
          </section>}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Usuários ativos</h2>
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin mr-2"/> Carregando...
            </div>
          ) : agents.map(agent => (
            <div key={agent.id} className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-4 py-3.5">
              {agent.photo_url ? (
                <img src={agent.photo_url} alt={agent.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0 border border-slate-100"/>
              ) : (
                <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold flex-shrink-0">
                  {avatarInitials(agent.name)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{agent.name}</p>
                <p className="text-xs text-slate-400 truncate">{agent.job_title || agent.email}</p>
              </div>
              <span className={clsx('flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0',
                agent.role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500')}>
                {agent.role === 'admin' ? <Shield size={10}/> : <User size={10}/>}
                {agent.role === 'admin' ? 'Admin' : 'Usuário'}
              </span>
              <button onClick={() => { setEditing(agent); setShowModal(true) }}
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-brand-600 transition-colors">
                <Pencil size={14}/>
              </button>
            </div>
          ))}
          </section>
        </div>
      </div>

      {showModal && (
        <AgentModal
          agent={editing}
          registration={null}
          sectors={sectors}
          jobTitles={jobTitles}
          currentUserId={currentUserId}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); loadAll() }}
        />
      )}
      {approving && <AgentModal agent={null} registration={approving} sectors={sectors} jobTitles={jobTitles} currentUserId={currentUserId} onClose={() => setApproving(null)} onSaved={() => { setApproving(null); loadAll() }}/>}
      {rejecting && <RegistrationDecisionModal mode="reject" registration={rejecting} agents={agents} onClose={() => setRejecting(null)} onDone={(message) => { setRejecting(null); setNotice(message); loadAll() }}/>} 
      {linking && <RegistrationDecisionModal mode="link" registration={linking} agents={agents} onClose={() => setLinking(null)} onDone={(message) => { setLinking(null); setNotice(message); loadAll() }}/>} 
    </div>
  )
}

function RegistrationDecisionModal({ mode, registration, agents, onClose, onDone }: {
  mode: 'reject' | 'link'; registration: RegistrationRequest; agents: Agent[]; onClose: () => void; onDone: (message: string) => void
}) {
  const [reason, setReason] = useState('')
  const [agentId, setAgentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (mode === 'link' && !agentId) { setError('Selecione o usuário existente.'); return }
    setSaving(true); setError('')
    if (mode === 'reject') {
      const { error: rpcError } = await supabase.rpc('admin_reject_registration', { p_request_id: registration.id, p_reason: reason.trim() || 'Cadastro não autorizado pelo administrador.' })
      if (rpcError) { setError('Não foi possível recusar: ' + rpcError.message); setSaving(false); return }
      onDone('Cadastro recusado. O usuário não recebeu acesso ao CRM.')
      return
    }
    const existing = agents.find(a => a.id === agentId)
    const { error: rpcError } = await supabase.rpc('admin_prepare_existing_link', { p_request_id: registration.id, p_existing_agent_id: agentId })
    if (rpcError) { setError('Não foi possível preparar a vinculação: ' + rpcError.message); setSaving(false); return }
    onDone(`A conta Google foi liberada. Agora ${existing?.name || 'o usuário existente'} deve entrar com o login atual e usar Meu perfil → Vincular conta Google.`)
  }

  return <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><h2 className="font-semibold text-slate-800">{mode === 'reject' ? 'Recusar cadastro' : 'Vincular a usuário existente'}</h2><button onClick={onClose} className="text-slate-400"><X size={18}/></button></div>
      <div className="px-6 py-5 space-y-4">
        <div className="bg-slate-50 rounded-xl px-4 py-3"><p className="text-sm font-medium text-slate-800">{registration.full_name || 'Novo usuário'}</p><p className="text-xs text-slate-500 mt-0.5">{registration.email}</p></div>
        {error && <div className="flex gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm"><AlertCircle size={15} className="mt-0.5 flex-shrink-0"/>{error}</div>}
        {mode === 'reject' ? <div><label className="block text-xs font-medium text-slate-500 mb-1.5">Motivo da recusa (opcional)</label><textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Ex.: cadastro de teste ou pessoa não autorizada"/></div> : <>
          <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3 text-xs leading-relaxed">Esta ação remove somente o login novo pendente e libera a conta Google. Ela não altera o usuário existente.</div>
          <div><label className="block text-xs font-medium text-slate-500 mb-1.5">Usuário existente</label><select value={agentId} onChange={e => setAgentId(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white"><option value="">Selecione...</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name} — {a.email}</option>)}</select></div>
        </>}
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2"><button onClick={onClose} disabled={saving} className="px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button><button onClick={submit} disabled={saving} className={clsx('px-4 py-2.5 text-sm text-white rounded-lg flex items-center gap-2 disabled:opacity-50', mode === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700')}>{saving ? <Loader2 size={14} className="animate-spin"/> : mode === 'reject' ? <UserX size={14}/> : <Link2 size={14}/>} {mode === 'reject' ? 'Confirmar recusa' : 'Preparar vinculação'}</button></div>
    </div>
  </div>
}

type AgentSector = { sector_id: string }

function AgentModal({ agent, registration, sectors, jobTitles, currentUserId, onClose, onSaved }: {
  agent: Agent | null; registration: RegistrationRequest | null; sectors: Sector[]; jobTitles: JobTitle[]; currentUserId?: string | null; onClose: () => void; onSaved: () => void
}) {
  const isEdit = !!agent
  const isApproval = !!registration
  const [nome, setNome] = useState(agent?.name || registration?.full_name || '')
  const [email, setEmail] = useState(agent?.email || registration?.email || '')
  const [senha, setSenha] = useState('')
  const [role, setRole] = useState<'admin' | 'usuario'>(agent?.role || 'usuario')
  const [jobTitle, setJobTitle] = useState(agent?.job_title || '')
  // v48.68 — Celular pessoal: é para onde vai o lembrete da agenda dela. Não
  // sai pelo número da clínica para ela mesma, e não é o telefone de contato
  // do paciente — por isso campo próprio.
  const [telefone, setTelefone] = useState((agent as any)?.telefone || '')
  const [photoUrl, setPhotoUrl] = useState(agent?.photo_url || '')
  const [seesAll, setSeesAll] = useState(agent?.sees_all_sectors || false)
  const [selectedSectors, setSelectedSectors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isSelf = isEdit && !!currentUserId && agent!.id === currentUserId
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [dangerBusy, setDangerBusy] = useState(false)
  const [dangerError, setDangerError] = useState('')
  const [resetDone, setResetDone] = useState(false)

  async function handleDelete() {
    setDangerBusy(true); setDangerError('')
    const { error: rpcError } = await supabase.rpc('admin_delete_agent', { p_agent_id: agent!.id })
    if (rpcError) { setDangerError('Não foi possível remover: ' + rpcError.message); setDangerBusy(false); return }
    onSaved()
  }

  async function handleResetPassword() {
    setDangerBusy(true); setDangerError('')
    const { error: rpcError } = await supabase.rpc('admin_reset_agent_password', { p_agent_id: agent!.id, p_new_password: '12345678' })
    if (rpcError) { setDangerError('Não foi possível redefinir a senha: ' + rpcError.message); setDangerBusy(false); return }
    setDangerBusy(false)
    setConfirmReset(false)
    setResetDone(true)
  }

  useEffect(() => {
    if (agent) {
      supabase.from('agent_sectors').select('sector_id').eq('agent_id', agent.id)
        .then(({ data }) => setSelectedSectors((data as AgentSector[] ?? []).map(d => d.sector_id)))
    }
  }, [agent])

  function toggleSector(id: string) {
    setSelectedSectors(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  async function handleSave() {
    if (!nome.trim() || !email.trim() || (!isEdit && !isApproval && !senha.trim())) {
      setError('Nome e email são obrigatórios.' + (!isEdit && !isApproval ? ' Senha também é obrigatória.' : ''))
      return
    }
    setSaving(true)
    setError('')

    if (isApproval && registration) {
      const { error: profileError } = await supabase.from('agents').insert({
        id: registration.user_id,
        clinic_id: '00000000-0000-0000-0000-000000000001',
        name: nome.trim(), email: registration.email, role,
        job_title: jobTitle.trim() || null, photo_url: photoUrl || null,
        sees_all_sectors: seesAll, is_online: false,
      })
      if (profileError) { setError('Não foi possível liberar o usuário: ' + profileError.message); setSaving(false); return }
      if (selectedSectors.length > 0) await supabase.from('agent_sectors').insert(selectedSectors.map(sector_id => ({ agent_id: registration.user_id, sector_id })))
      await supabase.from('user_registration_requests').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', registration.id)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        await fetch('/api/user-approval-email', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify({ email: registration.email, name: nome.trim() }) })
      } catch {}
      onSaved()
    } else if (isEdit) {
      // Atualiza campos editáveis diretamente no Supabase
      const { error: err } = await supabase.from('agents').update({
        name: nome.trim(),
        job_title: jobTitle.trim() || null,
        telefone: telefone.trim() || null,
        photo_url: photoUrl || null,
        role,
        sees_all_sectors: seesAll,
      }).eq('id', agent!.id)

      if (err) { setError('Não foi possível salvar.'); setSaving(false); return }

      // Atualiza setores: apaga os atuais e reinsere
      await supabase.from('agent_sectors').delete().eq('agent_id', agent!.id)
      if (selectedSectors.length > 0) {
        await supabase.from('agent_sectors').insert(
          selectedSectors.map(sector_id => ({ agent_id: agent!.id, sector_id }))
        )
      }
      onSaved()
    } else {
      // Criação via n8n (cria login + perfil)
      try {
        const resp = await fetch(N8N_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nome, email, senha, role,
            job_title: jobTitle || null,
            photo_url: photoUrl || null,
            sees_all_sectors: seesAll,
            setores: selectedSectors,
          }),
        })
        const data = await resp.json()
        if (!resp.ok || data.erro) { setError(data.erro || 'Erro ao criar atendente.'); setSaving(false); return }

        // Salva job_title separado (o webhook não trata esse campo ainda)
        if (jobTitle && data.agent_id) {
          await supabase.from('agents').update({ job_title: jobTitle.trim() }).eq('id', data.agent_id)
        }
        onSaved()
      } catch {
        setError('Não foi possível conectar ao servidor.')
        setSaving(false)
      }
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800">{isApproval ? 'Configurar e aprovar usuário' : isEdit ? 'Editar atendente' : 'Novo atendente'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>{error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-2">Foto de perfil</label>
            <PhotoCapture currentUrl={photoUrl || null} onUploaded={url => setPhotoUrl(url)} shape="circle" size={80}/>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Nome completo</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Maria Silva"
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Função / Cargo</label>
            <select value={jobTitle} onChange={e => setJobTitle(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Selecione um cargo...</option>
              {jobTitles.map(jt => <option key={jt.id} value={jt.name}>{jt.name}</option>)}
              {jobTitle && !jobTitles.some(jt => jt.name === jobTitle) && (
                <option value={jobTitle}>{jobTitle} (não está mais na lista)</option>
              )}
            </select>
            <p className="text-xs text-slate-400 mt-1.5">
              Não achou o cargo? Cadastre em <span className="font-medium">Configurações → Cargos</span>.
            </p>
          </div>

          {isEdit && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Celular pessoal (WhatsApp)</label>
              <input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(11) 99999-0000"
                className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              <p className="text-xs text-slate-400 mt-1.5">
                Para onde vão os lembretes da agenda pessoal. Fica só aqui — não aparece para pacientes.
              </p>
            </div>
          )}

          {!isEdit && !isApproval && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Email de acesso</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="maria@obesityhealth.com.br"
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Senha temporária</label>
                <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••"
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
            </>
          )}

          {isApproval && <div className="px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">Login já criado: <span className="font-medium">{registration?.email}</span></div>}

          {isEdit && (
            <div className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500">
              Email: <span className="font-medium text-slate-700">{agent?.email}</span> — não editável
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Perfil de acesso</label>
            <div className="flex gap-2">
              {(['usuario', 'admin'] as const).map(r => (
                <button key={r} onClick={() => setRole(r)}
                  className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium rounded-lg border transition-colors',
                    role === r ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50')}>
                  {r === 'admin' ? <Shield size={14}/> : <User size={14}/>}
                  {r === 'admin' ? 'Admin' : 'Usuário'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-2">Setores</label>
            <div className="space-y-1.5">
              {sectors.map(s => (
                <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={selectedSectors.includes(s.id)} onChange={() => toggleSector(s.id)}/>
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }}/>
                  <span className="text-sm text-slate-700">{s.name}</span>
                  {s.is_exclusive && <span className="text-xs text-amber-600 ml-auto">Exclusivo</span>}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 px-3.5 py-3 bg-slate-50 rounded-lg cursor-pointer">
            <input type="checkbox" checked={seesAll} onChange={e => setSeesAll(e.target.checked)} className="mt-0.5"/>
            <div>
              <p className="text-sm font-medium text-slate-700">Ver todos os setores</p>
              <p className="text-xs text-slate-400 mt-0.5">Acessa conversas de qualquer setor não-exclusivo.</p>
            </div>
          </label>

          {isEdit && (
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <p className="text-xs font-medium text-slate-500 pt-3">Zona de risco</p>

              {dangerError && (
                <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>{dangerError}
                </div>
              )}

              {resetDone && (
                <div className="flex items-start gap-2 px-3.5 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-sm">
                  <KeyRound size={15} className="flex-shrink-0 mt-0.5"/>
                  <span>Senha redefinida para <span className="font-semibold">12345678</span>. Avise {agent?.name} para trocar assim que entrar.</span>
                </div>
              )}

              {!confirmReset ? (
                <button onClick={() => { setConfirmReset(true); setResetDone(false); setDangerError('') }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
                  <KeyRound size={14}/> Redefinir senha para 12345678
                </button>
              ) : (
                <div className="px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2.5">
                  <p className="text-sm text-amber-800">A senha de <span className="font-medium">{agent?.name}</span> será trocada para <span className="font-semibold">12345678</span> imediatamente. Confirma?</p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setConfirmReset(false)} disabled={dangerBusy} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white rounded-lg">Cancelar</button>
                    <button onClick={handleResetPassword} disabled={dangerBusy} className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
                      {dangerBusy ? <Loader2 size={12} className="animate-spin"/> : <KeyRound size={12}/>} Confirmar
                    </button>
                  </div>
                </div>
              )}

              {isSelf ? (
                <p className="text-xs text-slate-400 px-1">Você não pode remover o seu próprio usuário por aqui.</p>
              ) : !confirmDelete ? (
                <button onClick={() => { setConfirmDelete(true); setDangerError('') }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50">
                  <Trash2 size={14}/> Remover atendente
                </button>
              ) : (
                <div className="px-3.5 py-3 bg-red-50 border border-red-200 rounded-lg space-y-2.5">
                  <p className="text-sm text-red-800">Isso apaga o cadastro e o login de <span className="font-medium">{agent?.name}</span> permanentemente. Não é possível desfazer. Confirma?</p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setConfirmDelete(false)} disabled={dangerBusy} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white rounded-lg">Cancelar</button>
                    <button onClick={handleDelete} disabled={dangerBusy} className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
                      {dangerBusy ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12}/>} Sim, remover
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} disabled={saving} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
            {isApproval ? 'Aprovar e liberar acesso' : isEdit ? 'Salvar alterações' : 'Criar atendente'}
          </button>
        </div>
      </div>
    </div>
  )
}
