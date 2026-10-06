'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { REGRAS_SILENCIO_PADRAO } from '@/lib/silencioSofia'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { Bot, Building2, Clock3, ExternalLink, Eye, EyeOff, FileText, KeyRound, Loader2, LockKeyhole, Plus, RotateCcw, Save, Trash2, Users, BellOff } from 'lucide-react'
import { REGRAS_RESUMO_PADRAO } from '@/lib/examAnalysisDefaultPrompt'

type Professional = { name: string; specialty: string; details: string }
type SofiaConfig = {
  assistant_name: string
  clinic_name: string
  clinic_description: string
  general_prompt: string
  clinic_rules: string
  service_safety_rules: string
  professionals: Professional[]
  service_hours: string
  address: string
  phone: string
  email: string
  site_url: string
  uber_url: string
  waze_url: string
  google_maps_url: string
  google_review_url: string
  google_review_enabled: boolean
  // v47.00 — regras que a IA (Gemini) usa para resumir exames em PDF (botão
  // "Analisar exame com IA" no anexo). Vazio = usa REGRAS_RESUMO_PADRAO
  // (lib/examAnalysisDefaultPrompt.ts) sem nenhuma mudança de comportamento.
  exam_analysis_prompt: string
  // v48.34 — quando a assistente deve ficar calada (ver lib/silencioSofia.ts)
  silence_rules: string
}

