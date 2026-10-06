'use client'
import { useState } from 'react'
import { supabase, Contact } from '@/lib/supabase'
import CampoCep from '@/components/CampoCep'
import { useAuth } from '@/lib/AuthContext'
import InstagramIcon from '@/components/icons/InstagramIcon'
import { X, Loader2, Smartphone, Info, Stethoscope } from 'lucide-react'
import clsx from 'clsx'
import { useAiAssistantName } from '@/lib/useAiAssistantName'
import { registerPatientInMedx, validateMedxRegistration } from '@/lib/medxRegistration'

type Props = {
  onClose: () => void
  onCreated: (contact: Contact) => void
}

export default function NewContactModal({ onClose, onCreated }: Props) {
  const assistantName = useAiAssistantName()
  const { agent } = useAuth()
  const [channel, setChannel] = useState<'whatsapp' | 'instagram'>('whatsapp')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('+55')
  const [patient, setPatient] = useState({ email: '', cpf: '', nome_social: '', sexo: '', nascimento: '', cep: '', endereco_residencial: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' })
  const [sofiaDisabled, setSofiaDisabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingMode, setSavingMode] = useState<'crm' | 'medx' | null>(null)
  const [error, setError] = useState('')

  async function handleCreate(registerInMedx = false) {
    if (!fullName.trim()) { setError('Digite o nome do contato.'); return }
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 12) { setError('Digite o telefone completo com +55, DDD e número.'); return }
    const preliminaryPayload = { contact_id: '', nome: fullName.trim(), nome_social: patient.nome_social.trim(), sexo: patient.sexo, nascimento: patient.nascimento, cpf: patient.cpf.trim(), celular: '+' + digits, cep: patient.cep.trim(), complemento: patient.complemento.trim(), endereco_residencial: patient.endereco_residencial.trim(), numero: patient.numero.trim(), bairro: patient.bairro.trim(), cidade: patient.cidade.trim(), estado: patient.estado, email: patient.email.trim() }
    if (registerInMedx) {
      const missing = validateMedxRegistration(preliminaryPayload)
      if (missing.length) { setError(`Para gravar no MedX, preencha: ${missing.join(', ')}.`); return }
    }
    setSaving(true); setSavingMode(registerInMedx ? 'medx' : 'crm'); setError('')

    try {
      const { data: existing, error: lookupErr } = await supabase.from('contacts').select('*').eq('phone', '+' + digits).maybeSingle()
      if (lookupErr) throw new Error('Erro ao verificar o telefone: ' + lookupErr.message)
      if (existing && !registerInMedx) {
        setError('Já existe um contato com esse telefone. Busque por ele na lista de contatos.')
        return
      }

      let data = existing as Contact | null
      if (!data) {
        const { data: created, error: insertErr } = await supabase.from('contacts').insert({
          full_name: fullName.trim(),
          phone: '+' + digits,
          source: 'whatsapp',
          conversation_status: 'active',
          assigned_to: agent?.id ?? null,
          sofia_paused: sofiaDisabled,
          email: patient.email.trim() || null,
          cpf: patient.cpf.trim() || null,
          custom_fields: { sofia_never_respond: sofiaDisabled, dados_medx: { cep: patient.cep.trim() || null, complemento: patient.complemento.trim() || null, nome_social: patient.nome_social.trim() || null, sexo: patient.sexo || null, nascimento: patient.nascimento || null, endereco_residencial: patient.endereco_residencial.trim() || null, numero: patient.numero.trim() || null, bairro: patient.bairro.trim() || null, cidade: patient.cidade.trim() || null, estado: patient.estado || null } },
        } as any).select().single()
        if (insertErr || !created) throw new Error('Erro ao criar contato: ' + (insertErr?.message || 'sem retorno do banco'))
        data = created as Contact
      }

      if (registerInMedx) {
        if (data.medx_id) { setError(`Este contato já está vinculado ao MedX (ID ${data.medx_id}).`); return }
        const payload = { ...preliminaryPayload, contact_id: data.id }
        const { medxId } = await registerPatientInMedx(payload)
        const { data: updated, error: updateErr } = await supabase.from('contacts').update({ medx_id: medxId }).eq('id', data.id).select().single()
        if (updateErr) throw new Error(`Paciente criado no MedX (ID ${medxId}), mas o vínculo não foi salvo no CRM: ${updateErr.message}`)
        onCreated((updated || data) as Contact)
        return
      }
      onCreated(data)
    } catch (e: any) {
      setError(e?.message || 'Não foi possível concluir o cadastro. Tente novamente.')
    } finally {
      setSaving(false)
      setSavingMode(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800">Iniciar nova conversa</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <X size={18}/>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* Seletor de canal */}
          <div>
            <label className="text-xs text-slate-500 mb-2 block">Canal</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setChannel('whatsapp')}
                className={clsx('flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                  channel === 'whatsapp' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>
                <Smartphone size={16}/> WhatsApp
              </button>
              <button type="button" disabled title="Só é possível responder pelo Instagram depois que o paciente manda a primeira mensagem — a Meta não permite iniciar conversas novas por lá."
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-300 cursor-not-allowed bg-slate-50">
                <InstagramIcon size={16}/> Instagram
              </button>
            </div>
            {channel === 'whatsapp' && (
              <p className="text-xs text-slate-400 mt-2 flex items-start gap-1">
                <Info size={12} className="flex-shrink-0 mt-0.5"/>
                O Instagram fica desativado aqui porque a Meta só libera responder depois que o próprio paciente escreve
                primeiro — não dá pra começar uma conversa nova por lá, só pelo WhatsApp.
              </p>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5"><Stethoscope size={12}/> Dados do paciente</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={patient.cpf} onChange={e => setPatient(p => ({...p, cpf:e.target.value}))} placeholder="CPF" className="field-input"/>
              <input value={patient.email} onChange={e => setPatient(p => ({...p, email:e.target.value}))} placeholder="E-mail" className="field-input"/>
              <input value={patient.nome_social} onChange={e => setPatient(p => ({...p, nome_social:e.target.value}))} placeholder="Nome social" className="field-input"/>
              <select value={patient.sexo} onChange={e => setPatient(p => ({...p, sexo:e.target.value}))} className="field-input"><option value="">Sexo</option><option value="M">Masculino</option><option value="F">Feminino</option></select>
              <input type="date" value={patient.nascimento} onChange={e => setPatient(p => ({...p, nascimento:e.target.value}))} className="field-input col-span-2"/>
              <CampoCep value={patient.cep} onChange={cep => setPatient(p => ({...p, cep}))}
                onEndereco={e => setPatient(p => ({...p, endereco_residencial: e.logradouro || p.endereco_residencial, bairro: e.bairro || p.bairro, cidade: e.cidade || p.cidade, estado: e.uf || p.estado}))}/>
              <p className="text-[11px] text-slate-400 self-center">Digite o CEP e o endereço se preenche.</p>
              <input value={patient.endereco_residencial} onChange={e => setPatient(p => ({...p, endereco_residencial:e.target.value}))} placeholder="Endereço" className="field-input col-span-2"/>
              <input value={patient.numero} onChange={e => setPatient(p => ({...p, numero:e.target.value}))} placeholder="Número" className="field-input"/>
              <input value={patient.complemento} onChange={e => setPatient(p => ({...p, complemento:e.target.value}))} placeholder="Complemento" className="field-input"/>
              <input value={patient.bairro} onChange={e => setPatient(p => ({...p, bairro:e.target.value}))} placeholder="Bairro" className="field-input col-span-2"/>
              <input value={patient.cidade} onChange={e => setPatient(p => ({...p, cidade:e.target.value}))} placeholder="Cidade" className="field-input"/>
              <input value={patient.estado} onChange={e => setPatient(p => ({...p, estado:e.target.value.toUpperCase().slice(0,2)}))} placeholder="UF" maxLength={2} className="field-input"/>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Nome do contato</label>
            <input value={fullName} onChange={e => setFullName(e.target.value)}
              placeholder="Nome completo"
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Telefone (com DDD)</label>
            <input value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="+5511999999999"
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>

          <label className="flex items-start gap-3 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
            <input type="checkbox" checked={sofiaDisabled} onChange={e => setSofiaDisabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-300 text-brand-600 focus:ring-brand-500"/>
            <span>
              <span className="block text-sm font-medium text-amber-900">{assistantName} não atende este paciente</span>
              <span className="block text-xs text-amber-700 mt-0.5">Quando marcado, {assistantName} nunca responderá a este paciente, mesmo se estiver ativa globalmente.</span>
            </span>
          </label>

          {error && (
            <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <div className="grid grid-cols-2 gap-2">
          <button onClick={() => handleCreate(false)} disabled={saving}
            className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
            {savingMode === 'crm' ? <Loader2 size={14} className="animate-spin"/> : null}
            {savingMode === 'crm' ? 'Criando...' : 'Criar contato'}
          </button>
          <button onClick={() => handleCreate(true)} disabled={saving}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
            {savingMode === 'medx' ? <Loader2 size={14} className="animate-spin"/> : <Stethoscope size={14}/>} {savingMode === 'medx' ? 'Gravando no MedX...' : 'Criar e gravar no MedX'}
          </button>
          </div>
          {savingMode === 'medx' && <p className="mt-2 text-center text-xs text-emerald-700">Aguarde a confirmação do MedX. Esta etapa pode levar alguns segundos.</p>}
          {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  )
}
