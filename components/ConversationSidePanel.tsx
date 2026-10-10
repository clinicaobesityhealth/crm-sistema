'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, Contact, Message, Professional, Sector, canReadPrivateMessage } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import ChannelBadge from '@/components/ChannelBadge'
import ContactAvatar from '@/components/ContactAvatar'
import {
  X, Pencil, Save, Loader2, Phone, Mail, Tag as TagIcon,
  Calendar, Globe, FileText, Plus, AlertCircle, Image as ImageIcon,
  File as FileIcon, Music, Video, Clock, CalendarClock, Trash2, AlertTriangle,
  Stethoscope, RefreshCw, User as UserIcon, CreditCard, MapPin, Hash, UploadCloud, CheckCircle2,
  Bold, Italic, Underline, Send, Activity, Ban, ShieldCheck, Users, Bot
} from 'lucide-react'
import CampoCep from '@/components/CampoCep'
import RecibosTab from '@/components/RecibosTab'
import InstagramIcon from '@/components/icons/InstagramIcon'
import UnirCadastros, { InstagramVinculados } from '@/components/UnirCadastros'
import { PATIENT_STATUS_LIST, PATIENT_STATUS_CONFIG, statusConfig } from '@/lib/patientStatus'
import { useAiAssistantName } from '@/lib/useAiAssistantName'
import {
  canaisDoContato, canaisBloqueados, bloquearContato, desbloquearContato, NOME_DO_CANAL, type CanalBloqueio,
} from '@/lib/bloqueio'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'
import { registerPatientInMedx, validateMedxRegistration } from '@/lib/medxRegistration'
import { buscarAgendamentosMedx } from '@/lib/medxAgendamentos'
import ProntuarioPanel from '@/components/ProntuarioPanel'
import { useAcessoProntuario } from '@/lib/acessoProntuario'

// Webhook que sincroniza os dados do cadastro de volta pro MedX (silencioso,
// disparado apos salvar quando o contato ja tem medx_id).
const WH_SYNC_MEDX = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-sync-paciente-medx'
const WH_ANEXAR_EXAME_MEDX = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-anexar-exame'
const WH_ANEXAR_DOCUMENTO_MEDX = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-anexar-documento'
// v46.90 — envio automático do resumo de exame (Área Evolução do MedX).
// Fluxo novo em n8n, separado do "Anexar Exame Medx" pra não mexer no que já
// funciona: login com o mesmo usuário da Sofia → InsertMedicalHistory → logout.
const WH_ENVIAR_ANOTACAO_MEDX = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-enviar-anotacao-medx'

// v48.137 — Pedido do Jorge: na aba Anexos, destacar diferente o que o
// PACIENTE mandou do que a EQUIPE (identificada) mandou. Mesmo padrão de
// cache de nome por sender_id já usado em app/inbox/page.tsx (SenderName),
// só que local a este arquivo — evita repetir uma busca ao banco por anexo
// toda vez que a lista renderiza.
const agentNameCacheAnexos: Record<string, string> = {}
function NomeRemetente({ senderId }: { senderId: string }) {
  const [nome, setNome] = useState<string | null>(agentNameCacheAnexos[senderId] ?? null)
  useEffect(() => {
    if (agentNameCacheAnexos[senderId]) { setNome(agentNameCacheAnexos[senderId]); return }
    supabase.from('agents').select('name').eq('id', senderId).single()
      .then(({ data }) => { if (data?.name) { agentNameCacheAnexos[senderId] = data.name; setNome(data.name) } })
  }, [senderId])
  return <>{nome || 'equipe'}</>
}

// Converte o resumo (texto simples, com os títulos fixos do prompt) pra HTML
// simples antes de mandar pro campo "Historico" do MedX — deixa os títulos de
// cada bloco em negrito, do jeito que já aparecia nos exames que o Jorge
// mostrou (Área Evolução aceita <strong>).
const RESUMO_TITULOS = ['Exames Alterados:', 'Normais (destaque):', 'Exames não alterados:']
// Marcação simples que tanto o Gemini (só usa **negrito** nos títulos, às
// vezes) quanto a pessoa revisando (usando os botões B/I/S da barra de
// ferramentas) podem colocar no texto: **negrito**, *itálico*, _sublinhado_.
// MedX não entende markdown, só HTML — essa marcação é convertida pra
// <strong>/<em>/<u> só na hora de montar o preview e o envio, nunca fica
// salva assim no banco.
//
// Pra decidir se uma linha é um dos títulos fixos do resumo (e por isso
// sempre fica em negrito, mesmo que a IA não tenha marcado nada), comparamos
// ignorando qualquer marcação — assim tanto "Exames Alterados:" quanto
// "**Exames Alterados:**" são reconhecidos do mesmo jeito.
function textoSemFormatacao(linha: string) {
  return linha.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '')
}
function ehLinhaTitulo(linha: string) {
  const limpo = textoSemFormatacao(linha).trim()
  return RESUMO_TITULOS.some(t => limpo === t) || /^LAB\s/i.test(limpo)
}
// Converte a marcação em tags de verdade. A ordem importa: primeiro negrito
// (**), senão o passo do itálico (*) capturaria um dos asteriscos do negrito.
function converterFormatacaoInline(linha: string) {
  return linha
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<u>$1</u>')
}
// Fonte única: gera, linha por linha, o HTML final (já com <strong> nos
// títulos fixos e as marcações manuais convertidas) — usado tanto no preview
// da tela quanto no envio real pro MedX, pra garantir que nunca fiquem
// diferentes um do outro.
function linhasFormatadasParaMedx(texto: string): string[] {
  const escapado = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escapado.split('\n').map(linha => {
    const ehTitulo = ehLinhaTitulo(linha)
    const linhaFormatada = converterFormatacaoInline(linha)
    return ehTitulo ? `<strong>${linhaFormatada}</strong>` : linhaFormatada
  })
}
// v46.96 — a revisão do resumo deixou de ter caixa de texto + prévia
// separadas: agora é um único campo editável (contentEditable) onde o
// negrito/itálico/sublinhado já aparecem de verdade, direto no texto, tanto
// nos títulos automáticos quanto no que a pessoa marcar na mão pelos botões
// da barra. Isso monta o HTML inicial desse campo (títulos já em negrito).
function resumoParaHtmlInicial(texto: string) {
  return linhasFormatadasParaMedx(texto).join('<br>')
}
// Depois que a pessoa edita direto no campo (negrito/itálico/sublinhado via
// document.execCommand, que o navegador aplica com <b>/<i>/<u> e pode quebrar
// linha com <div>), normaliza pro mesmo formato que o MedX já esperava
// (<strong>/<em>/<u>, quebras de linha com <br>, tudo dentro de um <p>) antes
// de gravar na Área Evolução.
function limparHtmlParaMedx(htmlBruto: string): string {
  const normalizado = htmlBruto
    .replace(/<div>/gi, '<br>')
    .replace(/<\/div>/gi, '')
    .replace(/<b>/gi, '<strong>')
    .replace(/<\/b>/gi, '</strong>')
    .replace(/<i>/gi, '<em>')
    .replace(/<\/i>/gi, '</em>')
    .replace(/^(<br>)+/, '')
  return `<p>${normalizado}</p>`
}

// v48.174 — "Prontuário" deixou de ser aba própria (ficava espremida ao lado
// de "Anexos" na fileira de abas) e virou um submenu dentro de "MedX" — ver
// MedXTab mais abaixo.
type Tab = 'data' | 'attachments' | 'scheduled' | 'medx' | 'recibos'

type Props = {
  contact: Contact
  messages: Message[]
  sectors?: Sector[]
  agentSectorIds?: string[]
  onClose: () => void
  onSaved: (updated: Contact) => void
  onReloadMessages?: () => void
  initialTab?: Tab
  openSchedule?: boolean
  openRetorno?: boolean
}