const emptyConfig: SofiaConfig = {
  assistant_name: 'Sofia', clinic_name: '', clinic_description: '', general_prompt: '', clinic_rules: '', service_safety_rules: '', professionals: [],
  service_hours: '', address: '', phone: '', email: '', site_url: '', uber_url: '', waze_url: '',
  google_maps_url: '', google_review_url: '', google_review_enabled: false, exam_analysis_prompt: '', silence_rules: '',
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100'
const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-600'

function Section({ icon: Icon, title, description, children }: any) {
  return <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
    <div className="mb-5 flex items-start gap-3"><div className="rounded-xl bg-brand-50 p-2 text-brand-700"><Icon size={18}/></div>
      <div><h2 className="text-sm font-bold text-slate-800">{title}</h2><p className="mt-0.5 text-xs text-slate-400">{description}</p></div></div>
    {children}
  </section>
}

export default function SofiaSettingsPage() {
  const { agent } = useAuth()
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [config, setConfig] = useState<SofiaConfig>(emptyConfig)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [toast, setToast] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [checkingPassword, setCheckingPassword] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => {
    // O desbloqueio pertence ao administrador atual, não apenas à aba do navegador.
    try {
      sessionStorage.removeItem('sofia-settings-unlocked')
      setUnlocked(Boolean(agent?.id && sessionStorage.getItem(`sofia-settings-unlocked:${agent.id}`) === '1'))
    } catch {}
    load()
  }, [agent?.id])
  async function load() {
    const { data, error } = await supabase.from('clinic_settings').select('id, sofia_config').limit(1)
    const row = data?.[0]
    if (row) {
      setSettingsId(row.id)
      const saved = row.sofia_config || {}
      setConfig({ ...emptyConfig, ...saved, professionals: Array.isArray(saved.professionals) ? saved.professionals : [] })
    }
    if (error) setMessage('Não foi possível carregar a configuração: ' + error.message)
    setLoading(false)
  }

  function setField<K extends keyof SofiaConfig>(field: K, value: SofiaConfig[K]) { setConfig(c => ({ ...c, [field]: value })) }
  function updateProfessional(index: number, field: keyof Professional, value: string) {
    setConfig(c => ({ ...c, professionals: c.professionals.map((p, i) => i === index ? { ...p, [field]: value } : p) }))
  }
  function addProfessional() { setConfig(c => ({ ...c, professionals: [...c.professionals, { name: '', specialty: '', details: '' }] })) }
  function removeProfessional(index: number) { setConfig(c => ({ ...c, professionals: c.professionals.filter((_, i) => i !== index) })) }

  async function save() {
    if (!settingsId) { setMessage('Configuração principal da clínica não encontrada.'); return }
    if (!config.assistant_name.trim() || !config.clinic_name.trim()) { setMessage('Informe o nome da assistente e da clínica.'); return }
    setSaving(true); setMessage('')
    const clean = {
      ...config,
      assistant_name: config.assistant_name.trim(), clinic_name: config.clinic_name.trim(),
      exam_analysis_prompt: config.exam_analysis_prompt.trim(),
      professionals: config.professionals.filter(p => p.name.trim() || p.specialty.trim()).map(p => ({ name: p.name.trim(), specialty: p.specialty.trim(), details: p.details.trim() })),
      google_review_enabled: false,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('clinic_settings').update({ sofia_config: clean }).eq('id', settingsId)
    setSaving(false)
    setMessage(error ? 'Erro ao salvar: ' + error.message : '')
    if (!error) {
      setConfig(clean)
      setToast(`Configuração de ${clean.assistant_name} salva com sucesso.`)
      setTimeout(() => setToast(''), 3500)
    }
  }

  async function unlock() {
    setCheckingPassword(true); setMessage('')
    const { data, error } = await supabase.rpc('verify_sofia_admin_password', { candidate: password })
    setCheckingPassword(false)
    if (error || data !== true) { setMessage('Senha incorreta.'); return }
    setUnlocked(true); setPassword('')
    try { if (agent?.id) sessionStorage.setItem(`sofia-settings-unlocked:${agent.id}`, '1') } catch {}
  }

  async function changePassword() {
    if (newPassword.length < 8) { setMessage('A nova senha deve ter pelo menos 8 caracteres.'); return }
    setCheckingPassword(true); setMessage('')
    const { data, error } = await supabase.rpc('change_sofia_admin_password', { current_password: currentPassword, new_password: newPassword })
    setCheckingPassword(false)
    if (error || data !== true) { setMessage(error?.message || 'A senha atual está incorreta.'); return }
    setCurrentPassword(''); setNewPassword(''); setShowChangePassword(false); setMessage('')
    setToast('Senha administrativa alterada com sucesso. Use a nova senha no próximo acesso.')
    setTimeout(() => setToast(''), 4500)
  }

  if (loading) return <div className="flex h-screen bg-surface"><Sidebar/><main className="flex flex-1 items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 animate-spin" size={16}/>Carregando...</main></div>

  if (!unlocked) return <div className="flex h-screen overflow-hidden bg-surface"><Sidebar/><main className="flex flex-1 items-center justify-center p-6"><div className="w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-6 shadow-lg"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><LockKeyhole size={23}/></div><h1 className="text-center text-lg font-bold text-slate-800">Configuração protegida do Agente de IA</h1><p className="mt-2 text-center text-xs leading-5 text-slate-400">Digite a senha administrativa para visualizar e alterar o conteúdo da assistente.</p><label className="mt-5 block"><span className={labelClass}>Senha administrativa</span><div className="relative"><input autoFocus type={showPassword?'text':'password'} className={inputClass+' pr-11'} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')unlock()}}/><button type="button" onClick={()=>setShowPassword(v=>!v)} className="absolute right-3 top-2.5 text-slate-400">{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>{message&&<p className="mt-3 text-center text-xs text-red-500">{message}</p>}<button disabled={checkingPassword||!password} onClick={unlock} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">{checkingPassword?<Loader2 className="animate-spin" size={16}/>:<KeyRound size={16}/>}Desbloquear</button></div></main></div>

  return <div className="flex h-screen overflow-hidden bg-surface"><Sidebar/><main className="flex-1 overflow-y-auto pb-20 md:pb-8">
    {toast&&<div className="fixed right-4 top-4 z-[80] flex max-w-sm items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-lg"><Save size={17}/>{toast}</div>}
    <header className="flex items-center justify-between border-b border-slate-100 bg-white px-4 sm:px-6 py-4"><div><h1 className="flex items-center gap-2 text-base sm:text-lg font-semibold text-slate-800"><Bot size={20}/>Configuração de {config.assistant_name || 'Agente de IA'}</h1><p className="mt-1 text-xs text-slate-400">Personalize as informações da clínica usadas no atendimento.</p></div><button onClick={()=>setShowChangePassword(v=>!v)} className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><KeyRound size={15}/><span className="hidden sm:inline">Alterar senha</span></button></header>
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><LockKeyhole className="mt-0.5 shrink-0" size={19}/><div><p className="text-sm font-bold">Ferramentas e regras de segurança protegidas</p><p className="mt-1 text-xs leading-5">Esta tela não permite editar ferramentas, credenciais, MedX, anexos, identificação de pacientes ou automações. Esses recursos continuam isolados no fluxo técnico e têm prioridade sobre o conteúdo abaixo.</p></div></div>

      {showChangePassword&&<section className="rounded-2xl border border-brand-200 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 text-sm font-bold text-slate-800"><KeyRound size={17}/>Alterar senha administrativa</h2><div className="mt-4 grid gap-3 md:grid-cols-2"><label><span className={labelClass}>Senha atual</span><input type="password" className={inputClass} value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/></label><label><span className={labelClass}>Nova senha (mínimo 8 caracteres)</span><input type="password" className={inputClass} value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label></div><button onClick={changePassword} disabled={checkingPassword} className="mt-4 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">Salvar nova senha</button></section>}

      <Section icon={Bot} title="Identidade" description="Como a assistente e a clínica se apresentam."><div className="grid gap-4 md:grid-cols-2"><label><span className={labelClass}>Nome da assistente *</span><input className={inputClass} value={config.assistant_name} onChange={e=>setField('assistant_name',e.target.value)}/></label><label><span className={labelClass}>Nome da clínica *</span><input className={inputClass} value={config.clinic_name} onChange={e=>setField('clinic_name',e.target.value)}/></label><label className="md:col-span-2"><span className={labelClass}>Apresentação da clínica</span><textarea rows={4} className={inputClass} value={config.clinic_description} onChange={e=>setField('clinic_description',e.target.value)} placeholder="Especialidades, serviços e diferenciais da clínica..."/></label></div></Section>

      <Section icon={Bot} title="Prompt geral" description="Personalidade, tom de voz e comportamento esperado no atendimento."><textarea rows={7} className={inputClass} value={config.general_prompt} onChange={e=>setField('general_prompt',e.target.value)} placeholder="Ex.: responda com acolhimento, clareza e objetividade; use linguagem simples..."/><p className="mt-2 text-xs text-slate-400">Este texto orienta a conversa, mas não altera o funcionamento das ferramentas.</p></Section>

      <Section icon={Building2} title="Regras da clínica" description="Orientações administrativas e comerciais. Não inclua senhas nem instruções de ferramentas."><textarea rows={7} className={inputClass} value={config.clinic_rules} onChange={e=>setField('clinic_rules',e.target.value)} placeholder="Convênios, formas de pagamento, preparo, políticas de atraso e cancelamento..."/></Section>

      <Section icon={LockKeyhole} title="Regras de segurança do atendimento" description="Limites clínicos, privacidade e condutas que devem ser respeitadas nas respostas."><textarea rows={7} className={inputClass} value={config.service_safety_rules} onChange={e=>setField('service_safety_rules',e.target.value)} placeholder="Ex.: não fornecer diagnóstico; orientar urgências; preservar dados pessoais; encaminhar decisões clínicas ao profissional..."/><p className="mt-2 text-xs text-slate-400">O núcleo técnico de segurança e as regras das ferramentas permanecem protegidos e não aparecem nesta tela.</p></Section>

      {/* v48.34 — O portão do silêncio. Ver lib/silencioSofia.ts para o porquê:
          a Sofia respondia manchete de futebol de lista de transmissão, e cada
          resposta dessas mantém a janela aberta e confirma que o número atende. */}
      <Section icon={BellOff} title="Quando não responder"
        description="O que NÃO é paciente falando com a clínica — propaganda, notícia encaminhada, lista de transmissão. Nesses casos a mensagem chega no Atendimento, mas a assistente fica calada.">
        <textarea rows={14} className={inputClass + ' font-mono text-xs leading-5'}
          value={config.silence_rules}
          onChange={e => setField('silence_rules', e.target.value)}
          placeholder="Deixe em branco para usar as regras padrão do sistema."/>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            {config.silence_rules.trim()
              ? 'Personalizado: estas regras substituem as padrão.'
              : 'Em branco: usando as regras padrão do sistema.'}
          </p>
          <button type="button"
            onClick={() => setField('silence_rules', REGRAS_SILENCIO_PADRAO)}
            className="text-xs font-semibold text-brand-600 hover:underline">
            Usar regras padrão como ponto de partida
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Na dúvida, a assistente responde: deixar um paciente sem resposta é pior do que
          responder a um anúncio.
        </p>
      </Section>

      <Section icon={FileText} title="Análise de exames por IA" description='Regras que a IA usa no botão "Analisar exame com IA" (resumo de laudos em PDF). Não tem relação com a conversa da Sofia no WhatsApp.'>
        <textarea rows={12} className={inputClass + ' font-mono text-xs leading-5'} value={config.exam_analysis_prompt} onChange={e=>setField('exam_analysis_prompt', e.target.value)} placeholder="Deixe em branco para usar as regras padrão do sistema. Clique em “Usar regras padrão como ponto de partida” para editar a partir delas — por exemplo, para incluir novas categorias de “exames de destaque”."/>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">{config.exam_analysis_prompt.trim() ? 'Personalizado: estas regras substituem as padrão do sistema.' : 'Em branco: usando as regras padrão do sistema.'}</p>
          <button type="button" onClick={()=>setField('exam_analysis_prompt', REGRAS_RESUMO_PADRAO)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><RotateCcw size={13}/>Usar regras padrão como ponto de partida</button>
        </div>
      </Section>

      <Section icon={Users} title="Profissionais" description={`Equipe que ${config.assistant_name || 'o Agente de IA'} pode apresentar aos pacientes.`}><div className="space-y-3">{config.professionals.map((p,i)=><div key={i} className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 md:grid-cols-[1fr_1fr_1.4fr_auto]"><input className={inputClass} placeholder="Nome" value={p.name} onChange={e=>updateProfessional(i,'name',e.target.value)}/><input className={inputClass} placeholder="Especialidade" value={p.specialty} onChange={e=>updateProfessional(i,'specialty',e.target.value)}/><input className={inputClass} placeholder="Informações adicionais" value={p.details} onChange={e=>updateProfessional(i,'details',e.target.value)}/><button onClick={()=>removeProfessional(i)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500" title="Remover"><Trash2 size={17}/></button></div>)}<button onClick={addProfessional} className="flex items-center gap-2 rounded-xl border border-dashed border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"><Plus size={16}/>Adicionar profissional</button></div></Section>

      <Section icon={Clock3} title="Horários e contato" description="Informações que a Sofia pode informar diretamente."><div className="grid gap-4 md:grid-cols-2"><label className="md:col-span-2"><span className={labelClass}>Horários de atendimento</span><textarea rows={4} className={inputClass} value={config.service_hours} onChange={e=>setField('service_hours',e.target.value)} placeholder="Segunda a sexta, das 8h às 18h..."/></label><label className="md:col-span-2"><span className={labelClass}>Endereço</span><input className={inputClass} value={config.address} onChange={e=>setField('address',e.target.value)}/></label><label><span className={labelClass}>Telefone/WhatsApp</span><input className={inputClass} value={config.phone} onChange={e=>setField('phone',e.target.value)}/></label><label><span className={labelClass}>E-mail</span><input type="email" className={inputClass} value={config.email} onChange={e=>setField('email',e.target.value)}/></label></div></Section>

      <Section icon={ExternalLink} title="Links" description="Cada endereço fica separado para facilitar a implantação em outra clínica."><div className="grid gap-4 md:grid-cols-2">{([['site_url','Site'],['google_maps_url','Google Maps'],['waze_url','Waze'],['uber_url','Uber'],['google_review_url','Avaliação no Google']] as [keyof SofiaConfig,string][]).map(([key,label])=><label key={key} className={key==='google_review_url'?'md:col-span-2':''}><span className={labelClass}>{label}</span><input type="url" className={inputClass} value={String(config[key])} onChange={e=>setField(key,e.target.value as never)} placeholder="https://..."/></label>)}</div><div className="mt-3 rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800">Ao finalizar o último atendimento da conversa, a secretária poderá escolher se deseja enviar este link ao paciente antes do encerramento.</div></Section>

      <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur"><p className="text-xs text-slate-500">{message}</p><button disabled={saving} onClick={save} className="flex shrink-0 items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>}Salvar configuração</button></div>
    </div>
  </main></div>
}
