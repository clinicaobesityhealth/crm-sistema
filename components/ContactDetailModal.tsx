'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Contact } from '@/lib/supabase'
import CampoCep from '@/components/CampoCep'
import PhotoCapture from '@/components/PhotoCapture'
import ChannelBadge from '@/components/ChannelBadge'
import InstagramIcon from '@/components/icons/InstagramIcon'
import ContactAvatar from '@/components/ContactAvatar'
import CopiarTexto from '@/components/CopiarTexto'
import UnirCadastros, { InstagramVinculados } from '@/components/UnirCadastros'
import { psidDoContato, ehSomenteInstagram } from '@/lib/instagram'
import {
  X, Pencil, Save, Loader2, Phone, Mail, Tag as TagIcon,
  Calendar, Globe, User, FileText, Plus, AlertCircle, Activity, Smartphone, CheckCircle2, Link2,
  Stethoscope, RefreshCw, CreditCard, MapPin, MessageSquare, Users, AlertTriangle,
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'
import { PATIENT_STATUS_LIST, PATIENT_STATUS_CONFIG, statusConfig } from '@/lib/patientStatus'
import { useAiAssistantName } from '@/lib/useAiAssistantName'
import { registerPatientInMedx, validateMedxRegistration } from '@/lib/medxRegistration'

const WH_BUSCAR_FOTO = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-buscar-foto-whatsapp'
const WH_VINCULAR_INSTAGRAM = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-vincular-instagram'

type Props = {
  contact: Contact
  startInEdit?: boolean
  onClose: () => void
  onSaved: (updated: Contact) => void
  // Quem chama decide como a conversa começa. A tela de Contatos sabe tratar
  // contato bloqueado, conversa de outro atendente e conversa encerrada; este
  // cadastro não precisa saber nada disso.
  onStartConversation?: (contact: Contact) => void
}

export default function ContactDetailModal({ contact, startInEdit = false, onClose, onSaved, onStartConversation }: Props) {
  const router = useRouter()
  const assistantName = useAiAssistantName()
  const [editing, setEditing] = useState(startInEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [avatarUrl, setAvatarUrl] = useState(contact.avatar_url || '')
  const [fetchingPhoto, setFetchingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [showIgLinkForm, setShowIgLinkForm] = useState(false)
  const [igPsidInput, setIgPsidInput] = useState('')
  const [igAccountInput, setIgAccountInput] = useState('')
  const [linkingIg, setLinkingIg] = useState(false)
  const [igLinkError, setIgLinkError] = useState('')
  // v48.10 — União do contato que só existe no Instagram com o cadastro de
  // WhatsApp da mesma pessoa, feita a partir DESTE lado. Antes só existia o
  // caminho inverso, e ele exigia o identificador do Instagram — que não
  // aparecia em tela nenhuma.
  const [showUnirWa, setShowUnirWa] = useState(false)
  const [buscaWa, setBuscaWa] = useState('')
  const [achadosWa, setAchadosWa] = useState<Contact[]>([])
  const [unindo, setUnindo] = useState(false)
  const [unirErro, setUnirErro] = useState('')
  const [convenios, setConvenios] = useState<{ id: string; nome: string }[]>([])
  const [planos, setPlanos] = useState<{ id: string; convenio_id: string; nome: string }[]>([])
  const [medxBuscando, setMedxBuscando] = useState(false)
  const [medxNaoEncontrado, setMedxNaoEncontrado] = useState(false)
  const [medxGravando, setMedxGravando] = useState(false)
  const [medxResultado, setMedxResultado] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    // Carrega tags cadastradas para sugestão
    supabase.from('tags').select('name').order('name').then(({ data }) => {
      setAvailableTags((data ?? []).map((t: any) => t.name))
    })
    // Convênios e planos, para o bloco de convênio do paciente. Se as tabelas
    // ainda não existirem, as listas ficam vazias e o bloco simplesmente não
    // oferece opções — nada quebra.
    supabase.from('cirurgia_convenios').select('id, nome').eq('ativo', true).order('ordem')
      .then(({ data }) => setConvenios((data ?? []) as any[]))
    supabase.from('cirurgia_planos').select('id, convenio_id, nome').eq('ativo', true).order('ordem')
      .then(({ data }) => setPlanos((data ?? []) as any[]))
  }, [])

  // Campos espelhados do cadastro MedX. cpf ja e uma coluna nativa do
  // contato; os demais ficam guardados em custom_fields.dados_medx (mesmo
  // local usado pela aba "Dados" do atendimento, pra nao duplicar/perder dado).
  function formFromContact(c: Contact) {
    const dm = c.custom_fields?.dados_medx || {}
    return {
      full_name: c.full_name || '',
      phone: c.phone || '',
      email: c.email || '',
      source: c.source || '',
      notes: c.notes || '',
      tags: c.tags || [],
      patient_status: c.patient_status || 'novo',
      sofia_paused: c.custom_fields?.sofia_never_respond === true,
      cpf: (c as any).cpf || '',
      nome_social: dm.nome_social || '',
      sexo: dm.sexo || '',
      nascimento: dm.nascimento || '',
      cep: dm.cep || '',
      endereco_residencial: dm.endereco_residencial || '',
      numero: dm.numero || '',
      complemento: dm.complemento || '',
      bairro: dm.bairro || '',
      cidade: dm.cidade || '',
      estado: dm.estado || '',
      convenio_id: (c as any).convenio_id || '',
      plano_id: (c as any).plano_id || '',
      carteirinha: (c as any).carteirinha || '',
      carteirinha_nome: (c as any).carteirinha_nome || '',
      carteirinha_validade: (c as any).carteirinha_validade || '',
      // v48.106 — Alergia, em campo próprio: é o que liga o selo vermelho na
      // lista de cirurgias e no link do cirurgião (ver CirurgiaModal.tsx e
      // agendar-cirurgia/[token]/page.tsx).
      alergico: !!c.alergico,
      alergia_obs: c.alergia_obs || '',
    }
  }

  const [form, setForm] = useState(formFromContact(contact))

  useEffect(() => {
    setForm(formFromContact(contact))
    setAvatarUrl(contact.avatar_url || '')
  }, [contact])

  // Busca automática e silenciosa no MedX ao abrir o cadastro de um contato
  // com dados incompletos - mesma lógica do atendimento, pra não depender de
  // alguém lembrar de clicar em "Buscar no MedX".
  useEffect(() => {
    let cancelado = false
    const dm = contact.custom_fields?.dados_medx || {}
    const cadastroIncompleto = !dm.nascimento || !dm.sexo || !dm.endereco_residencial || !dm.bairro || !dm.cidade || !dm.estado
    const temComoBuscar = !!(contact.full_name && (contact.phone || (contact as any).cpf))
    if (!cadastroIncompleto || !temComoBuscar) return

    async function autoBuscarNoMedx() {
      try {
        const res = await fetch('/api/medx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: contact.full_name, telefone: contact.phone, cpf: (contact as any).cpf }),
        })
        const json = await res.json().catch(() => ({}))
        const pac = json?.paciente
        if (cancelado || pac?.resultado !== 'encontrado') return
        const dmNovo: Record<string, any> = { ...dm }
        if (pac.nascimento && !dmNovo.nascimento) dmNovo.nascimento = pac.nascimento
        if (pac.sexo && !dmNovo.sexo) dmNovo.sexo = pac.sexo
        if (pac.nome_social && !dmNovo.nome_social) dmNovo.nome_social = pac.nome_social
        if (pac.endereco_residencial && !dmNovo.endereco_residencial) dmNovo.endereco_residencial = pac.endereco_residencial
        if (pac.bairro && !dmNovo.bairro) dmNovo.bairro = pac.bairro
        if (pac.numero && !dmNovo.numero) dmNovo.numero = pac.numero
        if (pac.cep && !dmNovo.cep) dmNovo.cep = String(pac.cep)
        if (pac.complemento && !dmNovo.complemento) dmNovo.complemento = pac.complemento
        if (pac.cidade && !dmNovo.cidade) dmNovo.cidade = pac.cidade
        if (pac.estado && !dmNovo.estado) dmNovo.estado = pac.estado
        const { data: updated } = await supabase.from('contacts').update({
          medx_id: pac.Id_do_Cliente ? String(pac.Id_do_Cliente) : (contact as any).medx_id || null,
          cpf: pac.cpf || (contact as any).cpf || null,
          email: contact.email || pac.email || null,
          custom_fields: { ...(contact.custom_fields || {}), dados_medx: dmNovo },
        }).eq('id', contact.id).select().single()
        if (!cancelado && updated) onSaved(updated as Contact)
      } catch {
        // Silencioso: se falhar, ainda dá pra buscar manualmente pelo botão.
      }
    }
    autoBuscarNoMedx()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id])


  async function addTag() {
    const t = tagInput.trim()
    if (!t || form.tags.includes(t)) { setTagInput(''); return }
    setForm(f => ({ ...f, tags: [...f.tags, t] }))
    setTagInput('')
    // Se a tag não existe na lista salva, pergunta se quer adicionar
    if (!availableTags.includes(t)) {
      if (confirm(`A tag "${t}" não está na lista. Deseja salvá-la para usar em outros contatos?`)) {
        await supabase.from('tags').insert({ name: t }).then(() => {
          setAvailableTags(prev => [...prev, t].sort())
        })
      }
    }
  }

  function addExistingTag(tag: string) {
    if (form.tags.includes(tag)) {
      setForm(f => ({ ...f, tags: f.tags.filter((t: string) => t !== tag) }))
    } else {
      setForm(f => ({ ...f, tags: [...f.tags, tag] }))
    }
  }

  function removeTag(tag: string) {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }))
  }

  async function handleSave() {
    if (!form.full_name.trim()) {
      setError('O nome é obrigatório.')
      return
    }
    setSaving(true)
    setError('')

    const dadosMedx = {
      ...(contact.custom_fields?.dados_medx || {}),
      nome_social: form.nome_social.trim() || null,
      sexo: form.sexo || null,
      nascimento: form.nascimento || null,
      cep: form.cep.trim() || null,
      endereco_residencial: form.endereco_residencial.trim() || null,
      numero: form.numero.trim() || null,
      complemento: form.complemento.trim() || null,
      bairro: form.bairro.trim() || null,
      cidade: form.cidade.trim() || null,
      estado: form.estado || null,
    }

    const { data, error: err } = await supabase
      .from('contacts')
      .update({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        source: form.source.trim() || null,
        notes: form.notes.trim() || null,
        tags: form.tags,
        patient_status: form.patient_status,
        convenio_id: form.convenio_id || null,
        plano_id: form.plano_id || null,
        carteirinha: form.carteirinha.trim() || null,
        carteirinha_nome: form.carteirinha_nome.trim() || null,
        carteirinha_validade: form.carteirinha_validade || null,
        sofia_paused: form.sofia_paused,
        cpf: form.cpf.trim() || null,
        // v48.106 — Alergia do paciente, em destaque na lista de cirurgias e
        // no link do cirurgião.
        alergico: form.alergico,
        alergia_obs: form.alergico ? (form.alergia_obs.trim() || null) : null,
        custom_fields: { ...(contact.custom_fields || {}), dados_medx: dadosMedx, sofia_never_respond: form.sofia_paused },
        avatar_url: avatarUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
      .select()
      .single()

    setSaving(false)

    if (err) {
      setError('Não foi possível salvar. Tente novamente.')
      return
    }
    onSaved(data as Contact)
    setEditing(false)
  }

  async function handleFetchWhatsappPhoto() {
    const phone = form.phone.trim()
    if (!phone) {
      setPhotoError('Informe o telefone antes de buscar a foto.')
      return
    }
    setFetchingPhoto(true)
    setPhotoError('')
    try {
      const resp = await fetch(WH_BUSCAR_FOTO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contact.id, phone }),
      })
      const data = await resp.json()
      if (!resp.ok || !data.success || !data.avatar_url) {
        setPhotoError('Não encontramos foto de perfil para esse número no WhatsApp.')
        return
      }
      setAvatarUrl(data.avatar_url)
    } catch {
      setPhotoError('Não foi possível buscar a foto agora. Tente novamente.')
    } finally {
      setFetchingPhoto(false)
    }
  }

  // Procura candidatos de WhatsApp pelo nome. Só entram contatos que tenham
  // telefone de verdade — unir dois cadastros de Instagram não resolveria nada.
  useEffect(() => {
    const q = buscaWa.trim()
    if (q.length < 3) { setAchadosWa([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('contacts')
        .select('*').ilike('full_name', `%${q.replace(/[,()*%]/g, ' ')}%`).limit(8)
      setAchadosWa(((data ?? []) as Contact[]).filter(c => c.phone && !c.phone.startsWith('ig:')))
    }, 250)
    return () => clearTimeout(t)
  }, [buscaWa])

  async function unirComWhatsApp(alvo: Contact) {
    const psid = psidDoContato(contact)
    if (!psid) { setUnirErro('Não encontrei o identificador do Instagram deste contato.'); return }
    if (!alvo.phone) { setUnirErro('O contato escolhido está sem telefone.'); return }
    setUnindo(true); setUnirErro('')
    try {
      const resp = await fetch(WH_VINCULAR_INSTAGRAM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone: alvo.phone,
          sender_psid: psid,
          ig_account_name: (contact.custom_fields as any)?.ig_account_name || null,
        }),
      })
      const data = await resp.json()
      if (!data.sucesso) { setUnirErro(data.mensagem || 'Não foi possível unir os dois cadastros.'); return }
      // Terminada a união, este cadastro temporário é arquivado pelo fluxo.
      // Fechar dispara a recarga da lista — ficar aberto mostraria um cadastro
      // que não existe mais como estava.
      onClose()
    } catch {
      setUnirErro('Erro ao unir. Tente novamente.')
    } finally {
      setUnindo(false)
    }
  }

  // v48.48 — Buscar a foto do Instagram e GUARDAR no armazenamento da clínica.
  //
  // O endereço que o Instagram entrega vence. Antes, o cadastro guardava esse
  // endereço e a foto sumia dias depois — e tentar de novo não adiantava, porque
  // era sempre o mesmo endereço morto. Agora o servidor baixa a imagem e guarda
  // uma cópia nossa, com endereço que não vence.
  async function buscarFotoInstagram() {
    setFetchingPhoto(true); setPhotoError('')
    try {
      const resp = await fetch('/api/instagram/foto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contact.id }),
      })
      const data = await resp.json()
      if (!data.ok) { setPhotoError(data.erro || 'Não foi possível buscar a foto do Instagram.'); return }
      setAvatarUrl(data.avatar_url)
    } catch (e: any) {
      setPhotoError('Não foi possível buscar a foto do Instagram: ' + (e?.message || String(e)))
    } finally {
      setFetchingPhoto(false)
    }
  }

  async function linkInstagram() {
    const psid = igPsidInput.trim()
    if (!psid) { setIgLinkError('Cole o PSID (ID) da conversa do Instagram.'); return }
    if (!contact.phone) { setIgLinkError('Este contato precisa ter um telefone de WhatsApp cadastrado antes de vincular.'); return }
    setLinkingIg(true); setIgLinkError('')
    try {
      const resp = await fetch(WH_VINCULAR_INSTAGRAM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone: contact.phone,
          sender_psid: psid,
          ig_account_name: igAccountInput.trim() || null,
        }),
      })
      const data = await resp.json()
      if (!data.sucesso) {
        setIgLinkError(data.mensagem || 'Não foi possível vincular.')
        return
      }
      const { data: fresh } = await supabase.from('contacts').select('*').eq('id', contact.id).single()
      if (fresh) onSaved(fresh)
      setShowIgLinkForm(false); setIgPsidInput(''); setIgAccountInput('')
    } catch {
      setIgLinkError('Erro ao vincular. Tente novamente.')
    } finally {
      setLinkingIg(false)
    }
  }

  // Busca o paciente no MedX (por nome/telefone/cpf ja digitados no form) e
  // preenche os campos do cadastro que ainda estiverem vazios.
  async function buscarNoMedx() {
    setMedxBuscando(true)
    setMedxNaoEncontrado(false)
    try {
      const res = await fetch('/api/medx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: form.full_name, telefone: form.phone, cpf: form.cpf }),
      })
      const json = await res.json().catch(() => ({}))
      const pac = json?.paciente
      if (pac?.resultado === 'encontrado') {
        setForm(f => ({
          ...f,
          cpf: f.cpf.trim() || pac.cpf || '',
          email: f.email.trim() || pac.email || '',
          nome_social: f.nome_social.trim() || pac.nome_social || '',
          sexo: f.sexo || pac.sexo || '',
          nascimento: f.nascimento || (pac.nascimento ? String(pac.nascimento).slice(0, 10) : ''),
          endereco_residencial: f.endereco_residencial.trim() || pac.endereco_residencial || '',
          bairro: f.bairro.trim() || pac.bairro || '',
          cep: f.cep.trim() || (pac.cep ? String(pac.cep) : ''),
          numero: f.numero.trim() || pac.numero || '',
          complemento: f.complemento.trim() || pac.complemento || '',
          cidade: f.cidade.trim() || pac.cidade || '',
          estado: f.estado || pac.estado || '',
        }))
      } else {
        setMedxNaoEncontrado(true)
      }
    } catch {
      setMedxNaoEncontrado(true)
    } finally {
      setMedxBuscando(false)
    }
  }

  async function gravarNoMedx() {
    if (contact.medx_id) { setMedxResultado({ ok: false, text: `Paciente já vinculado ao MedX (ID ${contact.medx_id}).` }); return }
    const payload = { contact_id: contact.id, nome: form.full_name.trim(), nome_social: form.nome_social.trim(), sexo: form.sexo, nascimento: form.nascimento, cpf: form.cpf.trim(), celular: form.phone.trim(), cep: form.cep.trim(), complemento: form.complemento.trim(), endereco_residencial: form.endereco_residencial.trim(), numero: form.numero.trim(), bairro: form.bairro.trim(), cidade: form.cidade.trim(), estado: form.estado, email: form.email.trim() }
    const missing = validateMedxRegistration(payload)
    if (missing.length) { setMedxResultado({ ok: false, text: `Preencha antes de gravar: ${missing.join(', ')}.` }); return }
    setMedxGravando(true); setMedxResultado(null)
    try {
      const { medxId } = await registerPatientInMedx(payload)
      const dadosMedx = { ...(contact.custom_fields?.dados_medx || {}), nome_social: payload.nome_social || null, sexo: payload.sexo, nascimento: payload.nascimento, cep: payload.cep || null, complemento: payload.complemento || null, endereco_residencial: payload.endereco_residencial || null, numero: payload.numero || null, bairro: payload.bairro || null, cidade: payload.cidade || null, estado: payload.estado || null }
      const { data, error: updateError } = await supabase.from('contacts').update({ medx_id: medxId, full_name: payload.nome, phone: payload.celular, email: payload.email || null, cpf: payload.cpf, custom_fields: { ...(contact.custom_fields || {}), dados_medx: dadosMedx }, updated_at: new Date().toISOString() }).eq('id', contact.id).select().single()
      if (updateError || !data) throw new Error('Paciente cadastrado no MedX, mas não foi possível atualizar o CRM.')
      onSaved(data as Contact); setEditing(false)
      setMedxResultado({ ok: true, text: `Paciente gravado no MedX com sucesso. ID ${medxId}.` })
    } catch (e: any) { setMedxResultado({ ok: false, text: e?.message || 'Não foi possível gravar no MedX.' }) }
    finally { setMedxGravando(false) }
  }

  function handleCancelEdit() {
    setForm(formFromContact(contact))
    setError('')
    setEditing(false)
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            {editing ? (
              <div className="flex items-center gap-2">
                <PhotoCapture
                  currentUrl={avatarUrl || null}
                  onUploaded={url => setAvatarUrl(url)}
                  shape="circle"
                  size={48}
                />
                <button
                  type="button"
                  onClick={handleFetchWhatsappPhoto}
                  disabled={fetchingPhoto}
                  title="Buscar foto de perfil no WhatsApp"
                  className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-brand-600 transition-colors disabled:opacity-50">
                  {fetchingPhoto ? <Loader2 size={16} className="animate-spin"/> : <Smartphone size={16}/>}
                </button>
                {psidDoContato(contact) && (
                  <button
                    type="button"
                    onClick={buscarFotoInstagram}
                    disabled={fetchingPhoto}
                    title="Buscar foto de perfil no Instagram"
                    className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-pink-600 transition-colors disabled:opacity-50">
                    {fetchingPhoto ? <Loader2 size={16} className="animate-spin"/> : <InstagramIcon size={16}/>}
                  </button>
                )}
              </div>
            ) : (
              <div className="relative flex-shrink-0">
                <ContactAvatar avatarUrl={avatarUrl} name={contact.full_name} id={contact.id} sizeClass="w-12 h-12" textClass="text-base"/>
                <ChannelBadge channel={contact.custom_fields?.channel} accountName={contact.custom_fields?.ig_account_name} size={17}/>
              </div>
            )}
            <div>
              {editing ? (
                <input
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  className="text-base font-semibold text-slate-800 border-b border-brand-300 focus:outline-none focus:border-brand-500 bg-transparent"/>
              ) : (
                <h2 className="text-base font-semibold text-slate-800">{contact.full_name || 'Sem nome'}</h2>
              )}
              <p className="text-xs text-slate-400 mt-0.5">
                Cadastrado em {format(new Date(contact.created_at), "d 'de' MMM 'de' yyyy", { locale: ptBR })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                title="Editar cadastro"
                className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-brand-600 transition-colors">
                <Pencil size={16}/>
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
              <X size={18}/>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
              {error}
            </div>
          )}

          {photoError && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
              {photoError}
            </div>
          )}

          {/* Telefone */}
          <Field icon={<Phone size={14}/>} label="Telefone">
            {editing ? (
              <input
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+5511999999999"
                className="field-input"/>
            ) : (
              <p className="text-sm text-slate-700">
                {ehSomenteInstagram(contact)
                  ? 'Sem WhatsApp vinculado ainda'
                  : (contact.phone || '—')}
              </p>
            )}
          </Field>

          {/* v48.22 — Convênio do paciente. Fica no cadastro porque é dele e não
              muda a cada cirurgia: ao lançar uma, já vem preenchido, e ainda
              assim pode ser trocado naquele caso específico. */}
          <Field icon={<CreditCard size={14}/>} label="Convênio">
            {editing ? (
              <div className="space-y-2">
                <select value={form.convenio_id}
                  onChange={e => setForm(f => ({ ...f, convenio_id: e.target.value, plano_id: '' }))}
                  className="field-input">
                  <option value="">Particular (sem convênio)</option>
                  {convenios.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>

                {form.convenio_id && (
                  <>
                    <select value={form.plano_id}
                      onChange={e => setForm(f => ({ ...f, plano_id: e.target.value }))}
                      className="field-input">
                      <option value="">Sem plano específico</option>
                      {planos.filter(p => p.convenio_id === form.convenio_id).map(p => (
                        <option key={p.id} value={p.id}>{p.nome}</option>
                      ))}
                    </select>
                    <input value={form.carteirinha}
                      onChange={e => setForm(f => ({ ...f, carteirinha: e.target.value }))}
                      placeholder="Número da carteirinha" className="field-input"/>
                    <input value={form.carteirinha_nome}
                      onChange={e => setForm(f => ({ ...f, carteirinha_nome: e.target.value }))}
                      placeholder="Nome como está na carteirinha" className="field-input"/>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Validade da carteirinha</label>
                      <input type="date" value={form.carteirinha_validade}
                        onChange={e => setForm(f => ({ ...f, carteirinha_validade: e.target.value }))}
                        className="field-input"/>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="text-sm text-slate-700">
                {form.convenio_id ? (
                  <>
                    <p>
                      {convenios.find(c => c.id === form.convenio_id)?.nome || 'Convênio'}
                      {form.plano_id ? ` · ${planos.find(p => p.id === form.plano_id)?.nome ?? ''}` : ''}
                    </p>
                    {form.carteirinha && <p className="text-xs text-slate-500 mt-0.5">Carteirinha {form.carteirinha}</p>}
                    {form.carteirinha_nome && <p className="text-xs text-slate-500">Em nome de {form.carteirinha_nome}</p>}
                    {form.carteirinha_validade && (
                      <p className={'text-xs mt-0.5 ' + (form.carteirinha_validade < new Date().toISOString().slice(0,10) ? 'text-red-600 font-semibold' : 'text-slate-500')}>
                        Válida até {form.carteirinha_validade.split('-').reverse().join('/')}
                        {form.carteirinha_validade < new Date().toISOString().slice(0,10) ? ' — vencida' : ''}
                      </p>
                    )}
                  </>
                ) : <p className="text-slate-400">Particular</p>}
              </div>
            )}
          </Field>

          {/* v48.10 — Contato que só existe no Instagram: mostra o identificador
              (que antes ficava invisível) e oferece unir com um cadastro de
              WhatsApp sem precisar copiar nada à mão. */}
          {ehSomenteInstagram(contact) && (
            <Field icon={<InstagramIcon size={14}/>} label="Instagram">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <span className="flex-1 min-w-0 font-mono text-xs text-slate-600 break-all">
                    {psidDoContato(contact)}
                  </span>
                  <CopiarTexto valor={psidDoContato(contact) || ''} titulo="Copiar o identificador do Instagram"/>
                </div>
                <p className="text-[11px] text-slate-400">
                  Este é o identificador da conversa no Instagram. É ele que une este cadastro ao de WhatsApp
                  da mesma pessoa.
                </p>

                {showUnirWa ? (
                  <div className="space-y-2 px-3 py-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-xs text-slate-500">
                      Procure o cadastro de WhatsApp desta mesma pessoa. As mensagens dos dois canais passam a
                      cair na mesma conversa.
                    </p>
                    <input
                      value={buscaWa}
                      onChange={e => setBuscaWa(e.target.value)}
                      placeholder="Nome do paciente..."
                      className="field-input"/>
                    {buscaWa.trim().length >= 3 && (
                      achadosWa.length === 0 ? (
                        <p className="text-[11px] text-slate-400">
                          Nenhum contato com WhatsApp encontrado com esse nome.
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {achadosWa.map(a => (
                            <button key={a.id} type="button" disabled={unindo}
                              onClick={() => unirComWhatsApp(a)}
                              className="w-full text-left px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-brand-300 disabled:opacity-50">
                              <p className="text-sm text-slate-700">{a.full_name}</p>
                              <p className="text-[11px] text-slate-400">{a.phone}</p>
                            </button>
                          ))}
                        </div>
                      )
                    )}
                    {unirErro && (
                      <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12}/>{unirErro}</p>
                    )}
                    <div className="flex justify-end">
                      <button type="button" onClick={() => { setShowUnirWa(false); setUnirErro(''); setBuscaWa('') }}
                        disabled={unindo}
                        className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowUnirWa(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-brand-200 text-brand-700 text-xs font-semibold rounded-lg">
                    <Link2 size={13}/> Unir a um contato de WhatsApp
                  </button>
                )}
              </div>
            </Field>
          )}

          {/* Instagram vinculado */}
          {!(contact.custom_fields?.channel === 'instagram' && contact.phone?.startsWith('ig:')) && (
            <Field icon={<InstagramIcon size={14}/>} label="Instagram">
              {/* v48.11 — O que prova a vinculação é o IDENTIFICADOR, não o nome
                  da conta. O nome é opcional no formulário: quando ficava em
                  branco, a união acontecia de verdade mas a tela continuava
                  dizendo "Não vinculado" — e a pessoa tentava vincular de novo,
                  achando que não tinha funcionado. */}
              {psidDoContato(contact) ? (
                <div className="px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0 mt-0.5"/>
                    <p className="text-sm text-emerald-800">
                      Instagram vinculado
                      {contact.custom_fields?.ig_account_name
                        ? <> à conta <strong>{contact.custom_fields.ig_account_name}</strong></>
                        : null}
                      {' '}— mensagens do Instagram e do WhatsApp caem na mesma conversa.
                    </p>
                  </div>
                  <div className="flex items-center gap-1 mt-1.5 pl-6">
                    <span className="font-mono text-[11px] text-emerald-700/70 break-all">
                      {psidDoContato(contact)}
                    </span>
                    <CopiarTexto valor={psidDoContato(contact) || ''} titulo="Copiar o identificador do Instagram"/>
                  </div>
                </div>
              ) : showIgLinkForm ? (
                <div className="space-y-2 px-3 py-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500">
                    Cole o PSID (ID) da conversa do Instagram desse paciente para unir com este cadastro de WhatsApp.
                  </p>
                  <input
                    value={igPsidInput}
                    onChange={e => setIgPsidInput(e.target.value)}
                    placeholder="PSID do Instagram"
                    className="field-input"/>
                  <input
                    value={igAccountInput}
                    onChange={e => setIgAccountInput(e.target.value)}
                    placeholder="Nome da conta (opcional)"
                    className="field-input"/>
                  {igLinkError && (
                    <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12}/>{igLinkError}</p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => { setShowIgLinkForm(false); setIgLinkError(''); setIgPsidInput(''); setIgAccountInput('') }}
                      disabled={linkingIg}
                      className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg">
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={linkInstagram}
                      disabled={linkingIg}
                      className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg flex items-center gap-1.5">
                      {linkingIg ? <Loader2 size={12} className="animate-spin"/> : <Link2 size={12}/>}
                      Vincular
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-slate-400">Não vinculado</p>
                  <button
                    type="button"
                    onClick={() => setShowIgLinkForm(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 rounded-lg">
                    <Link2 size={12}/> Vincular Instagram
                  </button>
                </div>
              )}
            </Field>
          )}

          {/* v48.45 — Unir cadastros da mesma pessoa.
              Mora logo abaixo do Instagram porque é ali que o problema aparece:
              a paciente que escreveu para as duas contas da clínica tem dois
              cadastros, e nenhum deles está errado. */}
          <Field icon={<Users size={14}/>} label="Cadastro duplicado">
            <div className="space-y-2">
              <InstagramVinculados contato={contact}/>
              <UnirCadastros contato={contact} aoUnir={onClose}/>
            </div>
          </Field>

          {/* Email */}
          <Field icon={<Mail size={14}/>} label="Email">
            {editing ? (
              <input
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@exemplo.com"
                className="field-input"/>
            ) : (
              <p className="text-sm text-slate-700">{contact.email || '—'}</p>
            )}
          </Field>

          {/* Origem */}
          <Field icon={<Globe size={14}/>} label="Origem">
            {editing ? (
              <input
                value={form.source}
                onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                placeholder="whatsapp, import, indicação..."
                className="field-input"/>
            ) : (
              <p className="text-sm text-slate-700 capitalize">{contact.source || '—'}</p>
            )}
          </Field>

          {/* Status do paciente */}
          <Field icon={<Activity size={14}/>} label="Status do paciente">
            {editing ? (
              <div className="flex flex-wrap gap-1.5">
                {PATIENT_STATUS_LIST.map(st => {
                  const cfg = PATIENT_STATUS_CONFIG[st]
                  const active = form.patient_status === st
                  return (
                    <button key={st} type="button" onClick={() => setForm(f => ({ ...f, patient_status: st }))}
                      className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                        active ? `${cfg.bg} ${cfg.text} border-current` : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50')}>
                      <span className={clsx('w-2 h-2 rounded-full', cfg.dot)}/>
                      {cfg.label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', statusConfig(contact.patient_status).bg, statusConfig(contact.patient_status).text)}>
                <span className={clsx('w-2 h-2 rounded-full', statusConfig(contact.patient_status).dot)}/>
                {statusConfig(contact.patient_status).label}
              </span>
            )}
          </Field>

          {/* Bloqueio individual da Sofia */}
          <Field icon={<Activity size={14}/>} label={`Atendimento da ${assistantName}`}>
            {editing ? (
              <label className="flex items-start gap-3 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
                <input type="checkbox" checked={form.sofia_paused}
                  onChange={e => setForm(f => ({ ...f, sofia_paused: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-amber-300 text-brand-600 focus:ring-brand-500"/>
                <span>
                  <span className="block text-sm font-medium text-amber-900">{assistantName} não atende este paciente</span>
                  <span className="block text-xs text-amber-700 mt-0.5">Esta regra individual tem prioridade sobre a configuração global.</span>
                </span>
              </label>
            ) : (
              <span className={clsx('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
                contact.custom_fields?.sofia_never_respond ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700')}>
                {contact.custom_fields?.sofia_never_respond ? `${assistantName} não atende` : `${assistantName} pode atender`}
              </span>
            )}
          </Field>

          {/* Tags */}
          <Field icon={<TagIcon size={14}/>} label="Tags">
            {editing ? (
              <div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.tags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-brand-50 text-brand-700 rounded-full">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="hover:text-brand-900">
                        <X size={11}/>
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                    placeholder="Nova tag e Enter"
                    className="field-input flex-1"/>
                  <button
                    onClick={addTag}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors">
                    <Plus size={14}/>
                  </button>
                </div>
                {/* Tags já cadastradas para seleção rápida */}
                {availableTags.filter(t => !form.tags.includes(t)).length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-slate-400 mb-1.5">Tags disponíveis (clique para adicionar):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {availableTags.filter(t => !form.tags.includes(t)).map(tag => (
                        <button key={tag} onClick={() => addExistingTag(tag)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white border border-slate-200 text-slate-600 rounded-full hover:bg-slate-50 hover:border-brand-300">
                          <Plus size={10}/> {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : contact.tags && contact.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-brand-50 text-brand-700 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            ) : <p className="text-sm text-slate-400">Nenhuma tag</p>}
          </Field>

          {/* Cadastro (dados MedX) */}
          <div className="pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between mb-4 mt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Stethoscope size={12}/> Cadastro (dados MedX)
              </p>
              {editing && (
                <button
                  type="button"
                  onClick={buscarNoMedx}
                  disabled={medxBuscando}
                  className="flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
                  <RefreshCw size={11} className={medxBuscando ? 'animate-spin' : ''}/>
                  {medxBuscando ? 'Buscando...' : 'Buscar no MedX'}
                </button>
              )}
            </div>
            {editing && medxNaoEncontrado && (
              <p className="text-xs text-amber-600 mb-3 -mt-2">Paciente não encontrado no MedX com os dados atuais.</p>
            )}
            <div className="space-y-5">
              <Field icon={<CreditCard size={14}/>} label="CPF">
                {editing ? (
                  <input value={form.cpf} onChange={e => setForm(f => ({ ...f, cpf: e.target.value }))} className="field-input"/>
                ) : <p className="text-sm text-slate-700">{(contact as any).cpf || '—'}</p>}
              </Field>

              <Field icon={<User size={14}/>} label="Nome social">
                {editing ? (
                  <input value={form.nome_social} onChange={e => setForm(f => ({ ...f, nome_social: e.target.value }))} className="field-input"/>
                ) : <p className="text-sm text-slate-700">{contact.custom_fields?.dados_medx?.nome_social || '—'}</p>}
              </Field>

              <Field icon={<User size={14}/>} label="Sexo">
                {editing ? (
                  <select value={form.sexo} onChange={e => setForm(f => ({ ...f, sexo: e.target.value }))} className="field-input">
                    <option value="">Selecione</option>
                    <option value="M">Masculino</option>
                    <option value="F">Feminino</option>
                  </select>
                ) : (
                  <p className="text-sm text-slate-700">
                    {contact.custom_fields?.dados_medx?.sexo === 'M' ? 'Masculino'
                      : contact.custom_fields?.dados_medx?.sexo === 'F' ? 'Feminino' : '—'}
                  </p>
                )}
              </Field>

              <Field icon={<Calendar size={14}/>} label="Data de nascimento">
                {editing ? (
                  <input type="date" value={form.nascimento ? form.nascimento.slice(0, 10) : ''}
                    onChange={e => setForm(f => ({ ...f, nascimento: e.target.value }))} className="field-input"/>
                ) : (
                  <p className="text-sm text-slate-700">
                    {(() => {
                      const n = contact.custom_fields?.dados_medx?.nascimento
                      if (!n) return '—'
                      const [y, m, d] = n.slice(0, 10).split('-')
                      return d && m && y ? `${d}/${m}/${y}` : '—'
                    })()}
                  </p>
                )}
              </Field>

              <Field icon={<MapPin size={14}/>} label="Endereço">
                {editing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 items-start">
                      <CampoCep value={form.cep} onChange={cep => setForm(f => ({ ...f, cep }))}
                        onEndereco={e => setForm(f => ({ ...f, endereco_residencial: e.logradouro || f.endereco_residencial, bairro: e.bairro || f.bairro, cidade: e.cidade || f.cidade, estado: e.uf || f.estado }))}/>
                      <p className="text-[11px] text-slate-400 pt-2">Digite o CEP e o endereço se preenche.</p>
                    </div>
                    <input value={form.endereco_residencial} onChange={e => setForm(f => ({ ...f, endereco_residencial: e.target.value }))} placeholder="Logradouro" className="field-input"/>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder="Número" className="field-input"/>
                      <input value={form.complemento} onChange={e => setForm(f => ({ ...f, complemento: e.target.value }))} placeholder="Complemento" className="field-input"/>
                    </div>
                    <input value={form.bairro} onChange={e => setForm(f => ({ ...f, bairro: e.target.value }))} placeholder="Bairro" className="field-input"/>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} placeholder="Cidade" className="field-input"/>
                      <input value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} placeholder="UF" maxLength={2} className="field-input"/>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-700">
                    {contact.custom_fields?.dados_medx?.endereco_residencial
                      ? [
                          contact.custom_fields.dados_medx.endereco_residencial,
                          contact.custom_fields.dados_medx.numero,
                          contact.custom_fields.dados_medx.complemento,
                          contact.custom_fields.dados_medx.bairro,
                          contact.custom_fields.dados_medx.cidade,
                          contact.custom_fields.dados_medx.estado,
                          contact.custom_fields.dados_medx.cep ? 'CEP ' + contact.custom_fields.dados_medx.cep : null,
                        ].filter(Boolean).join(', ')
                      : '—'}
                  </p>
                )}
              </Field>
              {editing && (
                <div className="space-y-2 pt-2">
                  {medxResultado && <div className={clsx('flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs', medxResultado.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700')}>
                    {medxResultado.ok ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0"/> : <AlertCircle size={13} className="mt-0.5 flex-shrink-0"/>}{medxResultado.text}
                  </div>}
                  <button type="button" onClick={gravarNoMedx} disabled={medxGravando || !!contact.medx_id}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-500 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                    {medxGravando ? <Loader2 size={14} className="animate-spin"/> : <Stethoscope size={14}/>}
                    {contact.medx_id ? `Já vinculado ao MedX — ID ${contact.medx_id}` : medxGravando ? 'Gravando e confirmando...' : 'Gravar no MedX'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* v48.106 — Alergia. Campo próprio, não texto solto em "Notas": é o
              que liga o selo vermelho "ALÉRGICO(A)" na lista de cirurgias, na
              tela de lançar cirurgia e no link do cirurgião. */}
          <Field icon={<AlertTriangle size={14} className={form.alergico || contact.alergico ? 'text-red-500' : undefined}/>} label="Alergia">
            {editing ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.alergico}
                    onChange={e => setForm(f => ({ ...f, alergico: e.target.checked }))}
                    className="rounded"/>
                  Paciente alérgico(a)
                </label>
                {form.alergico && (
                  <textarea
                    value={form.alergia_obs}
                    onChange={e => setForm(f => ({ ...f, alergia_obs: e.target.value }))}
                    rows={2}
                    placeholder="A quê é alérgico (medicamentos, etc.)"
                    className="field-input resize-none"/>
                )}
              </div>
            ) : contact.alergico ? (
              <p className="text-sm text-red-700 font-semibold whitespace-pre-wrap flex items-start gap-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0"/>
                ALÉRGICO(A){(contact as any).alergia_obs ? ': ' + (contact as any).alergia_obs : ''}
              </p>
            ) : (
              <p className="text-sm text-slate-400">Nenhuma alergia registrada.</p>
            )}
          </Field>

          {/* Notas */}
          <Field icon={<FileText size={14}/>} label="Notas internas">
            {editing ? (
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={4}
                placeholder="Observações sobre o paciente..."
                className="field-input resize-none"/>
            ) : (
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{contact.notes || '—'}</p>
            )}
          </Field>

          {/* Último contato */}
          <Field icon={<Calendar size={14}/>} label="Último contato">
            <p className="text-sm text-slate-700">
              {contact.last_contacted_at
                ? format(new Date(contact.last_contacted_at), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })
                : 'Nunca'}
            </p>
          </Field>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 flex-shrink-0">
          {!editing ? (
            <button onClick={() => {
              if (onStartConversation) { onStartConversation(contact); return }
              router.push(`/inbox?contact=${contact.id}`)
            }}
              className="w-full px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
              <MessageSquare size={15}/> Iniciar conversa
            </button>
          ) : (<>
            <button
              onClick={handleCancelEdit}
              disabled={saving}
              className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
              Salvar alterações
            </button>
          </>)}
        </div>
      </div>

      <style jsx global>{`
        .field-input {
          width: 100%;
          font-size: 0.875rem;
          padding: 0.5rem 0.75rem;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          color: #0f172a;
        }
        .field-input:focus {
          outline: none;
          border-color: transparent;
          box-shadow: 0 0 0 2px #0c8ee7;
        }
      `}</style>
    </div>
  )
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
        {icon}
        {label}
      </div>
      {children}
    </div>
  )
}
