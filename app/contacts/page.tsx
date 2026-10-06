'use client'
import { useEffect, useState, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Contact } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import ContactDetailModal from '@/components/ContactDetailModal'
import AssignModal from '@/components/AssignModal'
import ConflictModal from '@/components/ConflictModal'
import ContactHistoryModal from '@/components/ContactHistoryModal'
import ChannelBadge from '@/components/ChannelBadge'
import InstagramIcon from '@/components/icons/InstagramIcon'
import CopiarTexto from '@/components/CopiarTexto'
import { psidDoContato, ehSomenteInstagram } from '@/lib/instagram'
import { semAcento, contemTermo } from '@/lib/texto'
import {
  estaBloqueado, bloquearContato, desbloquearContato,
  canaisBloqueados, NOME_DO_CANAL, type CanalBloqueio,
} from '@/lib/bloqueio'
import EscolherCanaisBloqueio from '@/components/EscolherCanaisBloqueio'
import {
  montarAtendimentos, textoAtendimento, tituloAtendimento, type SituacaoAtendimento,
} from '@/lib/atendimentoDoContato'
import NewContactModal from '@/components/NewContactModal'
import ContactAvatar from '@/components/ContactAvatar'
import {
  Search, Upload, Plus, Phone, Mail, Tag, MessageSquare,
  X, FileText, Link as LinkIcon, Loader2, CheckCircle2, AlertCircle, UserPlus, Pencil, Trash2, Ban, ShieldCheck,
  Headphones
} from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'

type SortKey = 'name' | 'last_contacted'