export default function ConversationSidePanel({ contact, messages, sectors = [], agentSectorIds = [], onClose, onSaved, onReloadMessages, initialTab = 'data', openSchedule = false, openRetorno = false }: Props) {
  const { agent } = useAuth()
  const [tab, setTab] = useState<Tab>(initialTab)
  // v48.157 — Pedido do Jorge: a cor por quem enviou (v48.137) não estava
  // chamando atenção o suficiente pra bater o olho e saber de quem é cada
  // anexo. Em vez de insistir na cor, dois submenus — igual já existe em
  // Agendadas (ativas/enviadas) — separam fisicamente o que o paciente
  // mandou do que a equipe/Sofia mandou. O rótulo colorido por item continua
  // (ainda ajuda a saber QUEM da equipe, dentro de "Enviadas").
  const [subAbaAnexos, setSubAbaAnexos] = useState<'recebidas' | 'enviadas'>('recebidas')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [medxBuscando, setMedxBuscando] = useState(false)
  const [medxNaoEncontrado, setMedxNaoEncontrado] = useState(false)
  const [medxGravando, setMedxGravando] = useState(false)
  const [medxResultado, setMedxResultado] = useState<{ ok: boolean; text: string } | null>(null)
  // v48.51 — O cadastro do Atendimento passa a ter tudo o que o cadastro da
  // tela de Contatos tem: convênio, status, Sofia, bloqueio por canal, CEP.
  const assistantName = useAiAssistantName()
  const [convenios, setConvenios] = useState<{ id: string; nome: string }[]>([])
  const [planos, setPlanos] = useState<{ id: string; convenio_id: string; nome: string }[]>([])
  const [mudandoCanal, setMudandoCanal] = useState<CanalBloqueio | null>(null)
  const [erroCanal, setErroCanal] = useState('')

  useEffect(() => {
    supabase.from('cirurgia_convenios').select('id, nome').eq('ativo', true).order('ordem')
      .then(({ data }) => setConvenios((data ?? []) as any[]))
    supabase.from('cirurgia_planos').select('id, convenio_id, nome').eq('ativo', true).order('ordem')
      .then(({ data }) => setPlanos((data ?? []) as any[]))
  }, [])

  // Bloqueio de UM canal, na hora, sem passar pelo "Editar cadastro": é uma
  // ação, não um dado do formulário. A regra é a mesma de lib/bloqueio.ts.
  async function alternarCanal(canal: CanalBloqueio) {
    if (!agent) return
    const bloqueado = canaisBloqueados(contact).includes(canal)
    if (!bloqueado && !window.confirm(`Bloquear ${NOME_DO_CANAL[canal]} de ${contact.full_name || 'este contato'}?\n\nNenhuma mensagem sai nem entra como atendimento por esse canal até desbloquear.`)) return
    setMudandoCanal(canal); setErroCanal('')
    const { erro } = bloqueado
      ? await desbloquearContato(contact, agent, [canal])
      : await bloquearContato(contact, agent, [canal])
    setMudandoCanal(null)
    if (erro) { setErroCanal(erro); return }
    const { data } = await supabase.from('contacts').select('*').eq('id', contact.id).single()
    if (data) onSaved(data as Contact)
  }

  // Campos espelhados do cadastro MedX. cpf ja e uma coluna nativa do
  // contato; os demais ficam guardados em custom_fields.dados_medx (nao
  // existe uma coluna propria pra eles no Supabase).
  function formFromContact(c: Contact) {
    const dm = c.custom_fields?.dados_medx || {}
    return {
      full_name: c.full_name || '',
      phone: c.phone || '',
      email: c.email || '',
      source: c.source || '',
      notes: c.notes || '',
      tags: c.tags || [],
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
      patient_status: (c as any).patient_status || 'novo',
      sofia_paused: c.custom_fields?.sofia_never_respond === true,
      convenio_id: (c as any).convenio_id || '',
      plano_id: (c as any).plano_id || '',
      carteirinha: (c as any).carteirinha || '',
      carteirinha_nome: (c as any).carteirinha_nome || '',
      carteirinha_validade: (c as any).carteirinha_validade || '',
    }
  }

  const [form, setForm] = useState(formFromContact(contact))

  useEffect(() => {
    setForm(formFromContact(contact))
    setEditing(false)
  }, [contact.id])

  // Busca automática e silenciosa no MedX ao abrir o atendimento de um paciente
  // com cadastro incompleto (sem esperar o usuário clicar na aba "MedX" ou no
  // botão "Buscar no MedX") - assim quem abre a aba "Dados" direto já vê os
  // dados do MedX preenchidos, sem precisar buscar manualmente.
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
        if (pac.cep && !dmNovo.cep) dmNovo.cep = String(pac.cep)
        if (pac.complemento && !dmNovo.complemento) dmNovo.complemento = pac.complemento
        if (pac.numero && !dmNovo.numero) dmNovo.numero = pac.numero
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
        // Silencioso: se falhar, o usuário ainda pode buscar manualmente pelo botão.
      }
    }
    autoBuscarNoMedx()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id])

  const attachments = useMemo(
    () => messages
      .filter(m => m.media_type && m.media_type !== 'audio')
      .filter(m => canReadPrivateMessage(m, contact.sector_id, sectors, agentSectorIds))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [messages, contact.sector_id, sectors, agentSectorIds]
  )
  // v48.157 — Recebidas: o paciente mandou (direction inbound). Enviadas:
  // saiu da clínica, seja atendente identificado ou a IA (outbound).
  const attachmentsRecebidas = useMemo(() => attachments.filter(m => m.direction === 'inbound'), [attachments])
  const attachmentsEnviadas = useMemo(() => attachments.filter(m => m.direction !== 'inbound'), [attachments])
  const attachmentsDaSubAba = subAbaAnexos === 'recebidas' ? attachmentsRecebidas : attachmentsEnviadas

  function automaticMedxMark(file: Message) {
    const start = new Date(file.created_at).getTime()
    const nextFile = messages
      .filter(m => m.id !== file.id && m.direction === 'inbound' && m.media_url && new Date(m.created_at).getTime() > start)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
    const end = nextFile ? new Date(nextFile.created_at).getTime() : start + 15 * 60 * 1000
    const confirmation = messages.find(m => {
      const at = new Date(m.created_at).getTime()
      return m.direction === 'outbound' && !m.sender_id && at >= start && at < end && /anex(ei|ado|ada|amos)|prontu[aá]rio/i.test(m.content || '')
    })
    return confirmation ? { attached: true, attached_by: 'Sofia', source: 'sofia_auto', attached_at: confirmation.created_at } : null
  }

  // Canal da mensagem mais recente — em vez do canal fixo de quando o
  // contato foi criado, que pode não refletir mais por onde a conversa
  // está indo (ex: contato criado via WhatsApp que passou a falar por Instagram).
  // Ignora notas internas ("[INTERNO] ..."): elas sempre gravam channel:
  // 'whatsapp' independente do canal real da conversa.
  const lastMsgChannel = useMemo(() => {
    const real = messages.filter(m => !m.content?.startsWith('[INTERNO]'))
    if (!real.length) return contact.custom_fields?.channel ?? null
    return real.reduce((latest, m) => new Date(m.created_at) > new Date(latest.created_at) ? m : latest, real[0]).channel
  }, [messages, contact.custom_fields?.channel])

  function addTag() {
    const t = tagInput.trim()
    if (!t || form.tags.includes(t)) { setTagInput(''); return }
    setForm(f => ({ ...f, tags: [...f.tags, t] }))
    setTagInput('')
  }

  function removeTag(tag: string) {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }))
  }

  async function handleSave() {
    if (!form.full_name.trim()) { setError('O nome é obrigatório.'); return }
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
        cpf: form.cpf.trim() || null,
        patient_status: form.patient_status,
        convenio_id: form.convenio_id || null,
        plano_id: form.plano_id || null,
        carteirinha: form.carteirinha.trim() || null,
        carteirinha_nome: form.carteirinha_nome.trim() || null,
        carteirinha_validade: form.carteirinha_validade || null,
        sofia_paused: form.sofia_paused,
        custom_fields: { ...(contact.custom_fields || {}), dados_medx: dadosMedx, sofia_never_respond: form.sofia_paused },
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
      .select()
      .single()

    setSaving(false)
    if (err) { setError('Não foi possível salvar. Tente novamente.'); return }
    onSaved(data as Contact)
    setEditing(false)

    // Se o paciente ja tem cadastro no MedX, sincroniza silenciosamente as
    // mudancas de volta pra la (nao bloqueia a UI, nao mostra erro se falhar
    // - o proprio salvar no CRM ja e a confirmacao pro usuario).
    if ((data as Contact)?.medx_id) {
      fetch(WH_SYNC_MEDX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contact.id }),
      }).catch(() => {})
    }
  }

  function handleCancelEdit() {
    setForm(formFromContact(contact))
    setError('')
    setEditing(false)
  }

  // Busca o paciente no MedX (por nome/telefone/cpf ja digitados no form) e
  // preenche os campos do cadastro que ainda estiverem vazios - assim quem
  // esta preenchendo o cadastro no atendimento nao precisa perguntar de novo
  // pro paciente dados que o MedX ja tem.
  async function buscarNoMedxDados() {
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
          cep: f.cep.trim() || (pac.cep ? String(pac.cep) : ''),
          numero: f.numero.trim() || pac.numero || '',
          complemento: f.complemento.trim() || pac.complemento || '',
          bairro: f.bairro.trim() || pac.bairro || '',
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
    if (contact.medx_id) {
      setMedxResultado({ ok: false, text: `Paciente já vinculado ao MedX (ID ${contact.medx_id}).` })
      return
    }
    const payload = {
      contact_id: contact.id, nome: form.full_name.trim(), nome_social: form.nome_social.trim(),
      sexo: form.sexo, nascimento: form.nascimento, cpf: form.cpf.trim(), celular: form.phone.trim(),
      cep: form.cep.trim(), complemento: form.complemento.trim(),
      endereco_residencial: form.endereco_residencial.trim(), numero: form.numero.trim(),
      bairro: form.bairro.trim(), cidade: form.cidade.trim(), estado: form.estado, email: form.email.trim(),
    }
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
    } catch (e: any) {
      setMedxResultado({ ok: false, text: e?.message || 'Não foi possível gravar no MedX.' })
    } finally { setMedxGravando(false) }
  }

  function mediaIcon(type: string | null) {
    if (type === 'image') return <ImageIcon size={16}/>
    if (type === 'audio') return <Music size={16}/>
    if (type === 'video') return <Video size={16}/>
    return <FileIcon size={16}/>
  }

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} className="fixed inset-0 bg-slate-900/20 z-40"/>

      {/* Painel */}
      <div className="fixed top-0 right-0 h-screen w-[380px] bg-white shadow-2xl z-50 flex flex-col border-l border-slate-100 animate-slide-in">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <ContactAvatar avatarUrl={contact.avatar_url} name={contact.full_name} id={contact.id} sizeClass="w-10 h-10" textClass="text-sm"/>
              <ChannelBadge channel={lastMsgChannel} accountName={contact.custom_fields?.ig_account_name} size={14}/>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{contact.full_name || 'Sem nome'}</p>
              <p className="text-xs text-slate-400 truncate">
                {lastMsgChannel === 'instagram' && contact.phone?.startsWith('ig:')
                  ? `Instagram${contact.custom_fields?.ig_account_name ? ' · ' + contact.custom_fields.ig_account_name : ''}`
                  : (contact.phone || 'Sem telefone')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors flex-shrink-0">
            <X size={18}/>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 flex-shrink-0">
          <TabButton active={tab === 'data'} onClick={() => setTab('data')} label="Dados"/>
          <TabButton active={tab === 'medx'} onClick={() => setTab('medx')} label="MedX"/>
          <TabButton active={tab === 'attachments'} onClick={() => setTab('attachments')} label="Anexos" badge={attachments.length}/>
          <TabButton active={tab === 'scheduled'} onClick={() => setTab('scheduled')} label="Agendadas"/>
          <TabButton active={tab === 'recibos'} onClick={() => setTab('recibos')} label="Recibos"/>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'data' && (
            <div className="px-5 py-5 space-y-5">
              <div className="flex justify-end">
                {!editing ? (
                  <button
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700">
                    <Pencil size={12}/> Editar cadastro
                  </button>
                ) : (
                  <span className="text-xs font-medium text-slate-400">Editando cadastro</span>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
                  {error}
                </div>
              )}

              <Field icon={<UserIcon size={13}/>} label="Nome do paciente">
                {editing ? (
                  <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className="field-input"/>
                ) : <p className="text-sm text-slate-700">{contact.full_name || '—'}</p>}
              </Field>

              <Field icon={<Phone size={13}/>} label="Telefone">
                {editing ? (
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="field-input"/>
                ) : <p className="text-sm text-slate-700">{contact.phone || '—'}</p>}
              </Field>

              <Field icon={<Mail size={13}/>} label="Email">
                {editing ? (
                  <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="field-input"/>
                ) : <p className="text-sm text-slate-700">{contact.email || '—'}</p>}
              </Field>

              <Field icon={<Globe size={13}/>} label="Origem">
                {editing ? (
                  <input value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className="field-input"/>
                ) : <p className="text-sm text-slate-700 capitalize">{contact.source || '—'}</p>}
              </Field>

              <div className="pt-1 border-t border-slate-100">
                <div className="flex items-center justify-between mb-4 mt-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Stethoscope size={12}/> Cadastro (dados MedX)
                  </p>
                  {editing && (
                    <button
                      type="button"
                      onClick={buscarNoMedxDados}
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
                  <Field icon={<CreditCard size={13}/>} label="CPF">
                    {editing ? (
                      <input value={form.cpf} onChange={e => setForm(f => ({ ...f, cpf: e.target.value }))} className="field-input"/>
                    ) : <p className="text-sm text-slate-700">{(contact as any).cpf || '—'}</p>}
                  </Field>

                  <Field icon={<UserIcon size={13}/>} label="Nome social">
                    {editing ? (
                      <input value={form.nome_social} onChange={e => setForm(f => ({ ...f, nome_social: e.target.value }))} className="field-input"/>
                    ) : <p className="text-sm text-slate-700">{contact.custom_fields?.dados_medx?.nome_social || '—'}</p>}
                  </Field>

                  <Field icon={<UserIcon size={13}/>} label="Sexo">
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

                  <Field icon={<Calendar size={13}/>} label="Data de nascimento">
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

                  <Field icon={<MapPin size={13}/>} label="CEP">
                    {editing ? (
                      <CampoCep value={form.cep} onChange={cep => setForm(f => ({ ...f, cep }))}
                        onEndereco={e => setForm(f => ({ ...f, endereco_residencial: e.logradouro || f.endereco_residencial, bairro: e.bairro || f.bairro, cidade: e.cidade || f.cidade, estado: e.uf || f.estado }))}/>
                    ) : <p className="text-sm text-slate-700">{contact.custom_fields?.dados_medx?.cep || '—'}</p>}
                  </Field>

                  <Field icon={<MapPin size={13}/>} label="Endereço">
                    {editing ? (
                      <input value={form.endereco_residencial} onChange={e => setForm(f => ({ ...f, endereco_residencial: e.target.value }))}
                        className="field-input" placeholder="Rua, Avenida..."/>
                    ) : <p className="text-sm text-slate-700">{contact.custom_fields?.dados_medx?.endereco_residencial || '—'}</p>}
                  </Field>

                  <Field icon={<Hash size={13}/>} label="Número">
                    {editing ? (
                      <input value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} className="field-input"/>
                    ) : <p className="text-sm text-slate-700">{contact.custom_fields?.dados_medx?.numero || '—'}</p>}
                  </Field>

                  <Field icon={<Hash size={13}/>} label="Complemento">
                    {editing ? (
                      <input value={form.complemento} onChange={e => setForm(f => ({ ...f, complemento: e.target.value }))} className="field-input" placeholder="Apto, bloco..."/>
                    ) : <p className="text-sm text-slate-700">{contact.custom_fields?.dados_medx?.complemento || '—'}</p>}
                  </Field>

                  <Field icon={<MapPin size={13}/>} label="Bairro">
                    {editing ? (
                      <input value={form.bairro} onChange={e => setForm(f => ({ ...f, bairro: e.target.value }))} className="field-input"/>
                    ) : <p className="text-sm text-slate-700">{contact.custom_fields?.dados_medx?.bairro || '—'}</p>}
                  </Field>

                  <Field icon={<MapPin size={13}/>} label="Cidade">
                    {editing ? (
                      <input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} className="field-input"/>
                    ) : <p className="text-sm text-slate-700">{contact.custom_fields?.dados_medx?.cidade || '—'}</p>}
                  </Field>

                  <Field icon={<MapPin size={13}/>} label="Estado (UF)">
                    {editing ? (
                      <input value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value.toUpperCase().slice(0, 2) }))}
                        maxLength={2} className="field-input" placeholder="SP"/>
                    ) : <p className="text-sm text-slate-700">{contact.custom_fields?.dados_medx?.estado || '—'}</p>}
                  </Field>

                  {editing && contact.medx_id && (
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <RefreshCw size={11}/> Ao salvar, esses dados são sincronizados automaticamente com o cadastro no MedX.
                    </p>
                  )}
                  {editing && (
                    <div className="space-y-2 pt-2">
                      {medxResultado && (
                        <div className={clsx('flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs', medxResultado.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700')}>
                          {medxResultado.ok ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0"/> : <AlertCircle size={13} className="mt-0.5 flex-shrink-0"/>}
                          {medxResultado.text}
                        </div>
                      )}
                      <button type="button" onClick={gravarNoMedx} disabled={medxGravando || !!contact.medx_id}
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-500 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                        {medxGravando ? <Loader2 size={14} className="animate-spin"/> : <Stethoscope size={14}/>}
                        {contact.medx_id ? `Já vinculado ao MedX — ID ${contact.medx_id}` : medxGravando ? 'Gravando e confirmando...' : 'Gravar no MedX'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <Field icon={<TagIcon size={13}/>} label="Tags">
                {editing ? (
                  <div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {form.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-brand-50 text-brand-700 rounded-full">
                          {tag}
                          <button onClick={() => removeTag(tag)} className="hover:text-brand-900"><X size={10}/></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                        placeholder="Nova tag" className="field-input flex-1"/>
                      <button onClick={addTag} className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600">
                        <Plus size={13}/>
                      </button>
                    </div>
                  </div>
                ) : contact.tags && contact.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {contact.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 text-xs font-medium bg-brand-50 text-brand-700 rounded-full">{tag}</span>
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-400">Nenhuma tag</p>}
              </Field>

              <Field icon={<CreditCard size={13}/>} label="Convênio">
                {editing ? (
                  <div className="space-y-2">
                    <select value={form.convenio_id}
                      onChange={e => setForm(f => ({ ...f, convenio_id: e.target.value, plano_id: '' }))} className="field-input">
                      <option value="">Particular (sem convênio)</option>
                      {convenios.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                    {form.convenio_id && (
                      <>
                        <select value={form.plano_id} onChange={e => setForm(f => ({ ...f, plano_id: e.target.value }))} className="field-input">
                          <option value="">Sem plano específico</option>
                          {planos.filter(p => p.convenio_id === form.convenio_id).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                        </select>
                        <input value={form.carteirinha} onChange={e => setForm(f => ({ ...f, carteirinha: e.target.value }))}
                          placeholder="Número da carteirinha" className="field-input"/>
                        <input value={form.carteirinha_nome} onChange={e => setForm(f => ({ ...f, carteirinha_nome: e.target.value }))}
                          placeholder="Nome como está na carteirinha" className="field-input"/>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Validade da carteirinha</label>
                          <input type="date" value={form.carteirinha_validade}
                            onChange={e => setForm(f => ({ ...f, carteirinha_validade: e.target.value }))} className="field-input"/>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-slate-700">
                    {(contact as any).convenio_id ? (
                      <>
                        <p>
                          {convenios.find(c => c.id === (contact as any).convenio_id)?.nome || 'Convênio'}
                          {(contact as any).plano_id ? ` · ${planos.find(p => p.id === (contact as any).plano_id)?.nome ?? ''}` : ''}
                        </p>
                        {(contact as any).carteirinha && <p className="text-xs text-slate-500 mt-0.5">Carteirinha {(contact as any).carteirinha}</p>}
                        {(contact as any).carteirinha_nome && <p className="text-xs text-slate-500">Em nome de {(contact as any).carteirinha_nome}</p>}
                        {(contact as any).carteirinha_validade && (
                          <p className={'text-xs mt-0.5 ' + ((contact as any).carteirinha_validade < new Date().toISOString().slice(0, 10) ? 'text-red-600 font-semibold' : 'text-slate-500')}>
                            Válida até {String((contact as any).carteirinha_validade).split('-').reverse().join('/')}
                            {(contact as any).carteirinha_validade < new Date().toISOString().slice(0, 10) ? ' — vencida' : ''}
                          </p>
                        )}
                      </>
                    ) : <p className="text-slate-400">Particular</p>}
                  </div>
                )}
              </Field>

              <Field icon={<Activity size={13}/>} label="Status do paciente">
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
                  <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', statusConfig((contact as any).patient_status).bg, statusConfig((contact as any).patient_status).text)}>
                    <span className={clsx('w-2 h-2 rounded-full', statusConfig((contact as any).patient_status).dot)}/>
                    {statusConfig((contact as any).patient_status).label}
                  </span>
                )}
              </Field>

              <Field icon={<Activity size={13}/>} label={`Atendimento da ${assistantName}`}>
                {editing ? (
                  <label className="flex items-start gap-3 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
                    <input type="checkbox" checked={form.sofia_paused}
                      onChange={e => setForm(f => ({ ...f, sofia_paused: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 rounded border-amber-300 text-brand-600 focus:ring-brand-500"/>
                    <span>
                      <span className="block text-sm font-medium text-amber-900">{assistantName} não atende este paciente</span>
                      <span className="block text-xs text-amber-700 mt-0.5">Vale para todos os canais. Tem prioridade sobre a configuração geral.</span>
                    </span>
                  </label>
                ) : (
                  <span className={clsx('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
                    contact.custom_fields?.sofia_never_respond ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700')}>
                    {contact.custom_fields?.sofia_never_respond ? `${assistantName} não atende` : `${assistantName} pode atender`}
                  </span>
                )}
              </Field>

              <Field icon={<Ban size={13}/>} label="Bloqueio por canal">
                <div className="space-y-1.5">
                  {canaisDoContato(contact).map(canal => {
                    const bloq = canaisBloqueados(contact).includes(canal)
                    return (
                      <div key={canal} className={clsx('flex items-center justify-between gap-2 px-3 py-2 rounded-lg border',
                        bloq ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200')}>
                        <span className="flex items-center gap-2 text-sm text-slate-700">
                          {canal === 'instagram' ? <InstagramIcon size={14}/> : <Phone size={14}/>}
                          {NOME_DO_CANAL[canal]}
                          <span className={clsx('text-[11px] font-semibold', bloq ? 'text-red-600' : 'text-emerald-600')}>
                            {bloq ? 'bloqueado' : 'liberado'}
                          </span>
                        </span>
                        <button type="button" onClick={() => alternarCanal(canal)} disabled={!!mudandoCanal}
                          className={clsx('flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold disabled:opacity-50',
                            bloq ? 'bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'bg-white border border-red-300 text-red-700 hover:bg-red-50')}>
                          {mudandoCanal === canal ? <Loader2 size={11} className="animate-spin"/> : bloq ? <ShieldCheck size={11}/> : <Ban size={11}/>}
                          {bloq ? 'Desbloquear' : 'Bloquear'}
                        </button>
                      </div>
                    )
                  })}
                  {erroCanal && <p className="text-xs text-red-600">{erroCanal}</p>}
                  <p className="text-[11px] text-slate-400">Muda na hora, sem precisar salvar o cadastro.</p>
                </div>
              </Field>

              <Field icon={<Users size={13}/>} label="Cadastro duplicado">
                <div className="space-y-3">
                  <InstagramVinculados contato={contact}/>
                  <UnirCadastros contato={contact} aoUnir={onClose}/>
                </div>
              </Field>

              <Field icon={<FileText size={13}/>} label="Notas internas">
                {editing ? (
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={4} className="field-input resize-none"/>
                ) : <p className="text-sm text-slate-700 whitespace-pre-wrap">{contact.notes || '—'}</p>}
              </Field>

              <Field icon={<Calendar size={13}/>} label="Último contato">
                <p className="text-sm text-slate-700">
                  {contact.last_contacted_at
                    ? format(new Date(contact.last_contacted_at), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })
                    : 'Nunca'}
                </p>
              </Field>

              {editing && (
                <div className="flex items-center gap-2 pt-2">
                  <button onClick={handleCancelEdit} disabled={saving}
                    className="flex-1 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                    Cancelar
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="flex-1 px-3 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
                    {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
                    Salvar
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'attachments' && (
            <div className="px-5 py-5">
              {attachments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-3">
                    <FileIcon size={20} className="text-slate-400"/>
                  </div>
                  <p className="text-sm text-slate-500">Nenhum arquivo nesta conversa</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* v48.157 — Submenu Recebidas/Enviadas, em vez de confiar só
                      na cor do rótulo pra bater o olho e saber de quem é cada
                      anexo. */}
                  <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                    <button onClick={() => setSubAbaAnexos('recebidas')}
                      className={clsx('flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
                        subAbaAnexos === 'recebidas' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                      Recebidas {attachmentsRecebidas.length > 0 && `(${attachmentsRecebidas.length})`}
                    </button>
                    <button onClick={() => setSubAbaAnexos('enviadas')}
                      className={clsx('flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
                        subAbaAnexos === 'enviadas' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                      Enviadas {attachmentsEnviadas.length > 0 && `(${attachmentsEnviadas.length})`}
                    </button>
                  </div>
                  {/* Botão apagar tudo — continua valendo pra TODOS os anexos,
                      não só a sub-aba aberta, pra não dar a entender que
                      "apagar tudo" apagaria metade só. */}
                  <DeleteAllButton attachments={attachments} onDeleted={() => {
                    onReloadMessages?.()
                  }}/>
                  {attachmentsDaSubAba.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">
                      {subAbaAnexos === 'recebidas' ? 'Nenhum arquivo recebido do paciente.' : 'Nenhum arquivo enviado pela clínica.'}
                    </p>
                  ) : attachmentsDaSubAba.map(m => (
                    <AttachmentItem key={m.id} message={m} contact={contact} agentName={agent?.name || 'Usuário do CRM'} assistantName={assistantName} automaticMark={automaticMedxMark(m)} onDeleted={() => onReloadMessages?.()}/>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'medx' && <MedXTab key={contact.id} contact={contact} onSaved={onSaved} openSchedule={openSchedule} openRetorno={openRetorno}/>}

          {tab === 'scheduled' && <ScheduledTab contact={contact}/>}

          {tab === 'recibos' && <RecibosTab key={contact.id} contactId={contact.id}/>}
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
        .field-input:focus { outline: none; border-color: transparent; box-shadow: 0 0 0 2px #0c8ee7; }
        @keyframes slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in { animation: slide-in 0.2s ease-out; }
      `}</style>
    </>
  )
}

function DeleteAllButton({ attachments, onDeleted }: { attachments: Message[], onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDeleteAll() {
    setDeleting(true)
    for (const m of attachments) {
      if (m.media_url) {
        let bucket = 'conversation-media'
        let path = ''
        if (m.media_url.includes('/conversation-media/')) {
          path = m.media_url.split('/conversation-media/')[1]?.split('?')[0]
        } else if (m.media_url.includes('/whatsapp-media/')) {
          bucket = 'whatsapp-media'
          path = m.media_url.split('/whatsapp-media/')[1]?.split('?')[0]
        }
        if (path) { try { await supabase.storage.from(bucket).remove([path]) } catch {} }
      }
      await supabase.from('messages').delete().eq('id', m.id)
    }
    setDeleting(false)
    setConfirm(false)
    onDeleted()
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
        <AlertTriangle size={13} className="text-red-500 flex-shrink-0"/>
        <span className="text-xs text-red-700 flex-1">Apagar {attachments.length} arquivo(s)?</span>
        <button onClick={() => setConfirm(false)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Não</button>
        <button onClick={handleDeleteAll} disabled={deleting}
          className="text-xs text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50">
          {deleting ? <Loader2 size={10} className="animate-spin"/> : <Trash2 size={10}/>}
          Apagar tudo
        </button>
      </div>
    )
  }

  return (
    <button onClick={() => setConfirm(true)}
      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 border border-dashed border-red-200 rounded-lg transition-colors">
      <Trash2 size={12}/> Apagar todos os arquivos ({attachments.length})
    </button>
  )
}

function AttachmentItem({ message, contact, agentName, assistantName, automaticMark, onDeleted }: { message: Message; contact: Contact; agentName: string; assistantName: string; automaticMark: any; onDeleted: () => void }) {
  // v48.137 — Pedido do Jorge: destacar diferente o que o paciente mandou do
  // que a equipe mandou (identificando quem). Mesmo critério já usado acima
  // (automaticMedxMark): sem sender_id em mensagem outbound é a IA.
  // assistantName vem por prop (não chama useAiAssistantName() aqui) porque
  // este componente é instanciado uma vez POR ANEXO — chamar o hook aqui
  // abriria um canal realtime novo por anexo na tela, à toa.
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(message.content || message.media_type || 'Arquivo')
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [showMedx, setShowMedx] = useState(false)
  const [medxType, setMedxType] = useState<'exame' | 'documento'>('exame')
  const [medxName, setMedxName] = useState('')
  const [sendingMedx, setSendingMedx] = useState(false)
  const [medxResult, setMedxResult] = useState<{ ok: boolean; text: string } | null>(null)
  const initialMedxMark = (message as any).raw_payload?.medx_attachment || automaticMark
  const [medxMark, setMedxMark] = useState<any>(initialMedxMark?.attached === true ? initialMedxMark : null)
  const [confirmResend, setConfirmResend] = useState(false)

  // v46.88: resumo de exame por IA, só quando a equipe clica em "Analisar" —
  // nunca automático. O resumo fica editável antes de ir pro MedX (por
  // enquanto, copiado manualmente; assim que soubermos o endpoint exato de
  // anotação do MedX, isso vira um envio automático).
  const [analisando, setAnalisando] = useState(false)
  const [resumoIA, setResumoIA] = useState<string | null>(null)
  const [resumoVersion, setResumoVersion] = useState(0)
  const [analiseError, setAnaliseError] = useState('')
  const [copiadoResumo, setCopiadoResumo] = useState(false)
  const [enviandoAnotacao, setEnviandoAnotacao] = useState(false)
  const [anotacaoResult, setAnotacaoResult] = useState<{ ok: boolean; text: string } | null>(null)
  const resumoEditRef = useRef<HTMLDivElement>(null)

  // Botões B/I/S da revisão: aplica a formatação de verdade, na hora, em
  // cima do trecho selecionado — clicar de novo no mesmo trecho já em
  // negrito/itálico/sublinhado remove a formatação (o navegador já cuida
  // desse alterna automaticamente). O onMouseDown com preventDefault nos
  // botões é pra não perder a seleção de texto ao clicar neles.
  function aplicarFormatacaoResumo(comando: 'bold' | 'italic' | 'underline') {
    const el = resumoEditRef.current
    if (!el) return
    el.focus()
    document.execCommand(comando, false)
  }

  // v46.97: o conteúdo inicial do campo editável precisa ser escrito no DOM só
  // UMA VEZ (quando um resumo novo chega/é regenerado — daí depender de
  // `resumoVersion`, não de `resumoIA`). Antes isso era feito via
  // `dangerouslySetInnerHTML` direto no JSX, mas qualquer re-render do
  // AttachmentItem (ex: o pai recalculando `automaticMark` a cada render)
  // corria o risco de o React reaplicar o HTML original por cima do que a
  // pessoa acabou de digitar, apagando a edição na tela. Escrevendo o HTML
  // manualmente aqui, fora do ciclo de render do React, o campo só é tocado
  // quando queremos (resumo novo) e nunca mais depois disso.
  useEffect(() => {
    const el = resumoEditRef.current
    if (el && resumoIA !== null) {
      el.innerHTML = resumoParaHtmlInicial(resumoIA)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumoVersion])

  async function handleAnalisarExame() {
    if (!message.media_url) return
    setAnalisando(true); setAnaliseError(''); setResumoIA(null)
    try {
      const res = await fetch('/api/interpretar-exame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_url: message.media_url }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Não foi possível analisar o exame.')
      setResumoIA(json.summary || '')
      setResumoVersion(v => v + 1)
    } catch (e: any) {
      setAnaliseError(e?.message || 'Não foi possível analisar o exame.')
    } finally {
      setAnalisando(false)
    }
  }

  async function handleCopiarResumo() {
    const el = resumoEditRef.current
    if (!el) return
    try {
      await navigator.clipboard.writeText(el.innerText)
      setCopiadoResumo(true)
      setTimeout(() => setCopiadoResumo(false), 2000)
    } catch {
      setAnaliseError('Não foi possível copiar automaticamente — selecione e copie o texto manualmente.')
    }
  }

  async function handleEnviarAnotacaoMedx() {
    const el = resumoEditRef.current
    if (!el || !contact.medx_id) return
    setEnviandoAnotacao(true)
    setAnotacaoResult(null)
    try {
      const res = await fetch(WH_ENVIAR_ANOTACAO_MEDX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_do_cliente: contact.medx_id,
          historico: limparHtmlParaMedx(el.innerHTML),
        }),
      })
      const rawResponse = await res.text()
      let json: any = rawResponse
      for (let i = 0; i < 2 && typeof json === 'string'; i++) {
        try { json = JSON.parse(json) } catch { break }
      }
      const explicitlyFailed = json?.success === false || json?.success === 'false'
      if (!res.ok || explicitlyFailed) throw new Error(json?.message || 'Não foi possível gravar a anotação no MedX.')
      setAnotacaoResult({ ok: true, text: 'Anotação gravada na Área Evolução do MedX.' })
    } catch (e: any) {
      setAnotacaoResult({ ok: false, text: e?.message || 'Não foi possível gravar a anotação no MedX. Copie o texto e cole manualmente.' })
    } finally {
      setEnviandoAnotacao(false)
    }
  }

  function mediaIcon(type: string | null) {
    if (type === 'image') return <ImageIcon size={16}/>
    if (type === 'audio') return <Music size={16}/>
    if (type === 'video') return <Video size={16}/>
    return <FileIcon size={16}/>
  }

  async function handleDelete() {
    setDeleting(true)
    // Remove do storage — detecta o bucket pela URL
    if (message.media_url) {
      let bucket = 'conversation-media'
      let path = ''
      if (message.media_url.includes('/conversation-media/')) {
        bucket = 'conversation-media'
        path = message.media_url.split('/conversation-media/')[1]?.split('?')[0]
      } else if (message.media_url.includes('/whatsapp-media/')) {
        bucket = 'whatsapp-media'
        path = message.media_url.split('/whatsapp-media/')[1]?.split('?')[0]
      }
      if (path) {
        try { await supabase.storage.from(bucket).remove([path]) } catch (e) { console.error(e) }
      }
    }
    // Apaga a mensagem inteira (não só a URL)
    const { error } = await supabase.from('messages').delete().eq('id', message.id)
    if (error) { console.error('Erro ao apagar:', error); setDeleting(false); return }
    setDeleting(false)
    setConfirmDel(false)
    onDeleted()
  }

  async function handleSendToMedx() {
    if (!message.media_url || !contact.medx_id || !medxName.trim()) return
    setSendingMedx(true)
    setMedxResult(null)
    try {
      const endpoint = medxType === 'exame' ? WH_ANEXAR_EXAME_MEDX : WH_ANEXAR_DOCUMENTO_MEDX
      const descricao = `${medxName.trim()} - Adicionado por ${agentName}`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_do_cliente: contact.medx_id,
          descricao,
          media_url: message.media_url,
          telefone: contact.phone || '',
        }),
      })
      const rawResponse = await res.text()
      let json: any = rawResponse
      // O Respond to Webhook do n8n pode devolver o JSON já convertido em texto.
      // Desembrulha até duas camadas, mas só aceita sucesso explicitamente confirmado.
      for (let i = 0; i < 2 && typeof json === 'string'; i++) {
        try { json = JSON.parse(json) } catch { break }
      }
      const explicitlyFailed = json?.success === false || json?.success === 'false'
      if (!res.ok || explicitlyFailed) throw new Error(json?.message || 'Não foi possível anexar no MedX.')
      const mark = {
        attached: true,
        type: medxType,
        description: descricao,
        attached_by: agentName,
        source: 'crm_manual',
        attached_at: new Date().toISOString(),
      }
      const previousRaw = (message as any).raw_payload || {}
      const { error: markError } = await supabase.from('messages').update({
        raw_payload: { ...previousRaw, medx_attachment: mark },
      }).eq('id', message.id)
      if (markError) throw new Error('O arquivo foi anexado, mas não foi possível salvar a marcação no CRM.')
      setMedxMark(mark)
      setConfirmResend(false)
      setMedxResult({ ok: true, text: medxType === 'exame' ? 'Exame anexado com sucesso.' : 'Documento anexado com sucesso.' })
    } catch (e: any) {
      setMedxResult({ ok: false, text: e?.message || 'Não foi possível anexar no MedX.' })
    } finally {
      setSendingMedx(false)
    }
  }

  return (
    <div className="border border-slate-100 rounded-lg hover:bg-slate-50 transition-colors group">
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="w-9 h-9 bg-brand-50 text-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
        {mediaIcon(message.media_type)}
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={e => e.key === 'Enter' && setEditing(false)}
            autoFocus
            className="w-full text-sm text-slate-700 border-b border-brand-300 focus:outline-none bg-transparent"/>
        ) : (
          <div className="flex items-center gap-1 min-w-0">
            {message.media_url ? (
              <a href={message.media_url} target="_blank" rel="noopener noreferrer"
                className="text-sm text-brand-600 hover:underline truncate">
                {label}
              </a>
            ) : (
              <span className="text-sm text-slate-400 truncate italic">Arquivo removido</span>
            )}
            {message.media_url && (
              <button onClick={() => setEditing(true)} className="text-slate-300 hover:text-slate-500 flex-shrink-0 ml-1">
                <Pencil size={11}/>
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-slate-400 flex items-center flex-wrap gap-x-1">
          <span>{format(new Date(message.created_at), "d MMM 'às' HH:mm", { locale: ptBR })}</span>
          <span>· <span className="capitalize">{message.media_type || 'documento'}</span> ·</span>
          {/* v48.137 — Anexo do paciente x da equipe x da IA, com ícone e cor
              diferentes (antes só dizia "Recebido"/"Enviado" em texto igual
              pros três casos, e não identificava quem da equipe mandou). */}
          {message.direction === 'inbound' ? (
            <span className="inline-flex items-center gap-0.5 text-slate-500 font-medium">
              <UserIcon size={11}/> Paciente
            </span>
          ) : message.sender_id ? (
            <span className="inline-flex items-center gap-0.5 text-brand-600 font-medium">
              <ShieldCheck size={11}/> <NomeRemetente senderId={message.sender_id}/>
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-violet-600 font-medium">
              <Bot size={11}/> {assistantName}
            </span>
          )}
        </p>
        {medxMark && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 size={11}/> Anexado no MedX{medxMark.attached_by ? ` por ${medxMark.attached_by}` : ''}
          </p>
        )}
      </div>
      {/* Botão deletar individual */}
      {message.media_url && (
        confirmDel ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => setConfirmDel(false)} className="text-xs text-slate-400 hover:text-slate-600 px-1.5 py-1">Não</button>
            <button onClick={handleDelete} disabled={deleting}
              className="text-xs text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded-md flex items-center gap-1 disabled:opacity-50">
              {deleting ? <Loader2 size={9} className="animate-spin"/> : <Trash2 size={9}/>}
              Sim
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
          <button onClick={() => {
            setMedxResult(null)
            setResumoIA(null); setAnaliseError(''); setAnotacaoResult(null)
            if (medxMark && !showMedx) { setConfirmResend(true); setShowMedx(true) }
            else { setShowMedx(v => !v); setConfirmResend(false) }
          }} title={medxMark ? 'Arquivo já anexado no MedX' : 'Adicionar ao prontuário MedX'}
            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg flex-shrink-0 transition-all">
            <UploadCloud size={14}/>
          </button>
          <button onClick={() => setConfirmDel(true)}
            className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg flex-shrink-0 transition-all">
            <Trash2 size={13}/>
          </button>
          </div>
        )
      )}
    </div>
    {showMedx && message.media_url && (
      <div className="px-3 pb-3 pt-2 border-t border-slate-100 bg-slate-50/70 rounded-b-lg space-y-2.5">
        {confirmResend ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0"/> Este arquivo já foi anexado no MedX. Deseja anexar novamente?
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setConfirmResend(false); setShowMedx(false) }} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-600">Não</button>
              <button onClick={() => setConfirmResend(false)} className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold">Sim, anexar novamente</button>
            </div>
          </div>
        ) : !contact.medx_id ? (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={13} className="mt-0.5 flex-shrink-0"/> Localize o paciente no MedX antes de anexar o arquivo.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMedxType('exame')} className={clsx('px-3 py-2 rounded-lg border text-xs font-medium', medxType === 'exame' ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-600')}>Exame</button>
              <button onClick={() => setMedxType('documento')} className={clsx('px-3 py-2 rounded-lg border text-xs font-medium', medxType === 'documento' ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-600')}>Documento pessoal</button>
            </div>
            <input value={medxName} onChange={e => setMedxName(e.target.value)} placeholder={medxType === 'exame' ? 'Nome do exame' : 'Nome do documento'}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            <p className="text-xs text-slate-400">Será registrado como: {medxName.trim() || 'Nome do arquivo'} - Adicionado por {agentName}</p>
            {medxResult && <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg border text-xs', medxResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700')}>
              {medxResult.ok ? <CheckCircle2 size={13}/> : <AlertCircle size={13}/>} {medxResult.text}
            </div>}
            {!medxResult?.ok && <button onClick={handleSendToMedx} disabled={sendingMedx || !medxName.trim()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
              {sendingMedx ? <Loader2 size={13} className="animate-spin"/> : <UploadCloud size={13}/>} {sendingMedx ? 'Anexando e confirmando...' : 'Adicionar ao prontuário MedX'}
            </button>}

            {/* v46.88: resumo de exame por IA — só pra tipo "Exame", só quando clicado */}
            {medxType === 'exame' && (
              <div className="pt-2 mt-1 border-t border-dashed border-slate-200 space-y-2">
                {!resumoIA && (
                  <button onClick={handleAnalisarExame} disabled={analisando}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white border border-brand-300 text-brand-700 hover:bg-brand-50 text-xs font-semibold rounded-lg disabled:opacity-50">
                    {analisando ? <Loader2 size={13} className="animate-spin"/> : <Stethoscope size={13}/>}
                    {analisando ? 'Analisando exame (pode levar um minuto)...' : 'Analisar exame com IA (resumo p/ anotação)'}
                  </button>
                )}
                {analiseError && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg border text-xs bg-red-50 border-red-200 text-red-700">
                    <AlertCircle size={13} className="mt-0.5 flex-shrink-0"/> {analiseError}
                  </div>
                )}
                {resumoIA !== null && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-slate-500">Resumo gerado — edite direto no texto abaixo (já sai formatado igual vai ficar no MedX):</p>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
                      <button type="button" title="Negrito (selecione o texto)" onMouseDown={e => e.preventDefault()} onClick={() => aplicarFormatacaoResumo('bold')}
                        className="p-1.5 rounded hover:bg-white text-slate-600"><Bold size={13}/></button>
                      <button type="button" title="Itálico (selecione o texto)" onMouseDown={e => e.preventDefault()} onClick={() => aplicarFormatacaoResumo('italic')}
                        className="p-1.5 rounded hover:bg-white text-slate-600"><Italic size={13}/></button>
                      <button type="button" title="Sublinhado (selecione o texto)" onMouseDown={e => e.preventDefault()} onClick={() => aplicarFormatacaoResumo('underline')}
                        className="p-1.5 rounded hover:bg-white text-slate-600"><Underline size={13}/></button>
                    </div>
                    <div
                      ref={resumoEditRef}
                      contentEditable
                      suppressContentEditableWarning
                      onFocus={() => { document.execCommand('styleWithCSS', false, false); document.execCommand('defaultParagraphSeparator', false, 'br') }}
                      className="w-full min-h-[10rem] text-xs text-slate-700 border border-brand-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 whitespace-pre-wrap [&_strong]:font-semibold"
                    />
                    {anotacaoResult && <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg border text-xs', anotacaoResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700')}>
                      {anotacaoResult.ok ? <CheckCircle2 size={13}/> : <AlertCircle size={13}/>} {anotacaoResult.text}
                    </div>}
                    {!anotacaoResult?.ok && (
                      <button onClick={handleEnviarAnotacaoMedx} disabled={enviandoAnotacao || !contact.medx_id}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                        {enviandoAnotacao ? <Loader2 size={13} className="animate-spin"/> : <Stethoscope size={13}/>}
                        {enviandoAnotacao ? 'Gravando na Área Evolução...' : 'Enviar ao MedX (Área Evolução)'}
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={handleAnalisarExame} disabled={analisando}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium rounded-lg flex items-center justify-center gap-1 disabled:opacity-50">
                        {analisando ? <Loader2 size={11} className="animate-spin"/> : <RefreshCw size={11}/>} Gerar de novo
                      </button>
                      <button onClick={handleCopiarResumo}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium rounded-lg flex items-center justify-center gap-1">
                        {copiadoResumo ? <CheckCircle2 size={11}/> : null} {copiadoResumo ? 'Copiado!' : 'Copiar texto'}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">Se o envio automático falhar, use "Copiar texto" e cole manualmente na anotação clínica do MedX.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    )}
    </div>
  )
}

type ScheduledMsg = {
  id: string
  content: string
  scheduled_for: string
  status: string
  origin: string
}

function ScheduledTab({ contact }: { contact: Contact }) {
  const [loading, setLoading] = useState(true)
  const [msgs, setMsgs] = useState<ScheduledMsg[]>([])
  const [error, setError] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  // Submenu: 'ativas' = so o que ainda vai sair; 'enviadas' = historico, so conferencia
  const [subAba, setSubAba] = useState<'ativas' | 'enviadas'>('ativas')
  const [deletingAll, setDeletingAll] = useState(false)

  // v46.87: edição do texto (e, a partir de agora, também da data/hora) de
  // uma mensagem agendada — ex: acrescentar/ajustar o link de confirmação
  // num lembrete específico, ou adiar o disparo — direto pelo painel do
  // paciente, sem precisar mexer no banco na mão.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [savingEditId, setSavingEditId] = useState<string | null>(null)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id])

  async function load() {
    setLoading(true); setError('')
    const { data, error: err } = await supabase
      .from('scheduled_messages')
      .select('id, content, scheduled_for, status, origin, sent_at')
      .eq('contact_id', contact.id)
      .order('scheduled_for', { ascending: true })
    if (err) { setError('Não foi possível carregar as mensagens agendadas: ' + err.message) }
    setMsgs((data as any) ?? [])
    setLoading(false)
  }

  async function handleCancel(id: string) {
    setCancellingId(id)
    await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', id)
    await load()
    setCancellingId(null)
  }

  async function handleDeleteOne(id: string) {
    setDeletingId(id)
    const { error: err } = await supabase.from('scheduled_messages').delete().eq('id', id)
    if (err) { setError('Não foi possível apagar: ' + err.message) }
    setConfirmDeleteId(null)
    setDeletingId(null)
    await load()
  }

  async function handleDeleteAll() {
    setDeletingAll(true)
    const { error: err } = await supabase.from('scheduled_messages').delete().eq('contact_id', contact.id)
    if (err) { setError('Não foi possível apagar o histórico: ' + err.message) }
    setConfirmDeleteAll(false)
    setDeletingAll(false)
    await load()
  }

  // Mesma lógica usada pra decidir o rótulo/cor "Agendado" (ver statusLabel
  // abaixo): qualquer status que não seja explicitamente enviado/falhou/
  // cancelado/substituído ainda pode ser cancelado ou editado. Antes, o botão
  // "Cancelar" só aparecia pra status === 'pending' — mas o lembrete automático
  // de confirmação de consulta usa status 'scheduled', então na prática nunca
  // aparecia pra ele. Corrigido aqui, e o botão "Editar" novo usa a mesma regra.
  function isAtivo(status: string) {
    return !['sent', 'failed', 'cancelled', 'cancelado', 'superseded'].includes(status)
  }

  // Mesmo padrão de "date" + "time" separados já usado pra agendar mensagem
  // no Inbox (handleScheduleMessage) — só monta o valor inicial a partir do
  // scheduled_for existente, no fuso local do navegador (igual à exibição
  // com date-fns logo abaixo).
  function pad2(n: number) { return String(n).padStart(2, '0') }
  function toDateInputValue(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
  function toTimeInputValue(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

  function startEdit(m: ScheduledMsg) {
    const d = new Date(m.scheduled_for)
    setEditingId(m.id); setEditContent(m.content)
    setEditDate(toDateInputValue(d)); setEditTime(toTimeInputValue(d))
    setEditError('')
  }

  function cancelEdit() {
    setEditingId(null); setEditContent(''); setEditDate(''); setEditTime(''); setEditError('')
  }

  async function saveEdit(id: string) {
    const texto = editContent.trim()
    if (!texto) { setEditError('A mensagem não pode ficar vazia.'); return }
    if (!editDate || !editTime) { setEditError('Informe data e hora do envio.'); return }
    const novaData = new Date(`${editDate}T${editTime}:00`)
    if (isNaN(novaData.getTime())) { setEditError('Data ou hora inválida.'); return }
    setSavingEditId(id); setEditError('')
    const { error: err } = await supabase.from('scheduled_messages')
      .update({ content: texto, scheduled_for: novaData.toISOString() })
      .eq('id', id)
    setSavingEditId(null)
    if (err) { setEditError('Não foi possível salvar: ' + err.message); return }
    setEditingId(null); setEditContent(''); setEditDate(''); setEditTime('')
    await load()
  }

  function statusColor(status: string) {
    if (status === 'sent') return 'bg-emerald-50 text-emerald-700'
    if (status === 'failed') return 'bg-red-50 text-red-700'
    if (status === 'cancelled' || status === 'cancelado' || status === 'superseded') return 'bg-slate-100 text-slate-500'
    return 'bg-amber-50 text-amber-700'
  }

  function statusLabel(status: string) {
    if (status === 'sent') return 'Enviado'
    if (status === 'failed') return 'Falhou'
    if (status === 'superseded') return 'Substituído'
    if (status === 'cancelled' || status === 'cancelado') return 'Cancelado'
    return 'Agendado'
  }

  // A tela ficava poluida porque listava TUDO: alem das realmente agendadas,
  // vinham as substituidas (quando o horario da consulta muda, a mensagem antiga
  // vira 'superseded') e as canceladas. Aqui separamos: a aba principal mostra so
  // o que ainda vai sair, e as ja enviadas ficam num submenu, para conferencia.
  const ativas   = msgs.filter(m => m.status === 'scheduled' || m.status === 'pending')
  const enviadas = msgs.filter(m => m.status === 'sent')
  const visiveis = subAba === 'enviadas' ? enviadas : ativas

  return (
    <div className="px-5 py-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Mensagens agendadas</p>
        <button onClick={load} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400" title="Atualizar"><RefreshCw size={13}/></button>
      </div>

      {!loading && (
        <div className="flex items-center gap-1 mb-3 bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setSubAba('ativas')}
            className={clsx('flex-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors',
              subAba === 'ativas' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            Agendadas ({ativas.length})
          </button>
          <button onClick={() => setSubAba('enviadas')}
            className={clsx('flex-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors',
              subAba === 'enviadas' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            Enviadas ({enviadas.length})
          </button>
        </div>
      )}

      {error && (
        <div className="mb-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle size={14}/>{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <Loader2 size={20} className="animate-spin mb-2"/>
          <p className="text-sm">Carregando...</p>
        </div>
      ) : visiveis.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-3">
            <CalendarClock size={20} className="text-slate-400"/>
          </div>
          <p className="text-sm text-slate-500">
            {subAba === 'enviadas' ? 'Nenhuma mensagem enviada ainda' : 'Nenhuma mensagem agendada'}
          </p>
          {subAba !== 'enviadas' && (
            <p className="text-xs text-slate-400 mt-1 max-w-[220px]">Use o ícone de relógio no campo de mensagem para agendar um disparo para este paciente</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Apagar todo o histórico (inclui substituídas e canceladas, que não aparecem em tela) */}
          {subAba === 'ativas' && (confirmDeleteAll ? (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={13} className="text-red-500 flex-shrink-0"/>
              <span className="text-xs text-red-700 flex-1">Apagar {msgs.length} mensagem(ns) agendada(s) deste paciente? Isso não pode ser desfeito.</span>
              <button onClick={() => setConfirmDeleteAll(false)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Não</button>
              <button onClick={handleDeleteAll} disabled={deletingAll}
                className="text-xs text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50">
                {deletingAll ? <Loader2 size={10} className="animate-spin"/> : <Trash2 size={10}/>}
                Apagar tudo
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDeleteAll(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 border border-dashed border-red-200 rounded-lg transition-colors">
              <Trash2 size={12}/> Apagar todo o histórico ({msgs.length})
            </button>
          ))}

          {visiveis.map(m => (
            <div key={m.id} className="border border-slate-100 rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
                  <Clock size={11}/>
                  {format(new Date(m.scheduled_for), "d MMM yyyy 'às' HH:mm", { locale: ptBR })}
                </span>
                <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', statusColor(m.status))}>
                  {statusLabel(m.status)}
                </span>
              </div>
              {editingId === m.id ? (
                <div className="space-y-1.5">
                  <div className="flex gap-1.5">
                    <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                      className="flex-1 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                    <input type="time" value={editTime} onChange={e => setEditTime(e.target.value)}
                      className="w-24 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                  </div>
                  <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={4}
                    className="w-full text-sm text-slate-700 border border-brand-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"/>
                  {editError && <p className="text-xs text-red-600">{editError}</p>}
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={cancelEdit} disabled={savingEditId === m.id}
                      className="text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 px-2 py-1 rounded-lg disabled:opacity-50">
                      Descartar
                    </button>
                    <button onClick={() => saveEdit(m.id)} disabled={savingEditId === m.id || !editContent.trim() || !editDate || !editTime}
                      className="text-xs text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50">
                      {savingEditId === m.id ? <Loader2 size={11} className="animate-spin"/> : <Save size={11}/>}
                      Salvar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{m.content}</p>
                  <div className="flex items-center justify-end gap-1 mt-1.5">
                    {isAtivo(m.status) && (
                      <button onClick={() => startEdit(m)}
                        className="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded-lg flex items-center gap-1">
                        <Pencil size={11}/> Editar
                      </button>
                    )}
                    {isAtivo(m.status) && (
                      <button onClick={() => handleCancel(m.id)} disabled={cancellingId === m.id}
                        className="text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 px-2 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50">
                        {cancellingId === m.id ? <Loader2 size={11} className="animate-spin"/> : null}
                        Cancelar
                      </button>
                    )}
                    {confirmDeleteId === m.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-slate-400 hover:text-slate-600 px-1.5 py-1">Não</button>
                        <button onClick={() => handleDeleteOne(m.id)} disabled={deletingId === m.id}
                          className="text-xs text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded-md flex items-center gap-1 disabled:opacity-50">
                          {deletingId === m.id ? <Loader2 size={9} className="animate-spin"/> : <Trash2 size={9}/>}
                          Apagar
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(m.id)}
                        className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg flex items-center gap-1">
                        <Trash2 size={11}/> Apagar
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={clsx('flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium border-b-2 transition-colors',
        active ? 'text-brand-700 border-brand-600' : 'text-slate-400 border-transparent hover:text-slate-600')}>
      {label}
      {!!badge && (
        <span className={clsx('px-1.5 py-0.5 rounded-full text-[10px] leading-none',
          active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>
          {badge}
        </span>
      )}
    </button>
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

// Webhooks n8n
const WH_PACIENTE = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-buscar-paciente'
const WH_AGENDA = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/buscar_agendamento'
const WH_CANCELAR = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-cancelar-consulta'
const WH_REMARCAR = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-remarcar-consulta'
const WH_AGENDAR = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-agendar-consulta'
const WH_VERIFICAR_RETORNO = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-verificar-retorno'
// Dispara manualmente o workflow n8n "Sync MedX -> Agendamentos (Secretaria)" (que
// por padrão roda sozinho a cada 15 minutos) — botão "Sincronizar agora" no card
// MedX do atendimento do paciente, pra secretária forçar a sincronização na hora
// quando não quiser esperar o próximo ciclo automático. O agendamento a cada 15
// minutos continua rodando normalmente em paralelo (é 100% aditivo).
const WH_SYNC_AGENDAMENTOS_MANUAL = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/sync-medx-agendamentos-manual'

// O MedX devolve data/hora em formatos variados (yyyy-mm-dd, hh:mm:ss com segundos).
// Essas funções normalizam pra exibição em pt-BR (dd/mm/aaaa e hh:mm), sem depender
// de parsear como Date (evita problema de fuso horário em datas "soltas").
function formatDataBR(raw?: string): string {
  if (!raw) return ''
  const s = String(raw).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return s
}
function formatHoraBR(raw?: string): string {
  if (!raw) return ''
  const s = String(raw).trim()
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
  return s
}

// Descobre se a ultima consulta foi um RETORNO (nao pago) ou uma CONSULTA (paga).
// O MedX manda essa informacao com nomes diferentes dependendo do endpoint, entao
// olhamos todos os campos equivalentes antes de desistir. Devolve null quando nao da
// pra afirmar nada (ai a tela mostra "cobranca nao informada" em vez de sumir com o selo).
function normalizarRetornoUltima(u: any): 'SIM' | 'NAO' | null {
  const r = String(u?.retorno ?? '').trim().toUpperCase()
  if (['SIM', 'S', 'TRUE', '1'].includes(r)) return 'SIM'
  if (['NAO', 'NÃO', 'N', 'FALSE', '0'].includes(r)) return 'NAO'
  const g = String(u?.retorno_gratuito ?? '').trim().toUpperCase()
  if (['SIM', 'S', 'TRUE', '1'].includes(g)) return 'SIM'
  if (['NAO', 'NÃO', 'N', 'FALSE', '0'].includes(g)) return 'NAO'
  const c = String(u?.cobranca ?? '').trim().toUpperCase()
  if (c.includes('NAO COBRAR') || c.includes('NÃO COBRAR')) return 'SIM'
  if (c.includes('COBRAR')) return 'NAO'
  const m = String(u?.modalidade ?? u?.tipo_consulta ?? u?.especialidade ?? '').trim().toUpperCase()
  if (m.includes('RETORNO')) return 'SIM'
  return null
}

type MedXData = {
  encontrado: boolean
  nome?: string
  nome_social?: string
  cpf?: string
  sexo?: string
  telefone?: string
  email?: string
  medx_id?: string
  agendamentos?: Array<{
    data: string; hora?: string; profissional?: string; profissional_id?: string; slot_id?: string; medx_agendamento_id?: string
    status?: string; especialidade?: string; modalidade?: string; planoRetorno?: string
    cobranca?: 'COBRAR' | 'NÃO COBRAR'
    cobrancaJustificativa?: string; cobrancaAlteradoPor?: string; cobrancaAlteradoEm?: string
    retornoJustificativa?: string; retornoAlteradoPor?: string; retornoAlteradoEm?: string
  }>
  ultimaConsulta?: {
    data: string
    hora?: string
    profissional?: string
    procedimento?: string
    comRetorno?: string
    retorno?: string
  } | null
}

function MedXTab({ contact, onSaved, openSchedule = false, openRetorno = false }: { contact: Contact; onSaved: (updated: Contact) => void; openSchedule?: boolean; openRetorno?: boolean }) {
  const { agent } = useAuth()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<MedXData | null>(null)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  // v48.174 — Prontuário era uma aba própria, espremida ao lado de "Anexos"
  // na fileira de cima (pedido do Jorge: muito perto, difícil de ler). Virou
  // submenu aqui dentro de MedX — mesmo padrão de Recebidas/Enviadas em Anexos.
  const [medxSubAba, setMedxSubAba] = useState<'agenda' | 'prontuario'>('agenda')
  // v48.175 — Prontuário é restrito a médicos (dado clínico sensível). Se o
  // cargo não tem acesso, nem mostra o submenu — só "Cadastro e agenda".
  const podeVerProntuario = useAcessoProntuario()

  // Correção manual de cobrança (a Sofia/MedX às vezes classifica errado — ex: marca
  // "cobrar" numa consulta que na verdade é o retorno de uma cirurgia recém-feita).
  const [editingCobrancaKey, setEditingCobrancaKey] = useState<string | null>(null)
  const [editCobrancaValue, setEditCobrancaValue] = useState<'COBRAR' | 'NÃO COBRAR'>('COBRAR')
  const [editCobrancaJustificativa, setEditCobrancaJustificativa] = useState('')
  const [savingCobranca, setSavingCobranca] = useState(false)
  const [cobrancaSaveError, setCobrancaSaveError] = useState('')
  // v48.166 — correção manual de "Com/Sem retorno", mesmo padrão da cobrança acima.
  // Nome com sufixo "Correcao" pra não colidir com o "retorno" de agendar msg de
  // retorno (follow-up), que já usa esses mesmos nomes mais abaixo neste arquivo.
  const [editingRetornoCorrecaoKey, setEditingRetornoCorrecaoKey] = useState<string | null>(null)
  const [editRetornoCorrecaoValue, setEditRetornoCorrecaoValue] = useState<'Com retorno' | 'Sem retorno'>('Sem retorno')
  const [editRetornoCorrecaoJustificativa, setEditRetornoCorrecaoJustificativa] = useState('')
  const [savingRetornoCorrecao, setSavingRetornoCorrecao] = useState(false)
  const [retornoCorrecaoSaveError, setRetornoCorrecaoSaveError] = useState('')

  const [confirmCancelKey, setConfirmCancelKey] = useState<string | null>(null)
  const [cancelingKey, setCancelingKey] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState('')

  // "Reenviar confirmação": reforço manual pra criar/reativar a mensagem de
  // confirmação de consulta (mesma origem do lembrete automático da v46.49),
  // pros casos em que o lembrete automático não saiu sozinho.
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState('')
  const [confirmSuccessKey, setConfirmSuccessKey] = useState<string | null>(null)

  // Agendar msg de retorno: a partir da última consulta atendida, programa o lembrete
  // automático (exames / pós-operatório / rotina) pro prazo escolhido. Cria direto em
  // scheduled_messages com origin 'retorno_followup' — mesma origem que a Agenda de
  // Mensagens já trata como "Auto" (ver AUTO_ORIGINS em app/agenda/page.tsx).
  // Se aberto direto pelo menu do paciente ("📅 Agendar msg de retorno", fora
  // do card), já nasce com o modal marcado pra abrir assim que os dados MedX
  // (com a última consulta) terminarem de carregar — ver useEffect abaixo.
  const [retornoModalOpen, setRetornoModalOpen] = useState(openRetorno)
  const [retornoAvisoSemConsulta, setRetornoAvisoSemConsulta] = useState(false)
  const [retornoPeriodo, setRetornoPeriodo] = useState<'1' | '3' | '6' | '12' | 'custom'>('1')
  const [retornoPeriodoCustom, setRetornoPeriodoCustom] = useState('')
  const [retornoTipo, setRetornoTipo] = useState<'exames' | 'pos_operatorio' | 'nada'>('exames')
  const [savingRetorno, setSavingRetorno] = useState(false)
  const [retornoError, setRetornoError] = useState('')
  const [retornoSalvo, setRetornoSalvo] = useState(false)

  // v46.85: indicador 📅 nos cards de consulta quando já existe uma mensagem
  // agendada pra essa consulta — evita reagendar/confundir a secretária.
  // "confirmar_consulta" (trigger automático da v46.49) é por agendamento
  // específico (medx_agendamento_id/agendamento_id); "retorno_followup" (botão
  // "Agendar msg de retorno" acima) é por paciente, sem vínculo a um agendamento.
  const [confirmacoesAgendadasIds, setConfirmacoesAgendadasIds] = useState<Set<string>>(new Set())
  const [retornoJaAgendado, setRetornoJaAgendado] = useState(false)
  // v46.86: indicador "Confirmado pelo paciente" — separado do status interno
  // (que segue vindo só do sync MedX). Mapeia medx_agendamento_id/id -> quando
  // o paciente confirmou ou recusou pelo link enviado no lembrete de WhatsApp.
  const [pacienteConfirmouEm, setPacienteConfirmouEm] = useState<Map<string, string>>(new Map())
  const [pacienteRecusouEm, setPacienteRecusouEm] = useState<Map<string, string>>(new Map())

  // Catálogo de exames de rotina (cadastro compartilhado, tabela exames_rotina) —
  // usado no passo "Exames" do agendamento de msg de retorno: seleciona os que
  // já existem, cadastra um novo (fica salvo pra próxima vez) ou exclui um exame
  // do catálogo.
  const [examesCatalogo, setExamesCatalogo] = useState<{ id: string; nome: string }[]>([])
  const [retornoExamesSelecionados, setRetornoExamesSelecionados] = useState<string[]>([])
  const [novoExameNome, setNovoExameNome] = useState('')
  const [savingNovoExame, setSavingNovoExame] = useState(false)

  // Sincronizar agora: dispara manualmente o workflow n8n "Sync MedX -> Agendamentos
  // (Secretaria)" que normalmente só roda sozinho a cada 15 minutos — útil quando a
  // secretária acabou de mexer em algo no MedX e não quer esperar o próximo ciclo.
  const [sincronizando, setSincronizando] = useState(false)
  const [sincronizarMsg, setSincronizarMsg] = useState('')
  const [sincronizarErro, setSincronizarErro] = useState('')

  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [remarcarKey, setRemarcarKey] = useState<string | null>(null)
  const [remarcarProfId, setRemarcarProfId] = useState('')
  const [remarcarData, setRemarcarData] = useState('')
  const [slotsDisponiveis, setSlotsDisponiveis] = useState<any[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [remarcandoSlotId, setRemarcandoSlotId] = useState<string | null>(null)
  const [remarcarError, setRemarcarError] = useState('')

  // Busca automática ao abrir a aba
  useEffect(() => {
    buscar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id])

  // v46.85: carrega quais mensagens já estão agendadas pra este paciente
  // (confirmação de consulta por agendamento + msg de retorno por paciente),
  // pra acender o 📅 nos cards. Independente da busca no MedX acima.
  useEffect(() => {
    carregarIndicadoresAgendados()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id])

  async function carregarIndicadoresAgendados() {
    try {
      const { data: rows } = await supabase
        .from('scheduled_messages')
        .select('medx_agendamento_id, agendamento_id, origin, reminder_type')
        .eq('contact_id', contact.id)
        .in('status', ['scheduled', 'pending'])
      const ids = new Set<string>()
      let retorno = false
      ;(rows || []).forEach((r: any) => {
        if (r.reminder_type === 'confirmar_consulta' || r.origin === 'appointment_confirmation') {
          if (r.medx_agendamento_id) ids.add(String(r.medx_agendamento_id))
          if (r.agendamento_id) ids.add(String(r.agendamento_id))
        }
        if (r.origin === 'retorno_followup') retorno = true
      })
      setConfirmacoesAgendadasIds(ids)
      setRetornoJaAgendado(retorno)

      // v46.86: carrega a confirmação/recusa do próprio paciente (coluna nova,
      // não mexe em `status` — aquele continua 100% governado pelo sync MedX).
      const { data: agRows } = await supabase
        .from('agendamentos')
        .select('id, medx_agendamento_id, patient_confirmed_at, patient_declined_at')
        .eq('contact_id', contact.id)
        .not('medx_agendamento_id', 'is', null)
      const confirmou = new Map<string, string>()
      const recusou = new Map<string, string>()
      ;(agRows || []).forEach((r: any) => {
        const keys = [r.id, r.medx_agendamento_id].filter(Boolean).map(String)
        if (r.patient_confirmed_at) keys.forEach(k => confirmou.set(k, r.patient_confirmed_at))
        if (r.patient_declined_at) keys.forEach(k => recusou.set(k, r.patient_declined_at))
      })
      setPacienteConfirmouEm(confirmou)
      setPacienteRecusouEm(recusou)
    } catch {}
  }

  // Aberto direto do menu do paciente (fora do card "Última consulta"): assim
  // que os dados MedX terminam de carregar, se não houver última consulta pra
  // basear o retorno, avisa em vez de deixar o modal simplesmente não aparecer.
  useEffect(() => {
    if (!openRetorno || loading || !data) return
    if (!data.ultimaConsulta) { setRetornoModalOpen(false); setRetornoAvisoSemConsulta(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRetorno, loading, data])

  // Lista de profissionais para o seletor de remarcação (carregada uma vez)
  useEffect(() => {
    supabase.from('professionals').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => setProfessionals(data ?? []))
  }, [])

  // Catálogo de exames de rotina (carregado uma vez, usado no modal de retorno)
  useEffect(() => {
    carregarExamesCatalogo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function carregarExamesCatalogo() {
    supabase.from('exames_rotina').select('id, nome').order('nome')
      .then(({ data, error: err }) => {
        if (err) { setRetornoError('Não foi possível carregar os exames: ' + err.message); return }
        setExamesCatalogo(data ?? [])
      })
  }

  // Busca horários disponíveis quando profissional + data estão selecionados
  // v48.155 — protegido contra resposta atrasada: se o profissional/data mudar de
  // novo antes da busca anterior voltar, a resposta velha (de outra combinação)
  // não pode mais sobrescrever o resultado da busca atual.
  useEffect(() => {
    if (!remarcarKey || !remarcarProfId || !remarcarData) { setSlotsDisponiveis([]); return }
    let cancelled = false
    setLoadingSlots(true)
    supabase.from('agenda_slots').select('*')
      .eq('professional_id', remarcarProfId)
      .eq('data', remarcarData)
      .eq('disponivel', true)
      .eq('bloqueado', false)
      .order('hora_inicio')
      .then(({ data }) => { if (!cancelled) { setSlotsDisponiveis(data ?? []); setLoadingSlots(false) } })
    return () => { cancelled = true }
  }, [remarcarKey, remarcarProfId, remarcarData])

  async function sincronizarAgendamentosAgora() {
    setSincronizando(true); setSincronizarMsg(''); setSincronizarErro('')
    try {
      const res = await fetch(WH_SYNC_AGENDAMENTOS_MANUAL, { method: 'POST' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      setSincronizarMsg('Sincronização disparada — os agendamentos devem atualizar em instantes.')
    } catch (e: any) {
      setSincronizarErro('Não foi possível sincronizar agora: ' + (e?.message || 'falha na conexão'))
    } finally {
      setSincronizando(false)
    }
  }

  function abrirRemarcar(ag: { profissional_id?: string; data: string }, key: string) {
    if (remarcarKey === key) { setRemarcarKey(null); return }
    setRemarcarError('')
    setRemarcarKey(key)
    const prof = professionals.find(p => String(p.id_medx) === String(ag.profissional_id))
    setRemarcarProfId(prof ? prof.id : '')
    setRemarcarData(ag.data || '')
  }

  async function remarcarAgendamento(ag: { slot_id?: string }, novoSlot: any) {
    if (!ag.slot_id) {
      setRemarcarError('Não foi possível remarcar: falta o identificador do horário atual.')
      return
    }
    setRemarcandoSlotId(novoSlot.slot_id); setRemarcarError('')
    try {
      const { data: agRows, error: agErr } = await supabase.from('agendamentos')
        .select('id').eq('slot_id', ag.slot_id).neq('status', 'Cancelada')
        .order('data', { ascending: false }).limit(1)
      if (agErr || !agRows || agRows.length === 0) {
        setRemarcarError('Não foi possível localizar o agendamento atual no sistema.')
        return
      }
      const res = await fetch(WH_REMARCAR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agendamento_id: agRows[0].id, novo_slot_id: novoSlot.slot_id }),
      })
      const json = await res.json().catch(() => ({}))
      if (json && json.success === false) {
        setRemarcarError(json.message || 'Não foi possível remarcar a consulta.')
      } else {
        setRemarcarKey(null)
        await buscar()
      }
    } catch (e: any) {
      setRemarcarError('Erro ao remarcar: ' + (e?.message || 'falha na conexão'))
    } finally {
      setRemarcandoSlotId(null)
    }
  }

  // ── Agendar nova consulta (não depende de haver agendamento anterior) ──
  const [agendarOpen, setAgendarOpen] = useState(openSchedule)
  const [agendarProfId, setAgendarProfId] = useState('')
  const [agendarData, setAgendarData] = useState('')
  const [agendarHoraAvulsa, setAgendarHoraAvulsa] = useState('')
  const [agendarSlotSelecionado, setAgendarSlotSelecionado] = useState<any | null>(null)
  const [agendarSlots, setAgendarSlots] = useState<any[]>([])
  const [loadingAgendarSlots, setLoadingAgendarSlots] = useState(false)
  const [agendandoSlotId, setAgendandoSlotId] = useState<string | null>(null)
  const [agendarError, setAgendarError] = useState('')
  const [agendarEhRetorno, setAgendarEhRetorno] = useState(false)
  const [agendarTemRetorno, setAgendarTemRetorno] = useState(true)
  const [agendarModalidade, setAgendarModalidade] = useState('Presencial')
  const [agendarCobranca, setAgendarCobranca] = useState<'COBRAR' | 'NÃO COBRAR'>('COBRAR')
  const [verificandoCobranca, setVerificandoCobranca] = useState(false)
  const [cobrancaDetalhe, setCobrancaDetalhe] = useState('Consulta paga')

  useEffect(() => {
    if (!agendarEhRetorno) {
      setAgendarCobranca('COBRAR')
      setCobrancaDetalhe('Consulta inicial/paga')
      setVerificandoCobranca(false)
      return
    }
    const profissional = professionals.find(p => p.id === agendarProfId)
    const cpf = String((contact as any).cpf || '').trim()
    if (!profissional?.id_medx || !cpf) {
      setAgendarCobranca('COBRAR')
      setCobrancaDetalhe('Não foi possível confirmar retorno gratuito')
      return
    }
    let cancelled = false
    setVerificandoCobranca(true)
    fetch(WH_VERIFICAR_RETORNO, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf, profissional_id: String(profissional.id_medx) }),
    })
      .then(res => res.json())
      .then(raw => {
        if (cancelled) return
        const result = Array.isArray(raw) ? (raw[0] || {}) : (raw || {})
        const valor = String(result.cobranca ?? result.resultado ?? result.status ?? '').toLowerCase()
        const gratuito = valor.includes('gratuit') || valor.includes('nao cobrar') || valor.includes('não cobrar') || String(result.retorno_gratuito).toUpperCase() === 'SIM'
        setAgendarCobranca(gratuito ? 'NÃO COBRAR' : 'COBRAR')
        setCobrancaDetalhe(result.motivo || (gratuito ? 'Retorno gratuito confirmado pelo n8n' : 'Cobrança confirmada pelo n8n'))
      })
      .catch(() => {
        if (!cancelled) {
          setAgendarCobranca('COBRAR')
          setCobrancaDetalhe('Regra de retorno indisponível; confirmar com a secretaria')
        }
      })
      .finally(() => { if (!cancelled) setVerificandoCobranca(false) })
    return () => { cancelled = true }
  }, [agendarEhRetorno, agendarProfId, contact])

  useEffect(() => {
    if (!agendarProfId) return
    setAgendarModalidade('Presencial')
  }, [agendarProfId])

  // v48.155 — mesma proteção contra resposta atrasada usada em slotsDisponiveis
  // acima: sem o `cancelled`, trocar de profissional/data rapidamente podia deixar
  // a busca antiga (de outra combinação) chegar depois e sobrescrever os horários
  // certos com um resultado vazio/errado.
  useEffect(() => {
    if (!agendarOpen || !agendarProfId || !agendarData) { setAgendarSlots([]); return }
    let cancelled = false
    setLoadingAgendarSlots(true)
    supabase.from('agenda_slots').select('*')
      .eq('professional_id', agendarProfId)
      .eq('data', agendarData)
      .eq('disponivel', true)
      .eq('bloqueado', false)
      .order('hora_inicio')
      .then(({ data }) => { if (!cancelled) { setAgendarSlots(data ?? []); setLoadingAgendarSlots(false) } })
    return () => { cancelled = true }
  }, [agendarOpen, agendarProfId, agendarData])

  useEffect(() => { setAgendarSlotSelecionado(null) }, [agendarProfId, agendarData])

  function abrirAgendar() {
    setAgendarError('')
    setAgendarOpen(v => !v)
  }

  async function agendarConsulta(slot: any) {
    if (agendarEhRetorno && verificandoCobranca) {
      setAgendarError('Aguarde a confirmação da regra de cobrança do retorno.')
      return
    }
    setAgendandoSlotId(slot.slot_id); setAgendarError('')
    let createdManualSlot = false
    try {
      if (slot.horario_avulso) {
        const { data: existing } = await supabase.from('agenda_slots')
          .select('slot_id, disponivel, agendamento_id').eq('slot_id', slot.slot_id).maybeSingle()
        if (existing && (!existing.disponivel || existing.agendamento_id)) {
          setAgendarError('Este horário avulso já está ocupado. Escolha outro horário.')
          return
        }
        if (!existing) {
          const profissional = professionals.find(p => p.id === slot.professional_id)
          const { error: slotError } = await supabase.from('agenda_slots').insert({
            slot_id: slot.slot_id,
            professional_id: slot.professional_id,
            id_medx: slot.id_medx,
            profissional_nome: slot.profissional_nome || profissional?.nome || '',
            data: slot.data,
            hora_inicio: slot.hora_inicio,
            hora_fim: slot.hora_fim,
            disponivel: true,
            especialidade: profissional?.especialidade || null,
            agendamento_id: null,
            id_tipo_consulta: null,
            bloqueado: false,
            motivo_bloqueio: null,
            bloqueado_em: null,
          })
          if (slotError) {
            setAgendarError('Não foi possível criar o horário avulso na agenda: ' + slotError.message)
            return
          }
          createdManualSlot = true
        }
      }
      const res = await fetch(WH_AGENDAR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_id: slot.slot_id,
          professional_id: slot.professional_id,
          id_medx: slot.id_medx,
          data: slot.data,
          hora_inicio: slot.hora_inicio,
          hora_fim: slot.hora_fim,
          contact_id: contact.id,
          medx_id: contact.medx_id || data?.medx_id || null,
          paciente: {
            nome: contact.full_name,
            telefone: contact.phone,
            cpf: (contact as any).cpf || null,
            data_nascimento: null,
            email: contact.email || null,
          },
          com_retorno: agendarTemRetorno,
          tem_retorno: agendarTemRetorno ? 'SIM' : 'NAO',
          retorno: agendarEhRetorno ? 'SIM' : 'NAO',
          retorno_gratuito: agendarCobranca === 'NÃO COBRAR' ? 'SIM' : 'NAO',
          cobranca: agendarCobranca,
          modalidade: agendarModalidade,
          is_online: agendarModalidade.toLowerCase() === 'online',
          horario_avulso: Boolean(slot.horario_avulso),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!json || json.success !== true) {
        if (createdManualSlot) await supabase.from('agenda_slots').delete().eq('slot_id', slot.slot_id).is('agendamento_id', null)
        setAgendarError((json && (json.error || json.message)) || 'Não foi possível agendar a consulta.')
      } else {
        setAgendarOpen(false)
        await buscar()
      }
    } catch (e: any) {
      if (createdManualSlot) await supabase.from('agenda_slots').delete().eq('slot_id', slot.slot_id).is('agendamento_id', null)
      setAgendarError('Erro ao agendar: ' + (e?.message || 'falha na conexão'))
    } finally {
      setAgendandoSlotId(null)
    }
  }

  function selecionarConsultaAvulsa() {
    const profissional = professionals.find(p => p.id === agendarProfId)
    if (!profissional || !agendarData || !/^([01]\d|2[0-3]):[0-5]\d$/.test(agendarHoraAvulsa)) {
      setAgendarError('Selecione o profissional, a data e informe um horário avulso válido.')
      return
    }
    const [hora, minuto] = agendarHoraAvulsa.split(':').map(Number)
    const fimTotal = hora * 60 + minuto + (profissional.duracao_min || 60)
    const horaFim = `${String(Math.floor(fimTotal / 60) % 24).padStart(2, '0')}:${String(fimTotal % 60).padStart(2, '0')}`
    setAgendarSlotSelecionado({
      slot_id: `avulso_${profissional.id_medx}_${agendarData}_${agendarHoraAvulsa.replace(':', '')}`,
      professional_id: profissional.id,
      id_medx: profissional.id_medx,
      profissional_nome: profissional.nome,
      data: agendarData,
      hora_inicio: agendarHoraAvulsa,
      hora_fim: horaFim,
      horario_avulso: true,
    })
  }

  async function cancelarAgendamento(ag: { data: string; hora?: string; profissional_id?: string; slot_id?: string; medx_agendamento_id?: string }, key: string) {
    if (!ag.profissional_id || !ag.data || !ag.hora) {
      setCancelError('Não foi possível cancelar: faltam profissional, data ou horário deste agendamento.')
      setConfirmCancelKey(null)
      return
    }
    setCancelingKey(key); setCancelError('')
    try {
      let agendamentoId: string | null = null
      let slotId = ag.slot_id || null
      if (slotId) {
        const { data: rows } = await supabase.from('agendamentos').select('id, slot_id')
          .eq('slot_id', slotId).neq('status', 'Cancelada').order('data', { ascending: false }).limit(1)
        agendamentoId = rows?.[0]?.id ?? null
      }
      if (!agendamentoId) {
        const { data: rows } = await supabase.from('agendamentos').select('id, slot_id')
          .eq('data', ag.data).eq('hora', ag.hora).neq('status', 'Cancelada')
          .ilike('paciente_nome', contact.full_name)
          .order('data', { ascending: false }).limit(1)
        agendamentoId = rows?.[0]?.id ?? null
        slotId = rows?.[0]?.slot_id ?? slotId
      }
      if (!agendamentoId) {
        setCancelError('Não foi possível localizar o agendamento ativo no CRM. Atualize a aba MedX e tente novamente.')
        return
      }
      const res = await fetch(WH_CANCELAR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agendamento_id: agendamentoId, motivo: null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || (json && json.success === false)) {
        setCancelError(json.error || json.message || 'Não foi possível cancelar o agendamento.')
      } else {
        let releaseQuery = supabase.from('agenda_slots').update({ disponivel: true, agendamento_id: null })
          .eq('bloqueado', false)
        releaseQuery = slotId
          ? releaseQuery.eq('slot_id', slotId)
          : releaseQuery.eq('professional_id', ag.profissional_id).eq('data', ag.data).eq('hora_inicio', ag.hora)
        const { error: releaseError } = await releaseQuery
        if (releaseError) {
          setCancelError('A consulta foi cancelada, mas o horário não pôde ser liberado. Atualize a agenda e tente novamente.')
          return
        }
        await buscar()
      }
    } catch (e: any) {
      setCancelError('Erro ao cancelar: ' + (e?.message || 'falha na conexão'))
    } finally {
      setCancelingKey(null)
      setConfirmCancelKey(null)
    }
  }

  async function reenviarConfirmacao(ag: { data: string; hora?: string; profissional?: string; profissional_id?: string; slot_id?: string; medx_agendamento_id?: string }, key: string) {
    if (!ag.data || !ag.hora) {
      setConfirmError('Não foi possível agendar a confirmação: faltam data ou horário deste agendamento.')
      return
    }
    setConfirmingKey(key); setConfirmError(''); setConfirmSuccessKey(null)
    try {
      let row: { id: string; contact_id: string; data: string; hora: string; profissional_nome?: string; medx_agendamento_id?: string } | null = null
      if (ag.slot_id) {
        const { data: rows } = await supabase.from('agendamentos')
          .select('id, contact_id, data, hora, profissional_nome, medx_agendamento_id')
          .eq('slot_id', ag.slot_id).neq('status', 'Cancelada').order('data', { ascending: false }).limit(1)
        row = rows?.[0] ?? null
      }
      if (!row) {
        const { data: rows } = await supabase.from('agendamentos')
          .select('id, contact_id, data, hora, profissional_nome, medx_agendamento_id')
          .eq('data', ag.data).eq('hora', ag.hora).neq('status', 'Cancelada')
          .ilike('paciente_nome', contact.full_name)
          .order('data', { ascending: false }).limit(1)
        row = rows?.[0] ?? null
      }
      if (!row) {
        setConfirmError('Não foi possível localizar este agendamento no CRM. Atualize a aba MedX e tente novamente.')
        return
      }

      // Supersede qualquer confirmação ativa anterior para este agendamento (ex: de um
      // horário antigo, antes da remarcação) antes de criar/reativar a atual.
      const externalKey = row.medx_agendamento_id || ('crm-' + row.id)
      await supabase.from('scheduled_messages')
        .update({ status: 'superseded', superseded_at: new Date().toISOString() })
        .or(`medx_agendamento_id.eq.${externalKey},agendamento_id.eq.${row.id}`)
        .eq('reminder_type', 'confirmar_consulta')
        .in('status', ['scheduled', 'pending'])

      const idempotencyKey = `confirmar_consulta:${externalKey}:${row.data}:${(row.hora || '').slice(0, 5)}`
      const content = `Olá, ${contact.full_name || 'tudo bem'}! Tudo bem? Estamos entrando em contato para confirmar sua consulta com ${row.profissional_nome || ag.profissional || 'nossa equipe'} no dia ${formatDataBR(row.data)} às ${formatHoraBR(row.hora)}. Por favor, toque no link abaixo para confirmar presença ou avisar que não poderá comparecer:\nhttps://crm.obesityhealth.com.br/confirmar/${row.id}`

      // Não dá pra usar .upsert({onConflict:'idempotency_key'}) aqui: o índice único
      // dessa coluna é parcial (`where idempotency_key is not null`), e o PostgREST monta
      // um ON CONFLICT sem essa condição, que o Postgres recusa ("there is no unique or
      // exclusion constraint matching the ON CONFLICT specification"). Por isso resolve a
      // linha manualmente: procura pelo idempotency_key e atualiza se existir, senão insere.
      const upsertPayload = {
        contact_id: row.contact_id, content, scheduled_for: new Date().toISOString(), status: 'scheduled',
        origin: 'appointment_confirmation', medx_agendamento_id: row.medx_agendamento_id || null,
        agendamento_id: row.id, reminder_type: 'confirmar_consulta', idempotency_key: idempotencyKey,
        cancelled_at: null, superseded_at: null,
      }
      const { data: existing } = await supabase.from('scheduled_messages')
        .select('id').eq('idempotency_key', idempotencyKey).limit(1)
      let err: { message: string } | null = null
      if (existing && existing[0]) {
        const { error } = await supabase.from('scheduled_messages').update(upsertPayload).eq('id', existing[0].id)
        err = error
      } else {
        const { error } = await supabase.from('scheduled_messages').insert(upsertPayload)
        err = error
      }

      if (err) {
        setConfirmError('Não foi possível agendar a confirmação: ' + err.message)
      } else {
        setConfirmSuccessKey(key)
        setTimeout(() => setConfirmSuccessKey(k => (k === key ? null : k)), 4000)
      }
    } catch (e: any) {
      setConfirmError('Erro ao agendar confirmação: ' + (e?.message || 'falha na conexão'))
    } finally {
      setConfirmingKey(null)
    }
  }

  async function buscar() {
    setLoading(true); setError(''); setData(null)
    let pac: any = null
    let agendamentos: any[] = []
    let ultimaConsulta: MedXData['ultimaConsulta'] = null

    try {
      // v48.161 — a busca/parse/dedup/override foi extraída para lib/medxAgendamentos.ts
      // (reaproveitada também pela Agenda Médica). Comportamento idêntico ao de antes.
      const resultado = await buscarAgendamentosMedx({ nome: contact.full_name, telefone: contact.phone, cpf: (contact as any).cpf })
      pac = resultado.paciente
      const aArr = resultado.agendamentosRaw
      agendamentos = resultado.agendamentos

      // "Última consulta" (aba realizadas) vem junto de cada item retornado pelo flow buscar_agendamento
      const ultimaRaw = aArr.find((a: any) => a && a.ultima_consulta)?.ultima_consulta
      if (ultimaRaw) {
        ultimaConsulta = {
          data: ultimaRaw.data,
          hora: ultimaRaw.hora_inicio,
          profissional: ultimaRaw.profissional,
          procedimento: [ultimaRaw.especialidade, ultimaRaw.modalidade].filter(Boolean).join(' · '),
          comRetorno: ultimaRaw.com_retorno,
          // O MedX nem sempre devolve o campo `retorno` preenchido; quando isso acontecia o
          // selo verde "Consulta (paga)" simplesmente sumia do card. Aqui deduzimos a partir
          // de qualquer um dos campos equivalentes que o MedX/n8n possa mandar.
          retorno: normalizarRetornoUltima(ultimaRaw) ?? undefined,
        }
      }
    } catch (e: any) {
      setError('Não foi possível buscar no MedX: ' + (e?.message || 'falha'))
      setLoading(false)
      return
    }

    if (pac?.resultado === 'encontrado') {
      if (pac.Id_do_Cliente) {
        const idEncontrado = String(pac.Id_do_Cliente)
        // v48.178 — Nunca troca sozinho um vínculo com o MedX que já existia por outro
        // encontrado numa busca por nome/telefone: um nome parecido pode levar a trocar
        // a pessoa errada (casos reais: "Marcia Valeria" -> "Marcia Cristina"; "Bruna
        // Puggina" -> "Bruna Polidoro"). Se o vínculo correto realmente mudou, isso
        // precisa ser confirmado manualmente, não sobrescrito sem ninguém notar.
        const linkJaExistiaDiferente = !!(contact as any).medx_id && (contact as any).medx_id !== idEncontrado
        if (!linkJaExistiaDiferente) {
        try {
          // Preenche no cadastro do CRM o que ainda não tinha, sem sobrescrever o que já existia —
          // assim os dados que o MedX já conhece ficam salvos e não precisam ser perguntados de novo.
          // Guardado em custom_fields.dados_medx (mesmo local que a aba "Dados" le/escreve -
          // gravar num outro caminho deixaria os dados "perdidos" pro resto da tela).
          const dm: Record<string, any> = { ...(contact.custom_fields?.dados_medx || {}) }
          if (pac.nascimento && !dm.nascimento) dm.nascimento = pac.nascimento
          if (pac.sexo && !dm.sexo) dm.sexo = pac.sexo
          if (pac.nome_social && !dm.nome_social) dm.nome_social = pac.nome_social
          if (pac.endereco_residencial && !dm.endereco_residencial) dm.endereco_residencial = pac.endereco_residencial
          if (pac.bairro && !dm.bairro) dm.bairro = pac.bairro
          if (pac.cep && !dm.cep) dm.cep = String(pac.cep)
          if (pac.complemento && !dm.complemento) dm.complemento = pac.complemento
          if (pac.numero && !dm.numero) dm.numero = pac.numero
          if (pac.cidade && !dm.cidade) dm.cidade = pac.cidade
          if (pac.estado && !dm.estado) dm.estado = pac.estado
          // O nome do MedX sempre prevalece sobre o que estiver cadastrado no CRM, pra evitar
          // confusão entre paciente/cadastro (ex: "Fulana" no CRM vs "Fulana da Silva" no MedX).
          // Só ignora se o MedX mandar algo vazio/quebrado (com "?" no lugar de acento).
          // v48.178 — e também ignora quando o nome do contato no CRM tem só um nome (sem
          // sobrenome, comum = nome de exibição do WhatsApp): nesse caso um "achado" por
          // primeiro nome não é confiável o bastante pra sobrescrever o cadastro - só o
          // medx_id/CPF/dados complementares são gravados, o nome fica como está até
          // alguém confirmar com o paciente.
          const nomeCrmTemSoPrimeiroNome = contact.full_name.trim().split(/\s+/).filter(t => t.length > 2).length <= 1
          const nomeMedx = (pac.nome && !pac.nome.includes('?') && !nomeCrmTemSoPrimeiroNome) ? String(pac.nome).trim() : null
          const { data: updated } = await supabase.from('contacts').update({
            medx_id: idEncontrado,
            ...(nomeMedx && nomeMedx !== contact.full_name ? { full_name: nomeMedx } : {}),
            cpf: pac.cpf || (contact as any).cpf || null,
            email: contact.email || pac.email || null,
            custom_fields: { ...(contact.custom_fields || {}), dados_medx: dm },
          }).eq('id', contact.id).select().single()
          if (updated) onSaved(updated as Contact)
        } catch {}
        }
      }
      setData({
        encontrado: true,
        nome: (pac.nome && !pac.nome.includes('?')) ? pac.nome : contact.full_name,
        nome_social: pac.nome_social, cpf: pac.cpf,
        sexo: pac.sexo, telefone: pac.celular, email: pac.email,
        medx_id: pac.Id_do_Cliente ? String(pac.Id_do_Cliente) : undefined,
        agendamentos,
        ultimaConsulta,
      })
    } else {
      setData({ encontrado: agendamentos.length > 0 || !!ultimaConsulta, agendamentos, ultimaConsulta })
    }
    setSearched(true)
    setLoading(false)
  }

  function abrirEdicaoCobranca(ag: { medx_agendamento_id?: string; cobranca?: 'COBRAR' | 'NÃO COBRAR' }, key: string) {
    if (!ag.medx_agendamento_id) return
    if (editingCobrancaKey === key) { setEditingCobrancaKey(null); return }
    setCobrancaSaveError('')
    setEditingCobrancaKey(key)
    setEditCobrancaValue(ag.cobranca === 'NÃO COBRAR' ? 'NÃO COBRAR' : 'COBRAR')
    setEditCobrancaJustificativa('')
  }

  async function salvarCobranca(ag: { medx_agendamento_id?: string }, key: string) {
    if (!ag.medx_agendamento_id) return
    if (!editCobrancaJustificativa.trim()) {
      setCobrancaSaveError('Descreva rapidamente o motivo da alteração (obrigatório).')
      return
    }
    setSavingCobranca(true); setCobrancaSaveError('')
    try {
      const payload = {
        medx_agendamento_id: ag.medx_agendamento_id,
        contact_id: contact.id,
        cobranca: editCobrancaValue,
        justificativa: editCobrancaJustificativa.trim(),
        updated_by_agent_id: agent?.id || null,
        updated_by_name: agent?.name || null,
        updated_at: new Date().toISOString(),
      }
      const { data: saved, error: err } = await supabase.from('agendamento_cobranca_overrides')
        .upsert(payload, { onConflict: 'medx_agendamento_id' }).select().single()
      if (err) {
        setCobrancaSaveError('Não foi possível salvar: ' + err.message)
        return
      }
      setData(prev => {
        if (!prev) return prev
        const aplicar = (a: any) => a.medx_agendamento_id === ag.medx_agendamento_id
          ? { ...a, cobranca: saved.cobranca, cobrancaJustificativa: saved.justificativa, cobrancaAlteradoPor: saved.updated_by_name, cobrancaAlteradoEm: saved.updated_at }
          : a
        return { ...prev, agendamentos: prev.agendamentos?.map(aplicar) }
      })
      setEditingCobrancaKey(null)
    } catch (e: any) {
      setCobrancaSaveError('Erro ao salvar: ' + (e?.message || 'falha na conexão'))
    } finally {
      setSavingCobranca(false)
    }
  }

  // v48.166 — correção manual de retorno, espelhando abrirEdicaoCobranca/salvarCobranca.
  function abrirEdicaoRetorno(ag: { medx_agendamento_id?: string; planoRetorno?: string }, key: string) {
    if (!ag.medx_agendamento_id) return
    if (editingRetornoCorrecaoKey === key) { setEditingRetornoCorrecaoKey(null); return }
    setRetornoCorrecaoSaveError('')
    setEditingRetornoCorrecaoKey(key)
    setEditRetornoCorrecaoValue(ag.planoRetorno === 'Com retorno' ? 'Com retorno' : 'Sem retorno')
    setEditRetornoCorrecaoJustificativa('')
  }

  async function salvarRetorno(ag: { medx_agendamento_id?: string }, key: string) {
    if (!ag.medx_agendamento_id) return
    if (!editRetornoCorrecaoJustificativa.trim()) {
      setRetornoCorrecaoSaveError('Descreva rapidamente o motivo da alteração (obrigatório).')
      return
    }
    setSavingRetornoCorrecao(true); setRetornoCorrecaoSaveError('')
    try {
      const payload = {
        medx_agendamento_id: ag.medx_agendamento_id,
        contact_id: contact.id,
        retorno: editRetornoCorrecaoValue,
        justificativa: editRetornoCorrecaoJustificativa.trim(),
        updated_by_agent_id: agent?.id || null,
        updated_by_name: agent?.name || null,
        updated_at: new Date().toISOString(),
      }
      const { data: saved, error: err } = await supabase.from('agendamento_retorno_overrides')
        .upsert(payload, { onConflict: 'medx_agendamento_id' }).select().single()
      if (err) {
        setRetornoCorrecaoSaveError('Não foi possível salvar: ' + err.message)
        return
      }
      setData(prev => {
        if (!prev) return prev
        const aplicar = (a: any) => a.medx_agendamento_id === ag.medx_agendamento_id
          ? { ...a, planoRetorno: saved.retorno, retornoJustificativa: saved.justificativa, retornoAlteradoPor: saved.updated_by_name, retornoAlteradoEm: saved.updated_at }
          : a
        return { ...prev, agendamentos: prev.agendamentos?.map(aplicar) }
      })
      setEditingRetornoCorrecaoKey(null)
    } catch (e: any) {
      setRetornoCorrecaoSaveError('Erro ao salvar: ' + (e?.message || 'falha na conexão'))
    } finally {
      setSavingRetornoCorrecao(false)
    }
  }

  // Agendar msg de retorno — cria o lembrete automático a partir da última consulta
  // atendida, pro prazo escolhido (1/3/6/12 meses), no mesmo formato que a Sofia usa
  // pros lembretes automáticos (origin 'retorno_followup', status 'scheduled').
  function abrirRetornoModal() {
    setRetornoError(''); setRetornoSalvo(false); setRetornoExamesSelecionados([]); setNovoExameNome('')
    setRetornoPeriodo('1'); setRetornoPeriodoCustom('')
    setRetornoModalOpen(true)
  }

  // Rótulo "1º mês" / "3º mês" / "1º ano" / "2º ano" etc. — funciona tanto
  // pros períodos padrão quanto pra qualquer período customizado digitado.
  function mesesLabel(meses: number) {
    if (meses % 12 === 0) return `${meses / 12}º ano`
    return `${meses}º mês`
  }

  function toggleExameSelecionado(nome: string) {
    setRetornoExamesSelecionados(arr => {
      if (arr.includes(nome)) return arr.filter(n => n !== nome)
      if (arr.length >= 5) return arr // até 5, igual antes
      return [...arr, nome]
    })
  }

  // Cadastra um exame novo no catálogo (fica salvo pra próxima vez) e já
  // seleciona ele pra mensagem de retorno atual.
  async function adicionarExameCatalogo() {
    const nome = novoExameNome.trim()
    if (!nome) return
    if (examesCatalogo.some(e => e.nome.toLowerCase() === nome.toLowerCase())) {
      // já existe no catálogo — só seleciona, não duplica
      toggleExameSelecionado(examesCatalogo.find(e => e.nome.toLowerCase() === nome.toLowerCase())!.nome)
      setNovoExameNome('')
      return
    }
    setSavingNovoExame(true)
    setRetornoError('')
    const { data: novo, error: err } = await supabase.from('exames_rotina').insert({ nome }).select('id, nome').single()
    setSavingNovoExame(false)
    if (err) { setRetornoError('Não foi possível cadastrar o exame: ' + err.message); return }
    setExamesCatalogo(arr => [...arr, novo].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
    if (retornoExamesSelecionados.length < 5) setRetornoExamesSelecionados(arr => [...arr, novo.nome])
    setNovoExameNome('')
  }

  // Exclui um exame do catálogo (não afeta mensagens já agendadas, só a lista
  // de opções pra próxima vez). Remove otimista da tela; se der erro no banco,
  // recarrega o catálogo pra não deixar a tela mostrando algo que não excluiu de verdade.
  async function excluirExameCatalogo(id: string, nome: string) {
    setExamesCatalogo(arr => arr.filter(e => e.id !== id))
    setRetornoExamesSelecionados(arr => arr.filter(n => n !== nome))
    const { error: err } = await supabase.from('exames_rotina').delete().eq('id', id)
    if (err) {
      setRetornoError('Não foi possível excluir o exame: ' + err.message)
      carregarExamesCatalogo()
    }
  }

  async function agendarMsgRetorno() {
    if (!data?.ultimaConsulta?.data) { setRetornoError('Não há data da última consulta.'); return }
    const examesPreenchidos = retornoExamesSelecionados
    if (retornoTipo === 'exames' && examesPreenchidos.length === 0) {
      setRetornoError('Selecione ou cadastre pelo menos um exame.')
      return
    }
    // "Outro" é em DIAS (pra retornos curtos tipo 1/5/7 dias) — os botões
    // padrão (1/3/6/12) continuam em meses.
    const isCustomDias = retornoPeriodo === 'custom'
    const diasCustom = isCustomDias ? Number(retornoPeriodoCustom) : null
    const mesesPreset = isCustomDias ? null : Number(retornoPeriodo)
    if (isCustomDias && (!diasCustom || diasCustom < 1 || !Number.isInteger(diasCustom))) {
      setRetornoError('Informe uma quantidade válida de dias (número inteiro maior que zero).')
      return
    }
    setSavingRetorno(true); setRetornoError('')
    try {
      const nome = data.nome || contact.full_name
      const profissional = data.ultimaConsulta.profissional || ''
      const dataUltimaBR = formatDataBR(data.ultimaConsulta.data)

      const [ano, mes, dia] = data.ultimaConsulta.data.slice(0, 10).split('-').map(Number)
      const [horaUltima, minUltima] = (data.ultimaConsulta.hora || '10:00').split(':').map(Number)
      let dataRetorno: Date
      if (isCustomDias) {
        dataRetorno = new Date(ano, mes - 1, dia, horaUltima || 10, minUltima || 0, 0)
        dataRetorno.setDate(dataRetorno.getDate() + (diasCustom as number))
      } else {
        dataRetorno = new Date(ano, (mes - 1) + (mesesPreset as number), dia, horaUltima || 10, minUltima || 0, 0)
      }

      let content = ''
      if (retornoTipo === 'exames') {
        const examesTexto = examesPreenchidos.length === 1
          ? examesPreenchidos[0]
          : examesPreenchidos.slice(0, -1).join(', ') + ' e ' + examesPreenchidos[examesPreenchidos.length - 1]
        content = `Olá, ${nome}! Sua última consulta foi no dia ${dataUltimaBR} e está na hora de realizar ${examesTexto}. Se desejar, podemos encaminhar a solicitação dos exames.`
        if (!isCustomDias && (mesesPreset as number) >= 12 && profissional) {
          content += ` Também já podemos agendar uma nova avaliação com o Dr(a). ${profissional}.`
        }
      } else if (retornoTipo === 'pos_operatorio') {
        const periodoLabel = isCustomDias
          ? (diasCustom === 1 ? '1º dia' : `${diasCustom}º dia`)
          : mesesLabel(mesesPreset as number)
        content = `Olá, ${nome}! Está na hora do seu retorno pós-operatório do ${periodoLabel}. Podemos agendar sua consulta de retorno?`
      } else {
        content = `Olá, ${nome}! Está na hora de uma nova consulta de rotina${profissional ? ` com o Dr(a). ${profissional}` : ''}. Deseja agendar?`
      }

      const { error: err } = await supabase.from('scheduled_messages').insert({
        contact_id: contact.id,
        content,
        scheduled_for: dataRetorno.toISOString(),
        status: 'scheduled',
        origin: 'retorno_followup',
        created_by: agent?.id ?? null,
      })
      if (err) { setRetornoError('Não foi possível agendar: ' + err.message); setSavingRetorno(false); return }
      setRetornoSalvo(true)
      setRetornoJaAgendado(true)
      setSavingRetorno(false)
      setTimeout(() => { setRetornoModalOpen(false); setRetornoSalvo(false); setRetornoExamesSelecionados([]) }, 1500)
    } catch (e: any) {
      setRetornoError('Erro ao agendar: ' + (e?.message || 'falha na conexão'))
      setSavingRetorno(false)
    }
  }

  // Badge de cobrança clicável (usado tanto no "próximo agendamento" quanto na lista "Outros").
  // É uma função que retorna JSX (não um componente React separado) de propósito: assim ela não
  // perde identidade/estado a cada re-render do MedXTab, o que quebraria o foco do textarea de
  // justificativa enquanto a pessoa digita.
  function renderCobrancaBadge(ag: any, key: string, size: 'md' | 'sm' = 'md') {
    const editing = editingCobrancaKey === key
    const editavel = !!ag.medx_agendamento_id
    return (
      <span className="relative inline-block align-middle">
        <button type="button" disabled={!editavel} onClick={(e) => { e.stopPropagation(); abrirEdicaoCobranca(ag, key) }}
          title={editavel ? 'Clique para corrigir' : undefined}
          className={clsx(
            size === 'md' ? 'ml-1 rounded-md border px-2 py-0.5 font-extrabold' : 'ml-1 rounded border px-1.5 py-0.5 font-bold',
            ag.cobranca === 'NÃO COBRAR'
              ? (size === 'md' ? 'bg-emerald-100 border-emerald-500 text-emerald-700' : 'bg-emerald-50 border-emerald-400 text-emerald-700')
              : (size === 'md' ? 'bg-red-100 border-red-500 text-red-700' : 'bg-red-50 border-red-400 text-red-700'),
            editavel && 'cursor-pointer hover:opacity-70')}>
          {ag.cobranca || 'COBRAR'}
        </button>
        {editing && (
          <div className="absolute z-20 top-full right-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-left normal-case" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-semibold text-slate-600 mb-2">Corrigir cobrança desta consulta</p>
            <div className="flex gap-1.5 mb-2">
              {(['COBRAR', 'NÃO COBRAR'] as const).map(v => (
                <button key={v} type="button" onClick={() => setEditCobrancaValue(v)}
                  className={clsx('flex-1 text-xs font-bold rounded-lg border px-2 py-1.5',
                    editCobrancaValue === v
                      ? (v === 'NÃO COBRAR' ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-red-500 border-red-500 text-white')
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50')}>
                  {v}
                </button>
              ))}
            </div>
            <textarea
              value={editCobrancaJustificativa}
              onChange={e => setEditCobrancaJustificativa(e.target.value)}
              placeholder="Motivo da alteração (ex: última consulta foi a cirurgia, esta é o retorno)"
              rows={2}
              className="w-full text-xs px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none mb-2"
            />
            {cobrancaSaveError && <p className="text-[11px] text-red-600 mb-2">{cobrancaSaveError}</p>}
            <div className="flex items-center justify-end gap-1.5">
              <button type="button" onClick={() => setEditingCobrancaKey(null)} disabled={savingCobranca}
                className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg">Cancelar</button>
              <button type="button" onClick={() => salvarCobranca(ag, key)} disabled={savingCobranca}
                className="text-xs text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-2.5 py-1 rounded-lg flex items-center gap-1">
                {savingCobranca && <Loader2 size={10} className="animate-spin"/>} Salvar
              </button>
            </div>
          </div>
        )}
      </span>
    )
  }

  // v48.166 — Badge de retorno clicável, igual à de cobrança acima (mesmo motivo:
  // preservar identidade entre re-renders pro textarea não perder o foco).
  function renderRetornoBadge(ag: any, key: string) {
    const editing = editingRetornoCorrecaoKey === key
    const editavel = !!ag.medx_agendamento_id
    return (
      <span className="relative inline-block align-middle">
        <button type="button" disabled={!editavel} onClick={(e) => { e.stopPropagation(); abrirEdicaoRetorno(ag, key) }}
          title={editavel ? 'Clique para corrigir' : undefined}
          className={clsx('hover:opacity-70', editavel && 'cursor-pointer underline decoration-dotted underline-offset-2')}>
          {ag.planoRetorno}
        </button>
        {editing && (
          <div className="absolute z-20 top-full right-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-left normal-case" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-semibold text-slate-600 mb-2">Corrigir retorno desta consulta</p>
            <div className="flex gap-1.5 mb-2">
              {(['Com retorno', 'Sem retorno'] as const).map(v => (
                <button key={v} type="button" onClick={() => setEditRetornoCorrecaoValue(v)}
                  className={clsx('flex-1 text-xs font-bold rounded-lg border px-2 py-1.5',
                    editRetornoCorrecaoValue === v ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50')}>
                  {v}
                </button>
              ))}
            </div>
            <textarea
              value={editRetornoCorrecaoJustificativa}
              onChange={e => setEditRetornoCorrecaoJustificativa(e.target.value)}
              placeholder="Motivo da alteração (ex: MedX diz com retorno, confirmado com o paciente)"
              rows={2}
              className="w-full text-xs px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none mb-2"
            />
            {retornoCorrecaoSaveError && <p className="text-[11px] text-red-600 mb-2">{retornoCorrecaoSaveError}</p>}
            <div className="flex items-center justify-end gap-1.5">
              <button type="button" onClick={() => setEditingRetornoCorrecaoKey(null)} disabled={savingRetornoCorrecao}
                className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg">Cancelar</button>
              <button type="button" onClick={() => salvarRetorno(ag, key)} disabled={savingRetornoCorrecao}
                className="text-xs text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-2.5 py-1 rounded-lg flex items-center gap-1">
                {savingRetornoCorrecao && <Loader2 size={10} className="animate-spin"/>} Salvar
              </button>
            </div>
          </div>
        )}
      </span>
    )
  }

  // v48.166 — Emoji de presencial/online, igual ao que já existe na Agenda Médica
  // (💻/📍), agora também no cadastro do paciente — pedido explícito do Jorge.
  function emojiModalidade(modalidade?: string | null) {
    if (modalidade === 'ONLINE') return '💻'
    if (modalidade === 'PRESENCIAL') return '📍'
    return null
  }

  return (
    <div>
      {/* v48.174 — Submenu Agenda/Prontuário, mesmo padrão de Recebidas/Enviadas
          em Anexos — Prontuário deixou de brigar por espaço na fileira de abas
          de cima. ProntuarioPanel já tem seu próprio px-5 py-5 (reaproveitado
          também fora daqui, na Agenda Médica), por isso este container não tem
          padding próprio — só o submenu, que precisa do respiro nas laterais. */}
      {podeVerProntuario && (
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mx-5 mt-5 mb-4">
          <button onClick={() => setMedxSubAba('agenda')}
            className={clsx('flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
              medxSubAba === 'agenda' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            Cadastro e agenda
          </button>
          <button onClick={() => setMedxSubAba('prontuario')}
            className={clsx('flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
              medxSubAba === 'prontuario' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            Prontuário
          </button>
        </div>
      )}

      {/* v48.175 — Sem acesso (ou "Cadastro e agenda" selecionado): mostra o
          cadastro/agenda normalmente. Isso soma com o gate de verdade, que é
          dentro do ProntuarioPanel — aqui é só pra não oferecer um botão que
          vai levar a "Acesso restrito". */}
      {medxSubAba === 'prontuario' && podeVerProntuario ? (
        <ProntuarioPanel key={contact.id} nome={contact.full_name} telefone={contact.phone} medxIdConhecido={contact.medx_id}/>
      ) : (
      <div className="px-5 pb-5">
      {!searched && !loading && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-12 h-12 bg-brand-50 rounded-xl flex items-center justify-center mb-3">
            <Stethoscope size={20} className="text-brand-500"/>
          </div>
          <p className="text-sm text-slate-600 font-medium mb-1">Histórico MedX</p>
          <p className="text-xs text-slate-400 mb-4 max-w-[220px]">Busque os dados cadastrais e agendamentos deste paciente no MedX</p>
          <button onClick={buscar}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg">
            <Stethoscope size={14}/> Buscar no MedX
          </button>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <Loader2 size={20} className="animate-spin mb-2"/>
          <p className="text-sm">Buscando no MedX...</p>
        </div>
      )}

      {error && (
        <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle size={14}/>{error}
        </div>
      )}

      {retornoAvisoSemConsulta && (
        <div className="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs flex items-center justify-between gap-2">
          <span>Não há última consulta registrada pra este paciente — não dá pra agendar a msg de retorno sem uma consulta anterior como base.</span>
          <button onClick={() => setRetornoAvisoSemConsulta(false)} className="text-amber-400 hover:text-amber-600 leading-none flex-shrink-0">✕</button>
        </div>
      )}

      {searched && data && !loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Dados MedX</p>
            <button onClick={buscar} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400" title="Atualizar"><RefreshCw size={13}/></button>
          </div>

          <div>
            <button onClick={sincronizarAgendamentosAgora} disabled={sincronizando}
              className="text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-60">
              <RefreshCw size={13} className={sincronizando ? 'animate-spin' : ''}/>
              {sincronizando ? 'Sincronizando...' : 'Sincronizar agendamentos agora'}
            </button>
            <p className="text-[11px] text-slate-400 mt-1">Força agora a sincronização MedX → Agendamentos que normalmente roda sozinha a cada 15 min.</p>
            {sincronizarMsg && (
              <div className="mt-1.5 px-2.5 py-1.5 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs flex items-center gap-1.5">
                <CheckCircle2 size={13}/>{sincronizarMsg}
              </div>
            )}
            {sincronizarErro && (
              <div className="mt-1.5 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs flex items-center gap-1.5">
                <AlertCircle size={13}/>{sincronizarErro}
              </div>
            )}
          </div>

          <div>
            <button onClick={abrirAgendar}
              className="text-xs text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
              <CalendarClock size={13}/> {agendarOpen ? 'Fechar' : 'Agendar nova consulta'}
            </button>
            {agendarOpen && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Tipo de consulta</label>
                <div className="flex gap-2 mb-2">
                  {[{ v: false, label: 'Consulta (paga)' }, { v: true, label: 'Retorno' }].map(o => (
                    <button key={String(o.v)} type="button" onClick={() => setAgendarEhRetorno(o.v)}
                      className={clsx('flex-1 py-1.5 text-xs font-semibold rounded-lg border-2 transition-colors',
                        agendarEhRetorno === o.v ? 'bg-brand-50 border-brand-500 text-brand-700' : 'bg-white border-slate-200 text-slate-400')}>
                      {o.label}
                    </button>
                  ))}
                </div>
                {!agendarEhRetorno && (
                  <>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Modalidade da consulta paga</label>
                    <div className="flex gap-2 mb-2">
                      {[{ v: true, label: 'Com retorno' }, { v: false, label: 'Sem retorno' }].map(o => (
                        <button key={String(o.v)} type="button" onClick={() => setAgendarTemRetorno(o.v)}
                          className={clsx('flex-1 py-1.5 text-xs font-semibold rounded-lg border-2 transition-colors',
                            agendarTemRetorno === o.v ? 'bg-brand-50 border-brand-500 text-brand-700' : 'bg-white border-slate-200 text-slate-400')}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className={clsx('mb-2 rounded-lg border-2 px-3 py-2 text-center',
                  agendarCobranca === 'NÃO COBRAR' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-red-50 border-red-500 text-red-700')}>
                  <p className="text-sm font-extrabold tracking-wide">
                    {verificandoCobranca ? 'VERIFICANDO COBRANÇA...' : agendarCobranca}
                  </p>
                  {!verificandoCobranca && <p className="text-[10px] mt-0.5">{cobrancaDetalhe}</p>}
                </div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Modalidade</label>
                <div className="flex gap-2 mb-2">
                  {['Presencial', 'Online'].map(modalidade => (
                    <button key={modalidade} type="button" onClick={() => setAgendarModalidade(modalidade)}
                      className={clsx('flex-1 py-1.5 text-xs font-semibold rounded-lg border-2 transition-colors',
                        agendarModalidade === modalidade ? 'bg-brand-50 border-brand-500 text-brand-700' : 'bg-white border-slate-200 text-slate-400')}>
                      {modalidade}
                    </button>
                  ))}
                </div>
                <RemarcarPicker
                  professionals={professionals}
                  profId={agendarProfId} onProfId={setAgendarProfId}
                  data={agendarData} onData={setAgendarData}
                  slots={agendarSlots} loading={loadingAgendarSlots}
                  remarcando={agendandoSlotId} error={agendarError}
                  onPick={(slot) => setAgendarSlotSelecionado(slot)}
                  selectedSlotId={agendarSlotSelecionado?.slot_id || null}
                  onClose={() => setAgendarOpen(false)}
                />
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Horário avulso</label>
                  <div className="flex gap-2">
                    <input type="time" value={agendarHoraAvulsa} onChange={e => setAgendarHoraAvulsa(e.target.value)}
                      className="min-w-0 flex-1 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                    <button type="button" onClick={selecionarConsultaAvulsa}
                      disabled={Boolean(agendandoSlotId) || verificandoCobranca || !agendarProfId || !agendarData || !agendarHoraAvulsa}
                      className="px-3 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">
                      Usar horário
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Uso exclusivo da equipe; este horário não será oferecido pela Sofia.</p>
                </div>
                {agendarSlotSelecionado && (
                  <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
                    <p className="text-xs text-brand-700">Selecionado: <strong>{(agendarSlotSelecionado.hora_inicio || '').slice(0, 5)}</strong></p>
                  </div>
                )}
                <button type="button" onClick={() => agendarSlotSelecionado && agendarConsulta(agendarSlotSelecionado)}
                  disabled={!agendarSlotSelecionado || Boolean(agendandoSlotId) || verificandoCobranca}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
                  {agendandoSlotId ? <Loader2 size={14} className="animate-spin"/> : <CalendarClock size={14}/>} {agendandoSlotId ? 'Agendando...' : 'Agendar'}
                </button>
              </div>
            )}
          </div>

          {!data.encontrado ? (
            <div className="px-3 py-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
              Paciente não encontrado no MedX.
            </div>
          ) : (
            <>
              {/* Cabeçalho: ID + Nome */}
              <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                {data.medx_id && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700">MedX</span>
                    <span className="text-xs text-slate-400">ID {data.medx_id}</span>
                  </div>
                )}
                {data.nome && <InfoRow icon={<UserIcon size={13}/>} label="Nome" value={data.nome}/>}
                {data.nome_social && <InfoRow icon={<UserIcon size={13}/>} label="Social" value={data.nome_social}/>}
                {data.cpf && <InfoRow icon={<CreditCard size={13}/>} label="CPF" value={data.cpf}/>}
                {data.sexo && <InfoRow icon={<UserIcon size={13}/>} label="Sexo" value={data.sexo}/>}
              </div>

              {/* Próximo agendamento em destaque */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Próximo agendamento</p>
                {cancelError && (
                  <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 mb-2">
                    <AlertTriangle size={13} className="text-red-500 flex-shrink-0"/>
                    <span className="text-xs text-red-700 flex-1">{cancelError}</span>
                    <button onClick={() => setCancelError('')} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                  </div>
                )}
                {confirmError && (
                  <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 mb-2">
                    <AlertTriangle size={13} className="text-red-500 flex-shrink-0"/>
                    <span className="text-xs text-red-700 flex-1">{confirmError}</span>
                    <button onClick={() => setConfirmError('')} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                  </div>
                )}
                {(!data.agendamentos || data.agendamentos.length === 0) ? (
                  <p className="text-sm text-slate-400 py-2">Nenhum agendamento futuro</p>
                ) : (
                  <>
                    <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 mb-2">
                      <div className="flex items-center gap-2 mb-1">
                        <CalendarClock size={15} className="text-brand-600"/>
                        <span className="text-sm font-semibold text-brand-800">
                          {formatDataBR(data.agendamentos[0].data)}{data.agendamentos[0].hora ? ` às ${formatHoraBR(data.agendamentos[0].hora)}` : ''}
                        </span>
                        {data.agendamentos[0].medx_agendamento_id && confirmacoesAgendadasIds.has(data.agendamentos[0].medx_agendamento_id) && (
                          <span title="Mensagem de confirmação da consulta já agendada" className="text-xs" aria-label="Confirmação já agendada">✉️</span>
                        )}
                        {data.agendamentos[0].medx_agendamento_id && pacienteConfirmouEm.has(data.agendamentos[0].medx_agendamento_id) && (
                          <span title={`Paciente confirmou em ${formatDataBR(pacienteConfirmouEm.get(data.agendamentos[0].medx_agendamento_id)!.slice(0,10))} ${formatHoraBR(pacienteConfirmouEm.get(data.agendamentos[0].medx_agendamento_id)!.slice(11,16))}`}
                            className="text-[11px] font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5">
                            Confirmado pelo paciente ✓
                          </span>
                        )}
                        {data.agendamentos[0].medx_agendamento_id && pacienteRecusouEm.has(data.agendamentos[0].medx_agendamento_id) && (
                          <span title={`Paciente avisou que não poderá comparecer em ${formatDataBR(pacienteRecusouEm.get(data.agendamentos[0].medx_agendamento_id)!.slice(0,10))} ${formatHoraBR(pacienteRecusouEm.get(data.agendamentos[0].medx_agendamento_id)!.slice(11,16))}`}
                            className="text-[11px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                            Paciente não poderá comparecer
                          </span>
                        )}
                      </div>
                      <div className="ml-6 flex flex-wrap items-center gap-1.5 text-xs text-brand-700">
                        {data.agendamentos[0].especialidade && <span>{data.agendamentos[0].especialidade}</span>}
                        {data.agendamentos[0].modalidade && (
                          <>
                            <span>·</span>
                            <span className="font-semibold flex items-center gap-1">
                              {emojiModalidade(data.agendamentos[0].modalidade) && <span>{emojiModalidade(data.agendamentos[0].modalidade)}</span>}
                              {data.agendamentos[0].modalidade}
                            </span>
                          </>
                        )}
                        {data.agendamentos[0].planoRetorno && <><span>·</span>{renderRetornoBadge(data.agendamentos[0], 'principal-retorno')}</>}
                        {renderCobrancaBadge(data.agendamentos[0], 'principal')}
                      </div>
                      {data.agendamentos[0].cobrancaJustificativa && (
                        <p className="text-[11px] text-slate-400 ml-6 mt-0.5">
                          Cobrança alterada{data.agendamentos[0].cobrancaAlteradoPor ? ` por ${data.agendamentos[0].cobrancaAlteradoPor}` : ''}
                          {data.agendamentos[0].cobrancaAlteradoEm ? ` em ${formatDataBR(data.agendamentos[0].cobrancaAlteradoEm.slice(0,10))} ${formatHoraBR(data.agendamentos[0].cobrancaAlteradoEm.slice(11,16))}` : ''}: “{data.agendamentos[0].cobrancaJustificativa}”
                        </p>
                      )}
                      {data.agendamentos[0].retornoJustificativa && (
                        <p className="text-[11px] text-slate-400 ml-6 mt-0.5">
                          Retorno alterado{data.agendamentos[0].retornoAlteradoPor ? ` por ${data.agendamentos[0].retornoAlteradoPor}` : ''}
                          {data.agendamentos[0].retornoAlteradoEm ? ` em ${formatDataBR(data.agendamentos[0].retornoAlteradoEm.slice(0,10))} ${formatHoraBR(data.agendamentos[0].retornoAlteradoEm.slice(11,16))}` : ''}: “{data.agendamentos[0].retornoJustificativa}”
                        </p>
                      )}
                      {data.agendamentos[0].profissional && <p className="text-xs text-slate-500 ml-6">{data.agendamentos[0].profissional}</p>}

                      {confirmCancelKey === 'principal' ? (
                        <div className="flex items-center gap-1.5 mt-2 ml-6">
                          <span className="text-xs text-brand-700">Cancelar esta consulta?</span>
                          <button onClick={() => setConfirmCancelKey(null)} className="text-xs text-slate-500 hover:text-slate-700 px-1.5 py-0.5">Não</button>
                          <button onClick={() => cancelarAgendamento(data.agendamentos![0], 'principal')} disabled={cancelingKey === 'principal'}
                            className="text-xs text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded-md flex items-center gap-1 disabled:opacity-50">
                            {cancelingKey === 'principal' ? <Loader2 size={10} className="animate-spin"/> : <Trash2 size={10}/>}
                            Sim, cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-1.5 ml-6">
                          <button onClick={() => setConfirmCancelKey('principal')}
                            className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg flex items-center gap-1">
                            <Trash2 size={11}/> Cancelar consulta
                          </button>
                          <button onClick={() => abrirRemarcar(data.agendamentos![0], 'principal')}
                            className="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-100 px-2 py-1 rounded-lg flex items-center gap-1">
                            <CalendarClock size={11}/> Remarcar
                          </button>
                          <button onClick={() => reenviarConfirmacao(data.agendamentos![0], 'principal')} disabled={confirmingKey === 'principal'}
                            className="text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50">
                            {confirmingKey === 'principal' ? <Loader2 size={11} className="animate-spin"/> : <Send size={11}/>}
                            {confirmSuccessKey === 'principal' ? 'Confirmação agendada!' : 'Reenviar confirmação'}
                          </button>
                        </div>
                      )}
                      {remarcarKey === 'principal' && (
                        <RemarcarPicker
                          professionals={professionals}
                          profId={remarcarProfId} onProfId={setRemarcarProfId}
                          data={remarcarData} onData={setRemarcarData}
                          slots={slotsDisponiveis} loading={loadingSlots}
                          remarcando={remarcandoSlotId} error={remarcarError}
                          onPick={(slot) => remarcarAgendamento(data.agendamentos![0], slot)}
                          onClose={() => setRemarcarKey(null)}
                        />
                      )}
                    </div>

                    {/* Demais agendamentos */}
                    {data.agendamentos.length > 1 && (
                      <div className="space-y-1.5">
                        <p className="text-xs text-slate-400">Outros ({data.agendamentos.length - 1})</p>
                        {data.agendamentos.slice(1).map((ag, i) => {
                          const key = `outro-${i}`
                          return (
                            <div key={i} className="bg-white border border-slate-100 rounded-lg px-3 py-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-600 flex items-center gap-1.5">
                                  {formatDataBR(ag.data)}{ag.hora ? ` às ${formatHoraBR(ag.hora)}` : ''}
                                  {ag.medx_agendamento_id && confirmacoesAgendadasIds.has(ag.medx_agendamento_id) && (
                                    <span title="Mensagem de confirmação da consulta já agendada" className="text-xs" aria-label="Confirmação já agendada">✉️</span>
                                  )}
                                  {ag.medx_agendamento_id && pacienteConfirmouEm.has(ag.medx_agendamento_id) && (
                                    <span title="Paciente confirmou pelo link" className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-1.5 py-0.5">Confirmado ✓</span>
                                  )}
                                  {ag.medx_agendamento_id && pacienteRecusouEm.has(ag.medx_agendamento_id) && (
                                    <span title="Paciente avisou que não poderá comparecer" className="text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-1.5 py-0.5">Não poderá comparecer</span>
                                  )}
                                </span>
                                <div className="flex items-center gap-2">
                                  {ag.status && <span className="text-xs text-slate-400">{ag.status}</span>}
                                  {confirmCancelKey !== key && (
                                    <button onClick={() => setConfirmCancelKey(key)}
                                      className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                                      <Trash2 size={10}/> Cancelar
                                    </button>
                                  )}
                                  {remarcarKey !== key && (
                                    <button onClick={() => abrirRemarcar(ag, key)}
                                      className="text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-100 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                                      <CalendarClock size={10}/> Remarcar
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                                {ag.especialidade && <span>{ag.especialidade}</span>}
                                {ag.modalidade && (
                                  <>
                                    <span>·</span>
                                    <span className="font-semibold flex items-center gap-1">
                                      {emojiModalidade(ag.modalidade) && <span>{emojiModalidade(ag.modalidade)}</span>}
                                      {ag.modalidade}
                                    </span>
                                  </>
                                )}
                                {ag.planoRetorno && <><span>·</span>{renderRetornoBadge(ag, `${key}-retorno`)}</>}
                                {renderCobrancaBadge(ag, key, 'sm')}
                              </div>
                              {ag.cobrancaJustificativa && (
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  Cobrança alterada{ag.cobrancaAlteradoPor ? ` por ${ag.cobrancaAlteradoPor}` : ''}: “{ag.cobrancaJustificativa}”
                                </p>
                              )}
                              {ag.retornoJustificativa && (
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  Retorno alterado{ag.retornoAlteradoPor ? ` por ${ag.retornoAlteradoPor}` : ''}: “{ag.retornoJustificativa}”
                                </p>
                              )}
                              {confirmCancelKey === key && (
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  <span className="text-xs text-slate-600">Cancelar esta consulta?</span>
                                  <button onClick={() => setConfirmCancelKey(null)} className="text-xs text-slate-500 hover:text-slate-700 px-1.5 py-0.5">Não</button>
                                  <button onClick={() => cancelarAgendamento(ag, key)} disabled={cancelingKey === key}
                                    className="text-xs text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded-md flex items-center gap-1 disabled:opacity-50">
                                    {cancelingKey === key ? <Loader2 size={10} className="animate-spin"/> : <Trash2 size={10}/>}
                                    Sim, cancelar
                                  </button>
                                </div>
                              )}
                              {remarcarKey === key && (
                                <RemarcarPicker
                                  professionals={professionals}
                                  profId={remarcarProfId} onProfId={setRemarcarProfId}
                                  data={remarcarData} onData={setRemarcarData}
                                  slots={slotsDisponiveis} loading={loadingSlots}
                                  remarcando={remarcandoSlotId} error={remarcarError}
                                  onPick={(slot) => remarcarAgendamento(ag, slot)}
                                  onClose={() => setRemarcarKey(null)}
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Última consulta realizada (aba "realizadas") */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Última consulta</p>
                {!data.ultimaConsulta ? (
                  <p className="text-sm text-slate-400 py-2">Nenhuma consulta anterior registrada</p>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                    {/* O selo de cobranca dividia a linha com o aviso azul "mensagem de retorno
                        agendada", que e largo e empurrava o verde pra fora da tela. Agora o selo
                        de cobranca fica logo ao lado da data e o aviso azul desce pra linha
                        de baixo, onde tem espaco pra ele inteiro. */}
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-1">
                      <CalendarClock size={15} className="text-slate-500 flex-shrink-0"/>
                      <span className="text-sm font-semibold text-slate-700">
                        {formatDataBR(data.ultimaConsulta.data)}{data.ultimaConsulta.hora ? ` às ${formatHoraBR(data.ultimaConsulta.hora)}` : ''}
                      </span>
                      {(() => {
                        const r = (data.ultimaConsulta?.retorno || '').toUpperCase()
                        if (r === 'SIM') return (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                            Retorno (não pago)
                          </span>
                        )
                        if (r === 'NAO') return (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                            Consulta (paga)
                          </span>
                        )
                        return (
                          <span title="O MedX não informou se esta consulta foi cobrada ou foi retorno" className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500 border border-slate-200 whitespace-nowrap">
                            Cobrança não informada
                          </span>
                        )
                      })()}
                    </div>
                    {retornoJaAgendado && (
                      <div className="ml-6 mb-1">
                        <span title="Mensagem de retorno já agendada para este paciente" className="inline-block text-[11px] font-semibold text-sky-700 bg-sky-100 border border-sky-200 rounded-full px-2 py-0.5">
                          ✉️ Mensagem de retorno agendada
                        </span>
                      </div>
                    )}
                    {data.ultimaConsulta.procedimento && <p className="text-xs text-slate-600 ml-6">{data.ultimaConsulta.procedimento}</p>}
                    {data.ultimaConsulta.profissional && <p className="text-xs text-slate-500 ml-6">{data.ultimaConsulta.profissional}</p>}
                    {data.ultimaConsulta.comRetorno && (
                      <p className="text-xs text-slate-400 ml-6 mt-0.5">Modalidade da consulta: {data.ultimaConsulta.comRetorno}</p>
                    )}
                    <button onClick={abrirRetornoModal}
                      className="mt-2 ml-6 text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded-lg flex items-center gap-1">
                      📅 Agendar msg de retorno
                    </button>
                  </div>
                )}
              </div>

              {retornoModalOpen && data.ultimaConsulta && (
                <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4" onClick={() => !savingRetorno && setRetornoModalOpen(false)}>
                  <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-slate-800">📅 Agendar msg de retorno</p>
                      <button onClick={() => !savingRetorno && setRetornoModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
                    </div>

                    {retornoSalvo ? (
                      <div className="flex items-center gap-2 text-emerald-600 text-sm py-4">
                        <CheckCircle2 size={16}/> Mensagem de retorno agendada!
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-slate-500 mb-3">
                          A partir da última consulta ({formatDataBR(data.ultimaConsulta.data)}), quando o paciente deve retornar?
                        </p>

                        <p className="text-xs font-medium text-slate-600 mb-1">Período de retorno</p>
                        <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                          {[{ v: '1', label: '1 mês' }, { v: '3', label: '3 meses' }, { v: '6', label: '6 meses' }, { v: '12', label: '1 ano' }, { v: 'custom', label: 'Outro' }].map(o => (
                            <button key={o.v} type="button" onClick={() => setRetornoPeriodo(o.v as any)}
                              className={clsx('px-1.5 py-1.5 rounded-lg border text-xs font-medium',
                                retornoPeriodo === o.v ? 'bg-brand-50 border-brand-500 text-brand-700' : 'bg-white border-slate-200 text-slate-500')}>
                              {o.label}
                            </button>
                          ))}
                        </div>
                        {retornoPeriodo === 'custom' && (
                          <div className="flex items-center gap-1.5 mb-3">
                            <input type="number" min="1" value={retornoPeriodoCustom}
                              onChange={e => setRetornoPeriodoCustom(e.target.value)}
                              placeholder="Ex: 5"
                              className="w-24 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5"/>
                            <span className="text-xs text-slate-500">dias a partir da última consulta</span>
                          </div>
                        )}
                        {retornoPeriodo !== 'custom' && <div className="mb-3"/>}

                        <p className="text-xs font-medium text-slate-600 mb-1">O que envolve</p>
                        <div className="flex flex-col gap-1.5 mb-3">
                          {[
                            { v: 'exames', label: 'Exames (até 5)' },
                            { v: 'pos_operatorio', label: 'Pós-operatório' },
                            { v: 'nada', label: 'Rotina (nada marcado)' },
                          ].map(o => (
                            <button key={o.v} type="button" onClick={() => setRetornoTipo(o.v as any)}
                              className={clsx('px-3 py-1.5 rounded-lg border text-xs font-medium text-left',
                                retornoTipo === o.v ? 'bg-brand-50 border-brand-500 text-brand-700' : 'bg-white border-slate-200 text-slate-600')}>
                              {o.label}
                            </button>
                          ))}
                        </div>

                        {retornoTipo === 'exames' && (
                          <div className="mb-3">
                            <p className="text-xs text-slate-400 mb-1.5">Selecione (até 5) ou cadastre um novo:</p>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {examesCatalogo.length === 0 && (
                                <p className="text-xs text-slate-400 italic">Nenhum exame cadastrado ainda — cadastre abaixo.</p>
                              )}
                              {examesCatalogo.map(ex => {
                                const selecionado = retornoExamesSelecionados.includes(ex.nome)
                                return (
                                  <span key={ex.id}
                                    className={clsx('flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full border text-xs font-medium',
                                      selecionado ? 'bg-brand-50 border-brand-500 text-brand-700' : 'bg-white border-slate-200 text-slate-600')}>
                                    <button type="button" onClick={() => toggleExameSelecionado(ex.nome)}>
                                      {selecionado ? '✓ ' : ''}{ex.nome}
                                    </button>
                                    <button type="button" onClick={() => excluirExameCatalogo(ex.id, ex.nome)}
                                      title="Excluir do catálogo"
                                      className="text-slate-300 hover:text-red-500 leading-none px-0.5">✕</button>
                                  </span>
                                )
                              })}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <input value={novoExameNome} onChange={e => setNovoExameNome(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarExameCatalogo() } }}
                                placeholder="Novo exame (ex: Endoscopia)"
                                className="flex-1 min-w-0 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5"/>
                              <button type="button" onClick={adicionarExameCatalogo} disabled={savingNovoExame || !novoExameNome.trim()}
                                className="text-xs bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1">
                                {savingNovoExame ? <Loader2 size={12} className="animate-spin"/> : null}
                                + cadastrar
                              </button>
                            </div>
                          </div>
                        )}

                        {retornoError && <p className="text-xs text-red-600 mb-2">{retornoError}</p>}

                        <button onClick={agendarMsgRetorno} disabled={savingRetorno}
                          className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50">
                          {savingRetorno ? <Loader2 size={14} className="animate-spin"/> : null}
                          Agendar mensagem
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
      )}
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400">{icon}</span>
      <span className="text-xs text-slate-400 w-16 flex-shrink-0">{label}</span>
      <span className="text-sm text-slate-700 truncate">{value}</span>
    </div>
  )
}

// v48.156 — Pedido do Jorge: no popup nativo do <input type="date">, todo dia
// aparece igualmente clicável, sem indicar quais o profissional escolhido
// realmente tem horário livre — obrigava a ir tentando data por data. Este
// seletor troca o input nativo por um calendário próprio que já mostra os
// dias com vaga (bolinha verde) no mês visível, "ajuda a ir direto no dia".
// Usado dentro de RemarcarPicker, que por sua vez atende tanto a Remarcação
// quanto o "Agendar nova consulta" (aba MedX) — um só lugar cobre os dois.
const DIAS_SEMANA_CURTO = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

// Mesmo cuidado do fmtDataStr em app/agenda-medica/page.tsx: usar
// date-fns `format` (que opera nos componentes locais da data) em vez de
// `.toISOString()`, que converte pra UTC e pode voltar um dia em fusos
// negativos como o do Brasil.
function fmtDataYMD(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

function SeletorDataProfissional({ profId, value, onChange }: {
  profId: string
  value: string
  onChange: (d: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [mesVisivel, setMesVisivel] = useState(() => {
    if (value) {
      const [ano, mes] = value.split('-').map(Number)
      return new Date(ano, mes - 1, 1)
    }
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  })
  const [diasDisponiveis, setDiasDisponiveis] = useState<Set<string>>(new Set())
  const [carregandoDias, setCarregandoDias] = useState(false)
  const caixaRef = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora ou apertar Esc — mesmo padrão de
  // components/cirurgias/MedicamentosCirurgia.tsx (caixaNovoNome/sugestoesAbertas).
  useEffect(() => {
    function aoClicarFora(e: MouseEvent) {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false)
    }
    function aoTeclarEsc(e: KeyboardEvent) { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclarEsc)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclarEsc)
    }
  }, [])

  // Ao abrir com uma data já selecionada, mostra o mês dela em vez do mês
  // corrente (ex: reabrir pra ajustar uma consulta remarcada pra daqui a
  // 2 meses não devia forçar o usuário a navegar até lá de novo).
  useEffect(() => {
    if (!aberto || !value) return
    const [ano, mes] = value.split('-').map(Number)
    setMesVisivel(new Date(ano, mes - 1, 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  // Busca os dias do mês visível com vaga pro profissional escolhido.
  // Refaz ao trocar profissional, trocar de mês ou abrir o popover; não busca
  // fechado/sem profissional (o calendário some, não trava).
  useEffect(() => {
    if (!aberto || !profId) { setDiasDisponiveis(new Set()); return }
    let cancelled = false
    setCarregandoDias(true)
    const primeiroDia = fmtDataYMD(mesVisivel)
    const ultimoDia = fmtDataYMD(new Date(mesVisivel.getFullYear(), mesVisivel.getMonth() + 1, 0))
    supabase.from('agenda_slots').select('data')
      .eq('professional_id', profId)
      .eq('disponivel', true)
      .eq('bloqueado', false)
      .gte('data', primeiroDia)
      .lte('data', ultimoDia)
      .then(({ data }) => {
        if (cancelled) return
        setDiasDisponiveis(new Set((data ?? []).map((r: any) => r.data as string)))
        setCarregandoDias(false)
      })
    return () => { cancelled = true }
  }, [aberto, profId, mesVisivel])

  const hojeStr = fmtDataYMD(new Date())

  const celulas = useMemo(() => {
    const ano = mesVisivel.getFullYear()
    const mes = mesVisivel.getMonth()
    const primeiroDiaSemana = new Date(ano, mes, 1).getDay()
    const totalDias = new Date(ano, mes + 1, 0).getDate()
    const lista: (string | null)[] = []
    for (let i = 0; i < primeiroDiaSemana; i++) lista.push(null)
    for (let dia = 1; dia <= totalDias; dia++) lista.push(fmtDataYMD(new Date(ano, mes, dia)))
    return lista
  }, [mesVisivel])

  function selecionarDia(diaStr: string) {
    if (diaStr < hojeStr) return
    onChange(diaStr)
    setAberto(false)
  }

  // "T00:00:00" evita que o parse de "yyyy-MM-dd" caia em UTC meia-noite e
  // exiba o dia anterior em fusos negativos.
  const rotulo = value ? format(new Date(value + 'T00:00:00'), 'dd/MM/yyyy') : 'Selecionar data'

  return (
    <div className="relative" ref={caixaRef}>
      <button type="button" onClick={() => setAberto(v => !v)}
        className={clsx('text-xs border border-slate-200 rounded-md px-2 py-1 whitespace-nowrap',
          value ? 'text-slate-700' : 'text-slate-400')}>
        {rotulo}
      </button>
      {aberto && (
        <div className="absolute z-20 mt-1 right-0 bg-white border border-slate-200 rounded-lg shadow-lg p-2 w-60">
          <div className="flex items-center justify-between mb-1.5">
            <button type="button" onClick={() => setMesVisivel(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded hover:bg-slate-100">‹</button>
            <span className="text-xs font-semibold text-slate-600 capitalize">
              {format(mesVisivel, 'MMMM yyyy', { locale: ptBR })}
            </span>
            <button type="button" onClick={() => setMesVisivel(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded hover:bg-slate-100">›</button>
          </div>
          {!profId && (
            <p className="text-[10px] text-slate-400 mb-1">Selecione o profissional para ver os dias livres.</p>
          )}
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DIAS_SEMANA_CURTO.map((d, i) => (
              <span key={i} className="text-[10px] text-slate-400 py-0.5">{d}</span>
            ))}
            {carregandoDias ? (
              <div className="col-span-7 flex items-center justify-center py-4">
                <Loader2 size={14} className="animate-spin text-slate-300"/>
              </div>
            ) : celulas.map((diaStr, i) => {
              if (!diaStr) return <span key={i}/>
              const passado = diaStr < hojeStr
              const disponivel = diasDisponiveis.has(diaStr)
              const selecionado = diaStr === value
              return (
                <button key={i} type="button" disabled={passado} onClick={() => selecionarDia(diaStr)}
                  className={clsx('relative text-[11px] rounded-md py-1 leading-none',
                    passado ? 'text-slate-300 cursor-not-allowed' :
                    selecionado ? 'bg-brand-500 text-white font-semibold' :
                    disponivel ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' :
                    'text-slate-500 hover:bg-slate-100')}>
                  {Number(diaStr.slice(8, 10))}
                  {disponivel && !selecionado && (
                    <span className="absolute left-1/2 -translate-x-1/2 bottom-0.5 w-1 h-1 rounded-full bg-emerald-500"/>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function RemarcarPicker({ professionals, profId, onProfId, data, onData, slots, loading, remarcando, error, onPick, onClose, selectedSlotId }: {
  professionals: Professional[]
  profId: string
  onProfId: (id: string) => void
  data: string
  onData: (d: string) => void
  slots: any[]
  loading: boolean
  remarcando: string | null
  error: string
  onPick: (slot: any) => void
  onClose: () => void
  selectedSlotId?: string | null
}) {
  return (
    <div className="mt-2 ml-6 bg-white border border-slate-200 rounded-lg p-3 space-y-2">
      {error && (
        <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
          <AlertTriangle size={13} className="text-red-500 flex-shrink-0"/>
          <span className="text-xs text-red-700 flex-1">{error}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <select value={profId} onChange={e => onProfId(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1 flex-1 min-w-0">
          <option value="">Selecione o profissional</option>
          {professionals.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <SeletorDataProfissional profId={profId} value={data} onChange={onData}/>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 px-1">✕</button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
          <Loader2 size={12} className="animate-spin"/> Buscando horários...
        </div>
      ) : (!profId || !data) ? (
        // v48.155 — a mensagem dizia sempre "Selecione profissional e data.", mesmo
        // quando só um dos dois faltava (ex: profissional já escolhido, falta só a
        // data). Isso fazia parecer que a seleção do profissional nem tinha sido
        // registrada ("Jorge escolheu JOÃO JORGE e mesmo assim aparecia como se nada
        // tivesse sido selecionado"). Agora aponta exatamente o que falta.
        <p className="text-xs text-slate-400 py-1">
          {!profId && !data ? 'Selecione profissional e data.' : !profId ? 'Selecione o profissional.' : 'Selecione a data.'}
        </p>
      ) : slots.length === 0 ? (
        <p className="text-xs text-slate-400 py-1">Nenhum horário disponível nesta data.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {slots.map(s => (
            <button key={s.slot_id} disabled={!!remarcando} onClick={() => onPick(s)}
              className={clsx('text-xs px-2 py-1 rounded-md border hover:bg-emerald-100 disabled:opacity-50 flex items-center gap-1',
                selectedSlotId === s.slot_id ? 'border-brand-500 bg-brand-100 text-brand-800 ring-1 ring-brand-400' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
              {remarcando === s.slot_id && <Loader2 size={10} className="animate-spin"/>}
              {(s.hora_inicio || '').slice(0, 5)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