export default function ContactsPage() {
  const router = useRouter()
  const { agent } = useAuth()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')  // v48.57 — padrão: ordem alfabética
  const [showImport, setShowImport] = useState(false)
  const [detailContact, setDetailContact] = useState<Contact | null>(null)
  const [detailEditMode, setDetailEditMode] = useState(false)
  const [assignContact, setAssignContact] = useState<Contact | null>(null)
  const [historyContact, setHistoryContact] = useState<Contact | null>(null)
  const [conflictContact, setConflictContact] = useState<Contact | null>(null)
  const [conflictAgentName, setConflictAgentName] = useState('')
  const [conflictAgentId, setConflictAgentId] = useState('')
  const [adminJoinPrompt, setAdminJoinPrompt] = useState<{ contact: Contact; currentAgentName: string } | null>(null)
  const [adminJoining, setAdminJoining] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null)
  const [showNewContact, setShowNewContact] = useState(false)
  // 'todos' | 'bloqueados' | 'ativos'
  const [filtroBloqueio, setFiltroBloqueio] = useState<'todos' | 'ativos' | 'bloqueados'>('todos')
  const [mudandoBloqueio, setMudandoBloqueio] = useState<string | null>(null)
  // v48.34 — o contato cujo bloqueio está sendo escolhido por canal
  const [bloqueioAberto, setBloqueioAberto] = useState<Contact | null>(null)
  // v48.30 — Quem está atendendo cada contato, para a lista mostrar antes do clique.
  const [atendimentos, setAtendimentos] = useState<Record<string, SituacaoAtendimento>>({})
  const [filtroAtendimento, setFiltroAtendimento] = useState<'todos' | 'ativo' | 'fila'>('todos')

  useEffect(() => { loadContacts() }, [])

  async function loadContacts() {
    setLoading(true)
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .order('last_contacted_at', { ascending: false, nullsFirst: false })
      // A busca acontece sobre o que está carregado. Com 500, quem não conversa
      // há muito tempo ficava de fora da busca — e é justamente esse que se
      // procura pelo nome.
      .limit(2000)
    setContacts(data ?? [])
    setLoading(false)

    // Quem atende quem. Vem depois da lista de propósito: os contatos aparecem
    // na tela primeiro, e os selos entram um instante depois — melhor do que
    // segurar a lista inteira esperando três consultas.
    const emConversa = (data ?? []).filter(c =>
      c.conversation_status === 'active' || c.conversation_status === 'pending')
    if (emConversa.length === 0) { setAtendimentos({}); return }

    const [ag, part, set] = await Promise.all([
      supabase.from('agents').select('id, name'),
      supabase.from('conversation_participants')
        .select('contact_id, agent_id')
        .in('contact_id', emConversa.map(c => c.id)),
      supabase.from('sectors').select('id, name'),
    ])
    setAtendimentos(montarAtendimentos(
      emConversa as any, (ag.data ?? []) as any, (part.data ?? []) as any, (set.data ?? []) as any))
  }

  // Bloquear e desbloquear direto da lista. A regra mora em lib/bloqueio.ts,
  // a mesma que o Atendimento e as Configurações usam — para as três telas
  // nunca discordarem sobre quem está bloqueado.
  // v48.34 — Qual canal bloquear é escolhido na janela; aqui só se aplica o que
  // foi escolhido. Ver components/EscolherCanaisBloqueio.tsx.
  async function aplicarBloqueio(c: Contact, canais: CanalBloqueio[], acao: 'bloquear' | 'desbloquear') {
    if (!agent) return
    setMudandoBloqueio(c.id)
    const { erro } = acao === 'bloquear'
      ? await bloquearContato(c, agent, canais)
      : await desbloquearContato(c, agent, canais)
    setMudandoBloqueio(null)
    setBloqueioAberto(null)
    if (erro) { alert((acao === 'bloquear' ? 'Não foi possível bloquear: ' : 'Não foi possível desbloquear: ') + erro); return }
    loadContacts()
  }

  function exportCSV() {
    const header = ['Nome', 'Telefone', 'Email', 'Tags', 'Origem', 'Último contato', 'Status']
    const rows = contacts.map(c => [
      c.full_name || '',
      c.phone || '',
      c.email || '',
      (c.tags ?? []).join(';'),
      c.source || '',
      c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleString('pt-BR') : '',
      c.conversation_status || '',
    ])
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `contatos_${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const filtered = useMemo(() => {
    // Busca sem acento e sem caixa: quem procura digita "jose", não "José".
    const q = semAcento(search)
    let list = contacts
    if (filtroBloqueio === 'bloqueados') list = list.filter(estaBloqueado)
    if (filtroBloqueio === 'ativos') list = list.filter(c => !estaBloqueado(c))
    if (filtroAtendimento !== 'todos') list = list.filter(c => atendimentos[c.id]?.estado === filtroAtendimento)
    if (q) {
      list = list.filter(c =>
        contemTermo(q, c.full_name, c.phone, c.email) ||
        (c.tags ?? []).some(t => semAcento(t).includes(q))
      )
    }
    if (sortKey === 'name') {
      // Sem acento e sem caixa ("Álvaro" junto de "alvaro"); sem nome vai para o fim.
      list = [...list].sort((a, b) => {
        const na = (a.full_name || '').trim(), nb = (b.full_name || '').trim()
        if (!na && nb) return 1
        if (na && !nb) return -1
        return na.localeCompare(nb, 'pt-BR', { sensitivity: 'base' })
      })
    }
    return list
  }, [contacts, search, sortKey, filtroBloqueio, filtroAtendimento, atendimentos])

  const bloqueados = useMemo(() => contacts.filter(estaBloqueado).length, [contacts])
  const emAtendimento = useMemo(
    () => Object.values(atendimentos).filter(a => a.estado === 'ativo').length, [atendimentos])
  const naFila = useMemo(
    () => Object.values(atendimentos).filter(a => a.estado === 'fila').length, [atendimentos])

  // Colunas redimensionáveis — carrega do Supabase por usuário
  const DEFAULT_COLS = { contato: 280, telefone: 140, instagram: 150, tags: 120, origem: 100, ultimo: 140, acoes: 140 }
  const [colWidths, setColWidths] = useState(DEFAULT_COLS)
  const resizingCol = useRef<string | null>(null)
  const resizingStartX = useRef(0)
  const resizingStartW = useRef(0)

  useEffect(() => {
    if (!agent) return
    supabase.from('agent_ui_prefs').select('pref_value')
      .eq('agent_id', agent.id).eq('pref_key', 'contacts_col_widths').single()
      .then(({ data }) => {
        if (!data?.pref_value) return
        const salvo = { ...DEFAULT_COLS, ...data.pref_value }
        // A largura antiga do nome (200) era estreita demais e cortava a maioria
        // dos nomes completos. Quem está exatamente nela nunca arrastou a coluna
        // — é o padrão velho, não uma escolha — então recebe o padrão novo.
        // Quem já ajustou fica com o que escolheu.
        if (Number(data.pref_value.contato) === 200) salvo.contato = DEFAULT_COLS.contato
        setColWidths(salvo)
      })
  }, [agent])

  async function saveColWidths(widths: typeof DEFAULT_COLS) {
    if (!agent) return
    await supabase.from('agent_ui_prefs').upsert({
      agent_id: agent.id, pref_key: 'contacts_col_widths', pref_value: widths, updated_at: new Date().toISOString()
    }, { onConflict: 'agent_id,pref_key' })
  }

  function startResize(col: string, e: React.MouseEvent) {
    e.preventDefault()
    resizingCol.current = col
    resizingStartX.current = e.clientX
    resizingStartW.current = colWidths[col as keyof typeof DEFAULT_COLS]

    function onMove(ev: MouseEvent) {
      if (!resizingCol.current) return
      const delta = ev.clientX - resizingStartX.current
      const newW = Math.max(60, resizingStartW.current + delta)
      setColWidths(prev => ({ ...prev, [resizingCol.current!]: newW }))
    }
    function onUp() {
      if (resizingCol.current) {
        setColWidths(prev => {
          saveColWidths(prev)
          return prev
        })
        resizingCol.current = null
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Duplo clique no divisor: ajusta a coluna ao conteúdo mais longo que está
  // na tela. Mede o texto de verdade, com a fonte de verdade — chutar por
  // número de caracteres erra feio em nomes com letras largas.
  function ajustarAoConteudo(col: string) {
    const textos =
      col === 'contato' ? filtered.map(c => c.full_name || '')
      : col === 'telefone' ? filtered.map(c => (ehSomenteInstagram(c) ? 'Sem WhatsApp' : c.phone || ''))
      : col === 'tags' ? filtered.map(c => (c.tags ?? []).slice(0, 2).join(' '))
      : col === 'origem' ? filtered.map(c => c.source || '')
      : col === 'instagram' ? filtered.map(c => psidDoContato(c) || c.custom_fields?.ig_account_name || '')
      : []
    if (textos.length === 0) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = '500 14px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif')
    const maior = textos.reduce((m, t) => Math.max(m, ctx.measureText(t).width), 0)

    // Sobra para o avatar, os espaçamentos e o divisor. Teto para uma coluna
    // não engolir a tela por causa de um nome fora do comum.
    const extra = col === 'contato' ? 92 : 44
    const largura = Math.min(520, Math.max(120, Math.ceil(maior + extra)))
    setColWidths(prev => {
      const novo = { ...prev, [col]: largura }
      saveColWidths(novo)
      return novo
    })
  }

  function ResizeTh({ col, label, className }: { col: string; label: string; className?: string }) {
    return (
      <th style={{ width: colWidths[col as keyof typeof DEFAULT_COLS], minWidth: 60 }}
        className={clsx('px-4 py-3 font-medium relative select-none group/th', className)}>
        <div className="flex items-center justify-between">
          <span className="truncate">{label}</span>
        </div>
        <div onMouseDown={e => startResize(col, e)}
          onDoubleClick={() => ajustarAoConteudo(col)}
          className="absolute right-0 top-0 h-full w-3 cursor-col-resize flex items-center justify-center group-hover/th:bg-brand-50"
          title="Arraste para redimensionar · dois cliques ajusta ao conteúdo">
          <div className="w-0.5 h-4 bg-slate-300 group-hover/th:bg-brand-400 rounded-full"/>
        </div>
      </th>
    )
  }

  async function openConversation(contact: Contact) {
    if (contact.custom_fields?.crm_blocked === true) {
      alert('Este contato está bloqueado. Para voltar a atendê-lo, acesse Configurações > Contatos bloqueados e faça o desbloqueio.')
      return
    }
    // Administrador entra como participante sem retirar o atendimento do responsável.
    // A entrada é registrada apenas uma vez e o contato continua atribuído ao dono atual.
    if (contact.conversation_status === 'active' && contact.assigned_to && contact.assigned_to !== agent?.id) {
      if (agent?.role === 'admin') {
        const { data: agentData } = await supabase.from('agents').select('name').eq('id', contact.assigned_to).maybeSingle()
        setAdminJoinPrompt({ contact, currentAgentName: agentData?.name || 'outro atendente' })
        return
      }
      // Usuários comuns continuam dependendo da autorização do responsável atual.
      const { data: agentData } = await supabase.from('agents').select('name').eq('id', contact.assigned_to).single()
      setConflictAgentName(agentData?.name || 'outro atendente')
      setConflictAgentId(contact.assigned_to)
      setConflictContact(contact)
      return
    }
    // Se está fechado/inativo → mostra histórico com opção de iniciar
    if (contact.conversation_status === 'closed' || contact.conversation_status === 'inactive' || !contact.conversation_status) {
      setHistoryContact(contact)
      return
    }
    router.push(`/inbox?contact=${contact.id}`)
  }

  async function confirmAdminJoin() {
    if (!agent || !adminJoinPrompt || adminJoining) return
    const contact = adminJoinPrompt.contact
    setAdminJoining(true)

    // Confere novamente antes de entrar, pois o responsável pode ter mudado
    // enquanto o aviso estava aberto.
    const { data: current } = await supabase.from('contacts')
      .select('conversation_status, assigned_to').eq('id', contact.id).maybeSingle()

    if (current?.conversation_status === 'active' && current.assigned_to && current.assigned_to !== agent.id) {
      const { data: existing } = await supabase.from('conversation_participants')
        .select('id').eq('contact_id', contact.id).eq('agent_id', agent.id).maybeSingle()
      if (!existing) {
        const { error: participantErr } = await supabase.from('conversation_participants').insert({
          contact_id: contact.id,
          agent_id: agent.id,
        })
        if (participantErr) {
          setAdminJoining(false)
          alert('Não foi possível entrar na conversa: ' + participantErr.message)
          return
        }
        await supabase.from('messages').insert({
          contact_id: contact.id,
          channel: 'whatsapp',
          direction: 'outbound',
          content: `[INTERNO] 👥 Administrador(a) ${agent.name} entrou na conversa`,
          status: 'sent',
          sender_id: agent.id,
        })
      }
    }

    setAdminJoinPrompt(null)
    setAdminJoining(false)
    router.push(`/inbox?contact=${contact.id}`)
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-slate-100 px-4 py-4 flex flex-col items-stretch gap-3 flex-shrink-0 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Contatos</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {loading ? 'Carregando...' : `${filtered.length} de ${contacts.length} contatos`}
            </p>
          </div>
          <div className="grid w-full grid-cols-3 items-center gap-2 sm:flex sm:w-auto">
            <button onClick={exportCSV}
              className="flex min-w-0 items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors sm:gap-2 sm:px-3.5 sm:text-sm">
              <FileText size={15}/> Exportar
            </button>
            <button onClick={() => setShowImport(true)}
              className="flex min-w-0 items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors sm:gap-2 sm:px-3.5 sm:text-sm">
              <Upload size={15}/> Importar
            </button>
            <button onClick={() => setShowNewContact(true)}
              className="flex min-w-0 items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors sm:gap-2 sm:px-3.5 sm:text-sm">
              <Plus size={15}/><span className="sm:hidden">Novo</span><span className="hidden sm:inline">Novo contato</span>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        {/* v48.161 — No celular, a busca dividia a linha com os três selects e
            ficava minúscula — mal dava pra ler o que estava sendo digitado.
            Agora a busca tem a linha inteira pra ela no celular (sm: para
            baixo), com fonte maior, e os filtros vêm numa linha própria
            embaixo, rolando na horizontal se precisar. A partir de sm:, volta
            tudo pra uma linha só, como antes. */}
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex flex-col gap-2 flex-shrink-0 sm:flex-row sm:items-center sm:gap-3 sm:px-6">
          <div className="relative w-full sm:flex-1 sm:max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone, email ou tag..."
              className="w-full pl-9 pr-3 py-3 text-base bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent sm:py-2 sm:text-sm"/>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            {/* v48.19 — Filtro de bloqueio na própria lista. Achar um contato
                bloqueado exigia sair para Configurações, e lá não dá para
                bloquear — só desbloquear. */}
            <select
              value={filtroBloqueio}
              onChange={e => setFiltroBloqueio(e.target.value as any)}
              className="flex-shrink-0 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="todos">Todos</option>
              <option value="ativos">Sem bloqueio</option>
              <option value="bloqueados">Bloqueados ({bloqueados})</option>
            </select>
            {/* v48.30 — Achar quem está em atendimento agora, sem abrir um a um. */}
            <select
              value={filtroAtendimento}
              onChange={e => setFiltroAtendimento(e.target.value as any)}
              className="flex-shrink-0 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="todos">Atendimento: todos</option>
              <option value="ativo">Em atendimento ({emAtendimento})</option>
              <option value="fila">Na fila ({naFila})</option>
            </select>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="flex-shrink-0 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="last_contacted">Último contato</option>
              <option value="name">Nome (A-Z)</option>
            </select>
          </div>
        </div>

        {/* Tabela */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
              <Loader2 size={18} className="animate-spin mr-2"/> Carregando contatos...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-14 h-14 bg-brand-100 rounded-2xl flex items-center justify-center mb-3">
                <UserPlus size={24} className="text-brand-500"/>
              </div>
              <p className="text-slate-600 font-medium">Nenhum contato encontrado</p>
              <p className="text-slate-400 text-sm mt-1">
                {search ? 'Tente outra busca' : 'Importe contatos ou aguarde a primeira mensagem chegar'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm table-fixed">
              <thead className="sticky top-0 bg-surface/95 backdrop-blur z-10">
                <tr className="text-left text-xs text-slate-400 font-medium border-b border-slate-200">
                  <ResizeTh col="contato" label="Contato" className="px-6"/>
                  <ResizeTh col="telefone" label="Telefone"/>
                  <ResizeTh col="instagram" label="Instagram"/>
                  <ResizeTh col="tags" label="Tags"/>
                  <ResizeTh col="origem" label="Origem"/>
                  <ResizeTh col="ultimo" label="Último contato"/>
                  <th style={{ width: colWidths.acoes }} className="px-4 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-50 hover:bg-white transition-colors group">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          <ContactAvatar avatarUrl={c.avatar_url} name={c.full_name} id={c.id}/>
                          <ChannelBadge channel={c.custom_fields?.channel} accountName={c.custom_fields?.ig_account_name} size={13}/>
                        </div>
                        <div className="min-w-0 flex-1">
                          {/* v48.12 — 'block w-full' é o que faz o corte funcionar.
                              Sem isso o botão mantém a largura do texto inteiro,
                              ignora o limite da coluna e o nome passa por cima da
                              coluna vizinha em vez de virar reticências. */}
                          <button
                            onClick={() => { setDetailContact(c); setDetailEditMode(false) }}
                            title={c.full_name || ''}
                            className={clsx('block w-full font-medium truncate hover:text-brand-600 hover:underline text-left transition-colors',
                              estaBloqueado(c) ? 'text-slate-400' : 'text-slate-800')}>
                            {c.full_name || 'Sem nome'}
                          </button>
                          {estaBloqueado(c) && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
                              <Ban size={10}/>
                              {/* v48.34 — Dizer o canal: "bloqueado" sozinho,
                                  num contato que segue conversando pelo
                                  WhatsApp, parece defeito. */}
                              bloqueado
                              {canaisBloqueados(c).length === 1 ? ` no ${NOME_DO_CANAL[canaisBloqueados(c)[0]]}` : ''}
                            </span>
                          )}
                          {/* v48.30 — O selo de quem está atendendo. Fica logo
                              abaixo do nome porque é ali que o olho já está
                              quando se procura um paciente — e porque saber
                              disso depois de abrir a conversa é tarde. */}
                          {atendimentos[c.id] && (
                            <span
                              title={tituloAtendimento(atendimentos[c.id])}
                              className={clsx(
                                'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                atendimentos[c.id].estado === 'ativo'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-amber-50 text-amber-700')}>
                              <Headphones size={10} className="shrink-0"/>
                              <span className="truncate">{textoAtendimento(atendimentos[c.id])}</span>
                            </span>
                          )}
                          {c.email && (
                            <p className="text-xs text-slate-400 truncate flex items-center gap-1">
                              <Mail size={10}/> {c.email}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {/* v48.19 — min-w-0 no flex e truncate no texto: sem os dois,
                          um telefone longo (ou "Sem WhatsApp") empurra o conteúdo
                          por cima da coluna seguinte, como acontecia com o nome. */}
                      <span className="flex items-center gap-1.5 min-w-0">
                        <Phone size={12} className="text-slate-400 shrink-0"/>
                        <span className="truncate" title={c.phone || ''}>
                          {ehSomenteInstagram(c) ? 'Sem WhatsApp' : (c.phone || '—')}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {/* v48.10 — Num contato que só existe no Instagram, o que
                          importa aqui é o identificador dele (o PSID): é o que
                          se cola no cadastro de WhatsApp para unir os dois.
                          Antes a coluna dizia só "Instagram", e o identificador
                          não aparecia em lugar nenhum da tela. */}
                      {ehSomenteInstagram(c) ? (
                        <span className="flex items-center gap-1 text-slate-600 min-w-0">
                          <InstagramIcon size={12} className="shrink-0"/>
                          <span className="truncate font-mono text-[11px]" title={psidDoContato(c) || ''}>
                            {psidDoContato(c)}
                          </span>
                          <CopiarTexto valor={psidDoContato(c) || ''} titulo="Copiar o identificador do Instagram"/>
                        </span>
                      ) : psidDoContato(c) ? (
                        <span className="flex items-center gap-1.5 text-emerald-700 min-w-0">
                          <InstagramIcon size={12} className="shrink-0"/>
                          <span className="truncate" title={psidDoContato(c) || ''}>
                            {c.custom_fields?.ig_account_name || 'Vinculado'}
                          </span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <InstagramIcon size={12}/> Não vinculado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {c.tags && c.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {c.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-brand-50 text-brand-700 rounded-full">
                              <Tag size={9}/> {tag}
                            </span>
                          ))}
                          {c.tags.length > 2 && (
                            <span className="text-xs text-slate-400">+{c.tags.length - 2}</span>
                          )}
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      {c.source ? (
                        <span className="inline-block max-w-full truncate text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full capitalize" title={c.source}>{c.source}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-slate-500 text-xs">
                      {c.last_contacted_at
                        ? format(new Date(c.last_contacted_at), "d MMM 'às' HH:mm", { locale: ptBR })
                        : 'Nunca'}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setDetailContact(c); setDetailEditMode(true) }}
                          title="Editar cadastro"
                          className="p-1.5 rounded-lg text-slate-300 hover:text-brand-600 hover:bg-brand-50 transition-colors">
                          <Pencil size={15}/>
                        </button>
                        <button
                          onClick={() => openConversation(c)}
                          title={c.conversation_status === 'closed' ? 'Reabrir conversa' : 'Abrir conversa'}
                          className={clsx('p-1.5 rounded-lg transition-colors',
                            c.conversation_status === 'closed'
                              ? 'text-slate-300 hover:text-amber-600 hover:bg-amber-50'
                              : 'text-slate-300 hover:text-brand-600 hover:bg-brand-50')}>
                          <MessageSquare size={15}/>
                        </button>
                        <button
                          onClick={() => setBloqueioAberto(c)}
                          disabled={mudandoBloqueio === c.id}
                          title={estaBloqueado(c)
                            ? 'Bloqueado em ' + canaisBloqueados(c).map(x => NOME_DO_CANAL[x]).join(' e ') + ' — clique para mudar'
                            : 'Bloquear contato'}
                          className={clsx('p-1.5 rounded-lg transition-colors disabled:opacity-40',
                            estaBloqueado(c)
                              ? 'text-red-500 hover:text-emerald-600 hover:bg-emerald-50'
                              : 'text-slate-300 hover:text-red-600 hover:bg-red-50')}>
                          {mudandoBloqueio === c.id
                            ? <Loader2 size={15} className="animate-spin"/>
                            : estaBloqueado(c) ? <ShieldCheck size={15}/> : <Ban size={15}/>}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(c)}
                          title="Excluir contato"
                          className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                          <Trash2 size={15}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); loadContacts() }}
        />
      )}

      {bloqueioAberto && (
        <EscolherCanaisBloqueio
          contato={bloqueioAberto}
          onFechar={() => setBloqueioAberto(null)}
          onConfirmar={(canais, acao) => aplicarBloqueio(bloqueioAberto, canais, acao)}/>
      )}

      {showNewContact && (
        <NewContactModal
          onClose={() => setShowNewContact(false)}
          onCreated={(contact) => {
            setShowNewContact(false)
            router.push(`/inbox?contact=${contact.id}`)
          }}
        />
      )}

      {detailContact && (
        <ContactDetailModal
          contact={detailContact}
          startInEdit={detailEditMode}
          onClose={() => {
            setDetailContact(null)
            // Recarrega ao fechar. Uma união de cadastros muda DOIS contatos —
            // o que recebeu e o temporário que foi arquivado — e atualizar só
            // o que estava aberto deixaria o outro desatualizado na tela.
            loadContacts()
          }}
          onSaved={(updated) => {
            setContacts(prev => prev.map(c => c.id === updated.id ? updated : c))
            setDetailContact(updated)
          }}
          // O botão do cadastro passa a usar exatamente o mesmo caminho do
          // balãozinho da lista. Antes ele pulava direto para o inbox, e o
          // inbox recusa abrir conversa fechada — por isso não acontecia nada.
          onStartConversation={(c) => { setDetailContact(null); openConversation(c) }}
        />
      )}

      {historyContact && (
        <ContactHistoryModal
          contact={historyContact}
          onClose={() => setHistoryContact(null)}
          onStart={() => {
            const c = historyContact
            setHistoryContact(null)
            setAssignContact(c)
          }}
        />
      )}
      {adminJoinPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-800">Paciente em atendimento</h2>
              <button
                onClick={() => !adminJoining && setAdminJoinPrompt(null)}
                disabled={adminJoining}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
                aria-label="Fechar aviso"
              >
                <X size={16}/>
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertCircle size={19} className="mt-0.5 flex-shrink-0 text-amber-600"/>
                <p className="text-sm leading-5 text-slate-700">
                  <strong>{adminJoinPrompt.contact.full_name}</strong> já está em atendimento com{' '}
                  <strong>{adminJoinPrompt.currentAgentName}</strong>.
                </p>
              </div>
              <p className="text-sm text-slate-500">
                Deseja entrar na conversa como participante? O atendimento continuará ativo para o responsável atual, que será avisado da sua entrada.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setAdminJoinPrompt(null)}
                  disabled={adminJoining}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmAdminJoin}
                  disabled={adminJoining}
                  className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {adminJoining ? <Loader2 size={15} className="animate-spin"/> : <UserPlus size={15}/>} Entrar na conversa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {conflictContact && (
        <ConflictModal
          contact={conflictContact}
          currentAgentName={conflictAgentName}
          currentAgentId={conflictAgentId}
          onClose={() => setConflictContact(null)}
          onResolved={() => {
            setConflictContact(null)
          }}
        />
      )}
      {assignContact && (
        <AssignModal
          contactId={assignContact.id}
          contactName={assignContact.full_name}
          currentSectorId={assignContact.sector_id}
          title="Iniciar atendimento"
          autoAssign={true}
          onClose={() => setAssignContact(null)}
          onSaved={() => {
            setAssignContact(null)
            router.push(`/inbox?contact=${assignContact.id}`)
          }}
        />
      )}

      {deleteTarget && (
        <DeleteContactModal
          contact={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setContacts(prev => prev.filter(c => c.id !== deleteTarget.id))
            if (detailContact?.id === deleteTarget.id) setDetailContact(null)
            setDeleteTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ---------- Modal de Importação ----------

type ParsedRow = { full_name: string; phone: string; email: string; valid: boolean }

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return []

  const splitLine = (line: string) => line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  const header = splitLine(lines[0]).map(h => h.toLowerCase())

  const nameIdx = header.findIndex(h => h.includes('nome') || h.includes('name'))
  const phoneIdx = header.findIndex(h => h.includes('telefone') || h.includes('phone') || h.includes('celular'))
  const emailIdx = header.findIndex(h => h.includes('email'))

  const dataLines = (nameIdx === -1 && phoneIdx === -1) ? lines : lines.slice(1)

  return dataLines.map(line => {
    const cols = splitLine(line)
    const full_name = nameIdx >= 0 ? cols[nameIdx] : cols[0] || ''
    const phone = phoneIdx >= 0 ? cols[phoneIdx] : cols[1] || ''
    const email = emailIdx >= 0 ? cols[emailIdx] : ''
    return { full_name, phone, email, valid: !!(full_name && phone) }
  })
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [tab, setTab] = useState<'csv' | 'sheets'>('csv')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [sheetUrl, setSheetUrl] = useState('')
  const [loadingSheet, setLoadingSheet] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ success: number; failed: number; skipped: number } | null>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    setError('')
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setRows(parseCSV(text))
    }
    reader.readAsText(file, 'utf-8')
  }

  function sheetCsvUrl(url: string): string | null {
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
    if (!match) return null
    const gidMatch = url.match(/gid=([0-9]+)/)
    const gid = gidMatch ? gidMatch[1] : '0'
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`
  }

  async function handleLoadSheet() {
    setError('')
    const csvUrl = sheetCsvUrl(sheetUrl.trim())
    if (!csvUrl) {
      setError('Link inválido. Cole o link de compartilhamento da planilha (a planilha precisa estar pública ou compartilhada como "qualquer pessoa com o link").')
      return
    }
    setLoadingSheet(true)
    try {
      const resp = await fetch(csvUrl)
      if (!resp.ok) throw new Error()
      const text = await resp.text()
      setRows(parseCSV(text))
    } catch {
      setError('Não foi possível ler a planilha. Verifique se ela está compartilhada publicamente.')
    } finally {
      setLoadingSheet(false)
    }
  }

  const validRows = rows.filter(r => r.valid)

  async function handleImport() {
    if (validRows.length === 0) return
    setImporting(true)
    let success = 0, failed = 0, skipped = 0

    // Normaliza telefones
    const normalize = (p: string) => '+' + p.replace(/\D/g, '')
    const phones = validRows.map(r => normalize(r.phone))

    // Busca telefones já existentes no banco
    const { data: existing } = await supabase
      .from('contacts')
      .select('phone')
      .in('phone', phones)
    const existingPhones = new Set((existing ?? []).map(c => c.phone))

    for (const row of validRows) {
      const phone = normalize(row.phone)
      if (existingPhones.has(phone)) { skipped++; continue }
      const { error } = await supabase.from('contacts').insert({
        full_name: row.full_name.trim(),
        phone,
        email: row.email?.trim() || null,
        source: 'import',
        conversation_status: 'inactive',
      })
      if (error) failed++
      else success++
    }

    setResult({ success, failed, skipped })
    setImporting(false)
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-800">Importar contatos</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
            <X size={18}/>
          </button>
        </div>

        {result ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4">
              <CheckCircle2 size={26} className="text-emerald-600"/>
            </div>
            <p className="text-slate-800 font-medium">Importação concluída</p>
            <p className="text-slate-500 text-sm mt-1">
              {result.success} importado(s) com sucesso
              {result.skipped > 0 && ` · ${result.skipped} já existiam (pulados)`}
              {result.failed > 0 && ` · ${result.failed} falharam`}
            </p>
            <button
              onClick={onImported}
              className="mt-6 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors">
              Concluir
            </button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-1 px-6 pt-4 border-b border-slate-100 flex-shrink-0">
              <button
                onClick={() => { setTab('csv'); setRows([]); setError('') }}
                className={clsx('flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2',
                  tab === 'csv' ? 'text-brand-700 border-brand-600' : 'text-slate-400 border-transparent hover:text-slate-600')}>
                <FileText size={15}/> Arquivo CSV
              </button>
              <button
                onClick={() => { setTab('sheets'); setRows([]); setError('') }}
                className={clsx('flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2',
                  tab === 'sheets' ? 'text-brand-700 border-brand-600' : 'text-slate-400 border-transparent hover:text-slate-600')}>
                <LinkIcon size={15}/> Google Sheets
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {tab === 'csv' ? (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-slate-200 rounded-xl py-8 flex flex-col items-center justify-center gap-2 hover:border-brand-300 hover:bg-brand-50/30 transition-colors">
                    <Upload size={22} className="text-slate-400"/>
                    <p className="text-sm font-medium text-slate-600">
                      {fileName || 'Clique para selecionar um arquivo .csv'}
                    </p>
                    <p className="text-xs text-slate-400">Colunas esperadas: nome, telefone, email (opcional)</p>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="text-xs font-medium text-slate-500">Link da planilha Google Sheets</label>
                  <div className="flex gap-2">
                    <input
                      value={sheetUrl}
                      onChange={e => setSheetUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="flex-1 px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                    <button
                      onClick={handleLoadSheet}
                      disabled={!sheetUrl.trim() || loadingSheet}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
                      {loadingSheet ? <Loader2 size={14} className="animate-spin"/> : 'Carregar'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    A planilha precisa estar com compartilhamento público ("qualquer pessoa com o link pode visualizar").
                    Primeira linha deve conter os cabeçalhos (nome, telefone, email).
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
                  {error}
                </div>
              )}

              {rows.length > 0 && (
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-slate-500">
                      Pré-visualização — {validRows.length} de {rows.length} linha(s) válida(s)
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr className="text-left text-slate-500">
                          <th className="px-3 py-2 font-medium">Nome</th>
                          <th className="px-3 py-2 font-medium">Telefone</th>
                          <th className="px-3 py-2 font-medium">Email</th>
                          <th className="px-3 py-2 font-medium w-16">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 50).map((r, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 text-slate-700">{r.full_name || '—'}</td>
                            <td className="px-3 py-1.5 text-slate-700">{r.phone || '—'}</td>
                            <td className="px-3 py-1.5 text-slate-500">{r.email || '—'}</td>
                            <td className="px-3 py-1.5">
                              {r.valid
                                ? <span className="text-emerald-600 font-medium">OK</span>
                                : <span className="text-red-500 font-medium">Inválida</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 50 && (
                    <p className="text-xs text-slate-400 mt-1.5">Mostrando 50 de {rows.length} linhas</p>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 flex-shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={validRows.length === 0 || importing}
                className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
                {importing && <Loader2 size={14} className="animate-spin"/>}
                Importar {validRows.length > 0 && `(${validRows.length})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Modal de Exclusão de Contato ----------

function DeleteContactModal({ contact, onClose, onDeleted }: {
  contact: Contact; onClose: () => void; onDeleted: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const canDelete = confirmText.trim().toUpperCase() === 'EXCLUIR'

  async function handleDelete() {
    if (!canDelete || deleting) return
    setDeleting(true)
    setError('')
    try {
      // Remove primeiro os registros dependentes (evita erro de chave estrangeira),
      // depois o contato em si.
      const cleanups = await Promise.all([
        supabase.from('messages').delete().eq('contact_id', contact.id),
        supabase.from('scheduled_messages').delete().eq('contact_id', contact.id),
        supabase.from('conversation_participants').delete().eq('contact_id', contact.id),
        supabase.from('access_requests').delete().eq('contact_id', contact.id),
      ])
      const cleanupError = cleanups.find(r => r.error)?.error
      if (cleanupError) throw cleanupError

      const { error: delErr } = await supabase.from('contacts').delete().eq('id', contact.id)
      if (delErr) throw delErr

      onDeleted()
    } catch (e: any) {
      setError(e?.message || 'Não foi possível excluir o contato. Tente novamente.')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Excluir contato</h2>
          <button onClick={onClose} disabled={deleting}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors disabled:opacity-40">
            <X size={18}/>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-3 px-3.5 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5"/>
            <div>
              Você está prestes a excluir permanentemente <strong>{contact.full_name || 'este contato'}</strong>.
              Todo o histórico de mensagens, agendamentos e conversas desse contato será apagado.
              Essa ação não pode ser desfeita.
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">
              Para confirmar, digite <strong>EXCLUIR</strong> abaixo
            </label>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="EXCLUIR"
              autoFocus
              className="mt-1.5 w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"/>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40">
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
            {deleting && <Loader2 size={14} className="animate-spin"/>}
            Excluir contato
          </button>
        </div>
      </div>
    </div>
  )
}
