'use client'
import { Suspense, useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase, Contact, Message, MessageReaction, Sector, canReadPrivateMessage } from '@/lib/supabase'
import { isSecretaryJobTitle, useAuth } from '@/lib/AuthContext'
import Sidebar from '@/components/Sidebar'
import AvisoCanalFora from '@/components/AvisoCanalFora'
import ConversationSidePanel from '@/components/ConversationSidePanel'
import AssignModal from '@/components/AssignModal'
import InviteModal from '@/components/InviteModal'
import ReviewConfirmModal from '@/components/ReviewConfirmModal'
import { NewDispatchModal } from '@/app/agenda/page'
import ChannelBadge from '@/components/ChannelBadge'
import InstagramIcon from '@/components/icons/InstagramIcon'
import ContactAvatar from '@/components/ContactAvatar'
import { simularParcelas, NOME_BANDEIRA, type Bandeira } from '@/lib/safrapay'
import { simularInfinitePay, simularRepasseInfinitePay, normalizarInfinitePay } from '@/lib/infinitepay'
import BandeiraIcone from '@/components/BandeiraIcone'
import EscolherCanaisBloqueio from '@/components/EscolherCanaisBloqueio'
import { bloquearContato, desbloquearContato, bloqueadoPorCompleto, textoDosCanais, type CanalBloqueio } from '@/lib/bloqueio'
import {
  Search, Send, Bot, MoreVertical, CheckCheck, AlertTriangle,
  Paperclip, CheckCircle2, User, Loader2, ChevronLeft, ChevronRight,
  Lock, CalendarClock, Smile, X, Clock, Mic, Square, Menu, Bell, Play, Pencil, UserPlus, LogOut, ChevronDown, Ban, Sparkles, RotateCcw, RefreshCw, QrCode, CreditCard, Receipt, Trash2
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import clsx from 'clsx'
import { useAiAssistantName } from '@/lib/useAiAssistantName'

type Conv = { contact: Contact; last_message: Message | null }
type Tab = 'inbox' | 'pending' | 'active'
type QuickMsg = { id: string; shortcut: string; content: string }

const EMOJIS = ['😊','👋','✅','❤️','🙏','😅','👍','🎉','⏰','📅','💊','🏥','📋','✏️','🔔','💬','❓','⚠️','🚨','✔️']
const REACTION_EMOJIS = ['👍','❤️','😂','😮','😢','🙏']
const WH_REACT_MESSAGE = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-reagir-mensagem'
// Edição de mensagem já enviada: o n8n chama a API do WAHA para editar a mensagem
// no WhatsApp do paciente. Sem isso a edição ficaria só no banco do CRM.
const WH_EDIT_MESSAGE = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-editar-mensagem'
// v48.137 — Apagar mensagem já enviada: mesmo esquema da edição acima — o n8n
// chama a API do WAHA para apagar no WhatsApp do paciente ("apagar para
// todos"). O WhatsApp só permite dentro de uma janela de tempo; passado isso o
// WAHA recusa e avisamos a pessoa em vez de fingir que apagou. No CRM a
// mensagem NUNCA some — fica marcada como apagada (ver apagado_em), cinza e
// tachada, mas ainda legível (pedido do Jorge: apaga do paciente, não do CRM).
const WH_DELETE_MESSAGE = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-apagar-mensagem'
// Sugestões de texto por IA (melhorar rascunho / sugerir resposta com base na última
// mensagem do paciente e/ou numa instrução digitada). Reaproveita o mesmo modelo (Gemini)
// já configurado para a Sofia.
const WH_AI_SUGGEST = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-ia-sugestoes'

// Cache de nomes de agentes
const agentNameCache: Record<string, string> = {}

function SenderName({ senderId }: { senderId: string }) {
  const [name, setName] = useState<string | null>(agentNameCache[senderId] ?? null)
  useEffect(() => {
    if (agentNameCache[senderId]) { setName(agentNameCache[senderId]); return }
    supabase.from('agents').select('name').eq('id', senderId).single()
      .then(({ data }) => { if (data?.name) { agentNameCache[senderId] = data.name; setName(data.name) } })
  }, [senderId])
  if (!name) return null
  return <span className="text-xs text-slate-400 font-medium">{name}</span>
}

function AudioPlayer({ url, outbound }: { url: string; outbound: boolean }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  function toggle() { const a = audioRef.current; if (!a) return; if (playing) { a.pause(); setPlaying(false) } else { a.play(); setPlaying(true) } }
  function onTimeUpdate() { const a = audioRef.current; if (!a) return; setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0) }
  function onEnded() { setPlaying(false); setProgress(0); if (audioRef.current) audioRef.current.currentTime = 0 }
  function onLoadedMetadata() { if (audioRef.current) setDuration(audioRef.current.duration) }
  function seek(e: React.MouseEvent<HTMLDivElement>) { const a = audioRef.current; if (!a) return; const rect = e.currentTarget.getBoundingClientRect(); const r = (e.clientX - rect.left) / rect.width; a.currentTime = r * a.duration; setProgress(r * 100) }
  function fmtTime(s: number) { if (!s || isNaN(s)) return '0:00'; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}` }
  const track = outbound ? 'bg-green-200' : 'bg-slate-200'
  const fill = outbound ? 'bg-green-600' : 'bg-brand-500'
  const btn = outbound ? 'text-green-700 bg-green-100 hover:bg-green-200' : 'text-brand-600 bg-brand-50 hover:bg-brand-100'
  const dot = outbound ? 'bg-green-600' : 'bg-brand-600'
  const wave = outbound ? ['bg-green-600','bg-green-300'] : ['bg-brand-500','bg-slate-300']
  const time = outbound ? 'text-green-700' : 'text-slate-400'
  return (
    <div className="flex items-center gap-2 w-48">
      <audio ref={audioRef} src={url} onTimeUpdate={onTimeUpdate} onEnded={onEnded} onLoadedMetadata={onLoadedMetadata}/>
      <button onClick={toggle} className={clsx('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', btn)}>
        {playing ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="3.5" height="10" rx="1"/><rect x="7.5" y="1" width="3.5" height="10" rx="1"/></svg>
          : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 1.5l9 4.5-9 4.5V1.5z"/></svg>}
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <div className={clsx('w-full h-1.5 rounded-full cursor-pointer relative', track)} onClick={seek}>
          <div className={clsx('h-full rounded-full', fill)} style={{ width: `${progress}%` }}/>
          <div className={clsx('absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full shadow', dot)} style={{ left: `calc(${progress}% - 5px)` }}/>
        </div>
        <div className="flex items-end gap-px h-4">
          {Array.from({ length: 28 }, (_, i) => {
            const heights = [3,5,8,4,10,6,3,9,5,7,4,8,6,10,3,7,5,9,4,6,8,3,5,7,4,9,6,3]
            const filled = progress > 0 && (i/28)*100 < progress
            return <div key={i} className={clsx('w-0.5 rounded-full', filled ? wave[0] : wave[1])} style={{ height: `${heights[i%heights.length]}px` }}/>
          })}
        </div>
      </div>
      <span className={clsx('text-xs flex-shrink-0', time)}>{fmtTime(duration)}</span>
    </div>
  )
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-slate-400 text-sm">Carregando...</div>}>
      <InboxContent/>
    </Suspense>
  )
}

function InboxContent() {
  const assistantName = useAiAssistantName()
  const searchParams = useSearchParams()
  const { agent } = useAuth()
  // Restaura última aba do localStorage
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('crm_inbox_tab') as Tab) || 'inbox' } catch { return 'inbox' }
  })

  function changeTab(t: Tab) {
    setTab(t)
    try { localStorage.setItem('crm_inbox_tab', t) } catch {}
  }
  const [inboxConvs, setInboxConvs] = useState<Conv[]>([])
  const [pendingConvs, setPendingConvs] = useState<Conv[]>([])
  const [activeConvs, setActiveConvs] = useState<Conv[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [agentSectorIds, setAgentSectorIds] = useState<string[]>([])
  const [selected, setSelected] = useState<Contact | null>(null)
  const [bloqueioAberto, setBloqueioAberto] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [reactions, setReactions] = useState<MessageReaction[]>([])
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  const [sendingReactionFor, setSendingReactionFor] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  // Canal de envio escolhido pelo atendente para a PRÓXIMA mensagem/mídia enviada
  // manualmente. Só é relevante (e só aparece na tela) quando o contato tem os
  // dois canais disponíveis: um telefone real (WhatsApp) e um vínculo de Instagram
  // (ex.: veio pelo Insta e depois foi mesclado com o cadastro que já tinha WhatsApp).
  const [sendChannel, setSendChannel] = useState<'whatsapp' | 'instagram'>('whatsapp')
  const [loading, setLoading] = useState(true)
  const initialLoadDone = useRef(false)
  const [sofiaPaused, setSofiaPaused] = useState(false)
  const [sofiaGlobalPaused, setSofiaGlobalPaused] = useState(false)
  const [togglingGlobal, setTogglingGlobal] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [sidePanelSchedule, setSidePanelSchedule] = useState(false)
  const [sidePanelRecibos, setSidePanelRecibos] = useState(false)
  const [sidePanelRetorno, setSidePanelRetorno] = useState(false)
  const [showSidePanel, setShowSidePanel] = useState(false)
  const [zoomedPhotoUrl, setZoomedPhotoUrl] = useState<string | null>(null)
  const [showAssign, setShowAssign] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showScheduleMsg, setShowScheduleMsg] = useState(false)
  const [closingConv, setClosingConv] = useState(false)
  const [reviewConfirm, setReviewConfirm] = useState<{ contactName: string; resolve: (v: boolean) => void } | null>(null)
  const [toast, setToast] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  // v47.06 — cobrança PIX gerada pelo próprio CRM (ver app/api/cobranca-pix)
  const [showPix, setShowPix] = useState(false)
  const [pixValor, setPixValor] = useState('')
  const [pixDescricao, setPixDescricao] = useState('')
  const [pixEnviando, setPixEnviando] = useState(false)
  const [pixErro, setPixErro] = useState('')
  const [pixOk, setPixOk] = useState(false)
  const [pixDescricoes, setPixDescricoes] = useState<{ texto: string; parcelas: number }[]>([])
  // v47.14 — cobrança no cartão pelo Link de Pagamentos da Safrapay.
  // O paciente paga numa página do Banco Safra; nenhum dado de cartão entra aqui.
  const [showCartao, setShowCartao] = useState(false)
  const [cartaoValor, setCartaoValor] = useState('')
  const [cartaoDescricao, setCartaoDescricao] = useState('')
  const [cartaoParcelas, setCartaoParcelas] = useState(1)
  // v47.17 — a secretária pergunta ao paciente qual cartão ele vai usar. Com a
  // bandeira certa, o preço sai exato em vez de supor a bandeira mais cara.
  const [cartaoBandeira, setCartaoBandeira] = useState<Bandeira>('visa_master')
  const [cartaoEnviando, setCartaoEnviando] = useState(false)
  const [cartaoErro, setCartaoErro] = useState('')
  const [cartaoOk, setCartaoOk] = useState(false)
  const [safraCfg, setSafraCfg] = useState<any>(null)
  // Assistente de IA no composer: melhorar o texto digitado e/ou sugerir uma resposta
  // com base na última mensagem do paciente e/ou numa instrução digitada pelo atendente.
  const [showAiModal, setShowAiModal] = useState(false)
  const [aiImproveLoading, setAiImproveLoading] = useState(false)
  // Histórico de sugestões já geradas nesta sessão do modal + índice da que está
  // sendo exibida agora. Mostramos só 1 sugestão por vez (economiza chamadas de IA);
  // "Refazer" gera uma nova e avança, "Anterior" volta para a que já tinha aparecido.
  // v47.05 — histórico e índice num ESTADO SÓ. Antes eram dois estados separados e
  // o fetch fechava sobre um índice velho: ao reabrir o modal, o índice ficava 1 com
  // a lista tendo 1 item, e a sugestão aparecia em branco (funcionava na 1a vez e
  // falhava nas seguintes). Com um objeto só, os dois nunca discordam.
  const [aiImprove, setAiImprove] = useState<{ list: string[]; i: number }>({ list: [], i: -1 })
  const [aiImproveError, setAiImproveError] = useState('')
  const [aiReplyInstruction, setAiReplyInstruction] = useState('')
  const [aiReplyLoading, setAiReplyLoading] = useState(false)
  const [aiReply, setAiReply] = useState<{ list: string[]; i: number }>({ list: [], i: -1 })
  const [aiReplyError, setAiReplyError] = useState('')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editingMsg, setEditingMsg] = useState<Message | null>(null)
  const [editText, setEditText] = useState('')
  // v48.137 — Apagar mensagem enviada (ver WH_DELETE_MESSAGE acima).
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [showList, setShowList] = useState(false)
  const [participantContacts, setParticipantContacts] = useState<Set<string>>(new Set())
  const [quickMessages, setQuickMessages] = useState<QuickMsg[]>([])
  const [quickSuggestions, setQuickSuggestions] = useState<QuickMsg[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  function handleMessagesScroll() {
    const el = messagesContainerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150
    atBottomRef.current = nearBottom
    setAtBottom(nearBottom)
  }
  function scrollToBottom() {
    atBottomRef.current = true
    setAtBottom(true)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [listWidth, setListWidth] = useState(320)
  const [listPinned, setListPinned] = useState(true)
  const [listHovered, setListHovered] = useState(false)
  const resizingRef = useRef(false)
  const listExpanded = listPinned || listHovered
  const COLLAPSED = 68

  const onResizeStart = useCallback(() => { resizingRef.current = true }, [])
  useEffect(() => {
    function onMove(e: MouseEvent) { if (!resizingRef.current) return; setListWidth(Math.min(520, Math.max(260, e.clientX - 220))) }
    function onUp() { resizingRef.current = false }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])
  useEffect(() => {
    function onClick(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => { if (agent) { loadAll(); supabase.from('quick_messages').select('*').order('shortcut').then(({ data }) => setQuickMessages(data ?? [])) } }, [agent])
  // Expõe agentId no window para o canal de realtime detectar transferências
  const agentIdRef = useRef<string | null>(null)
  useEffect(() => { if (agent?.id) { agentIdRef.current = agent.id; (window as any).__agentId = agent.id } }, [agent])

  // Fecha a conversa E limpa a URL para não reabrir no refresh
  function closeConversation() {
    setSelected(null)
    try { window.history.replaceState(null, '', '/inbox') } catch {}
  }
  useEffect(() => { supabase.from('sectors').select('*').order('name').then(({ data }) => setSectors(data ?? [])) }, [])

  // Polling leve das listas (fallback para realtime de transferências)
  // 20s: o realtime (postgres_changes) já cobre o caso comum; isso é só uma
  // rede de segurança caso o WebSocket perca algum evento.
  useEffect(() => {
    if (!agent?.id) return
    // v48.26 — Aba escondida não recarrega. Cada volta destas lê as três listas
    // e a última mensagem de cada conversa; rodando em três abas esquecidas, é
    // trabalho e tráfego que ninguém está olhando. Ao voltar para a aba, o
    // recarregamento acontece na hora.
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadAll(true)
    }, 20000)
    const aoVoltar = () => { if (document.visibilityState === 'visible') loadAll(true) }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [agent?.id])

  // Sofia global — carrega estado e escuta mudanças em tempo real
  useEffect(() => {
    supabase.from('clinic_settings').select('sofia_paused_global').limit(1)
      .then(({ data }) => { if (data && data[0]) setSofiaGlobalPaused(data[0].sofia_paused_global ?? false) })

    const ch = supabase.channel('sofia-global')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clinic_settings' }, (payload) => {
        const s = payload.new as any
        setSofiaGlobalPaused(s.sofia_paused_global ?? false)
      })
      .subscribe()
    // Polling de fallback (rede de segurança do realtime acima) para o estado global da Sofia
    const poll = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      supabase.from('clinic_settings').select('sofia_paused_global').limit(1)
        .then(({ data }) => { if (data && data[0]) setSofiaGlobalPaused(data[0].sofia_paused_global ?? false) })
    }, 20000)
    return () => { supabase.removeChannel(ch); clearInterval(poll) }
  }, [])
  useEffect(() => {
    if (selected?.id) {
      loadMessages(selected.id, true)
    }
  }, [selected?.id])
  const isInitialLoadRef = useRef(true)
  useEffect(() => {
    if (!bottomRef.current) return
    // Scroll automático só ao abrir a conversa (instantâneo) ou se o usuário
    // já estava perto do fim (suave). Se ele rolou pra cima pra ler mensagens
    // antigas, não forçamos a volta — só o botão "ir para o fim" faz isso.
    if (isInitialLoadRef.current || atBottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: isInitialLoadRef.current ? 'instant' : 'smooth' })
      atBottomRef.current = true
      setAtBottom(true)
    }
    isInitialLoadRef.current = false
  }, [messages])

  // Reset ao trocar de conversa
  useEffect(() => {
    isInitialLoadRef.current = true
    atBottomRef.current = true
    setAtBottom(true)
  }, [selected?.id])

  // Chute inicial do canal de envio ao trocar de conversa, usado só enquanto o
  // histórico de mensagens ainda não carregou. Assim que loadMessages(..., true)
  // retorna, ele é corrigido para refletir a última mensagem recebida de fato
  // (ver loadMessages) — que é o sinal correto de "por onde o paciente está falando".
  useEffect(() => {
    if (!selected) return
    const hasWA = !!selected.phone && !selected.phone.startsWith('ig:')
    const hasIG = !!(selected.custom_fields?.instagram_psid || selected.custom_fields?.ig_sender_psid || selected.custom_fields?.channel === 'instagram')
    if (hasIG) setSendChannel('instagram')
    else if (hasWA) setSendChannel('whatsapp')
    else setSendChannel('whatsapp')
  }, [selected?.id])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) } }, [toast])

  useEffect(() => {
    const contactId = searchParams.get('contact')
    if (!contactId) return
    supabase.from('contacts').select('*').eq('id', contactId).single().then(({ data }) => {
      if (!data) { try { window.history.replaceState(null, '', '/inbox') } catch {}; return }
      const c = data as Contact
      // Não reabre conversas fechadas/inativas ao atualizar a página
      if (c.conversation_status === 'closed' || c.conversation_status === 'inactive' || c.conversation_status === null) {
        try { window.history.replaceState(null, '', '/inbox') } catch {}
        setSelected(null)
        return
      }
      setSelected(c)
      if (c.conversation_status === 'active') changeTab('active')
      loadAll(true)
    })
  }, [searchParams])

  const selectedRef = useRef<Contact | null>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

  // v47.12 — espelho das mensagens em ref, para a conferência periódica saber
  // qual é a última já exibida sem depender do fechamento do useEffect.
  const messagesRef = useRef<Message[]>([])
  useEffect(() => { messagesRef.current = messages }, [messages])

  // Guarda o id de um contato que acabou de ser finalizado/fechado intencionalmente,
  // para o loadAll() não "ressuscitar" ele na lista via a lógica de preservar selecionado.
  const closingIdRef = useRef<string | null>(null)

  // AudioContext reutilizável — inicializado no primeiro clique do usuário
  const audioCtxRef = useRef<AudioContext | null>(null)
  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  function playSound(type: 'message' | 'transfer' | 'inbox') {
    try {
      const ctx = getAudioCtx()
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      if (type === 'message') {
        ;[0, 0.15].forEach(delay => {
          const o = ctx.createOscillator()
          o.connect(gain); o.frequency.value = 880; o.type = 'sine'
          gain.gain.setValueAtTime(0.3, ctx.currentTime + delay)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12)
          o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 0.12)
        })
      } else if (type === 'transfer') {
        ;[0, 0.18, 0.36].forEach((delay, i) => {
          const o = ctx.createOscillator()
          o.connect(gain); o.frequency.value = [660, 780, 900][i]; o.type = 'sine'
          gain.gain.setValueAtTime(0.35, ctx.currentTime + delay)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.15)
          o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 0.15)
        })
      } else {
        const o = ctx.createOscillator()
        o.connect(gain); o.frequency.value = 520; o.type = 'sine'
        gain.gain.setValueAtTime(0.4, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
        o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.5)
      }
    } catch {}
  }

  // Inicializa AudioContext no primeiro clique (requisito do navegador)
  useEffect(() => {
    function unlock() {
      getAudioCtx()
      document.removeEventListener('click', unlock)
    }
    document.addEventListener('click', unlock)
    return () => document.removeEventListener('click', unlock)
  }, [])

  // Refs para detectar mudanças e tocar som
  const prevInboxCountRef = useRef(0)
  const prevPendingCountRef = useRef(0)
  const prevMsgIdRef = useRef<string | null>(null)

  const loadAllTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  function debouncedLoadAll() {
    if (loadAllTimeoutRef.current) clearTimeout(loadAllTimeoutRef.current)
    loadAllTimeoutRef.current = setTimeout(() => loadAll(true), 500)
  }

  useEffect(() => {
    const channelId = `inbox-${Math.random().toString(36).slice(2)}`
    const msgChannel = supabase.channel(`${channelId}-msgs`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as Message
        if (selectedRef.current && msg.contact_id === selectedRef.current.id) {
          setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
          // Se chegou mídia sem URL (ainda sendo processada), recarrega após 3s
          if (msg.media_type && !msg.media_url) {
            setTimeout(() => {
              if (selectedRef.current?.id === msg.contact_id) {
                loadMessages(msg.contact_id)
              }
            }, 3000)
          }
        }
        if (msg.direction === 'inbound' && !msg.content?.startsWith('[INTERNO]')) {
          if (msg.id !== prevMsgIdRef.current) {
            prevMsgIdRef.current = msg.id
            // Só toca o sino se a conversa for relevante para este atendente:
            // - está no inbox (sem dono), OU
            // - é atribuída a mim, OU
            // - eu sou participante
            const agentId = agentIdRef.current
            supabase.from('contacts').select('assigned_to, conversation_status').eq('id', msg.contact_id).maybeSingle()
              .then(async ({ data: c }) => {
                if (!c) return
                const semDono = c.assigned_to === null && (c.conversation_status === null || c.conversation_status === 'active' || c.conversation_status === 'pending')
                const minha = c.assigned_to === agentId
                let souParticipante = false
                if (!semDono && !minha) {
                  const { data: part } = await supabase.from('conversation_participants')
                    .select('id').eq('contact_id', msg.contact_id).eq('agent_id', agentId ?? '').maybeSingle()
                  souParticipante = !!part
                }
                if (semDono || minha || souParticipante) {
                  playSound('message')
                }
              })
          }
        }
        debouncedLoadAll()
      }).subscribe()

    const reactionChannel = supabase.channel(`${channelId}-reactions`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
        const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as MessageReaction
        if (selectedRef.current && row?.contact_id === selectedRef.current.id) loadReactions(row.contact_id)
      }).subscribe()

    const contactChannel = supabase.channel(`${channelId}-contacts`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contacts' }, (payload) => {
        const updated = payload.new as any
        const agentId = agentIdRef.current
        if (updated.assigned_to === agentId && updated.conversation_status === 'pending') {
          playSound('transfer')
          // Transferência para mim — recarrega imediatamente (sem debounce)
          loadAll(true)
        }
        // Se a conversa aberta foi transferida para outro OU fechada, fecha a tela.
        // Importante: só conta como "transferida para outro" se ela ERA minha antes
        // desta atualização — senão, qualquer UPDATE em contacts (ex: nova mensagem
        // chegando enquanto a Sofia ainda está atendendo, sem ninguém ter assumido)
        // fazia `stillMine` dar false e fechava a tela à toa mesmo sem nunca ter sido
        // atribuída a mim.
        if (selectedRef.current && updated.id === selectedRef.current.id) {
          const wasMine = selectedRef.current.assigned_to === agentId
          const stillMine = updated.assigned_to === agentId
          const isClosed = updated.conversation_status === 'closed'
          if (isClosed || (wasMine && !stillMine)) {
            // Verifica se sou participante antes de fechar
            supabase.from('conversation_participants')
              .select('id').eq('contact_id', updated.id).eq('agent_id', agentId ?? '').maybeSingle()
              .then(({ data }) => {
                if (!data) {
                  setSelected(null)
                  setToast('Este atendimento foi transferido')
                }
              })
          }
        }
        debouncedLoadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants' }, () => {
        debouncedLoadAll()
      }).subscribe()

    return () => {
      supabase.removeChannel(msgChannel)
      supabase.removeChannel(reactionChannel)
      supabase.removeChannel(contactChannel)
      if (loadAllTimeoutRef.current) clearTimeout(loadAllTimeoutRef.current)
    }
  }, [])

  const loadAllVersionRef = useRef(0)
  // v48.47 — Atualizar à mão, no celular.
  //
  // A lista se atualiza sozinha, mas no celular o navegador suspende a aba
  // quando a tela apaga ou o app vai para segundo plano, e quem volta encontra
  // a conversa parada no tempo. No computador isso quase não acontece; no
  // celular, o dia inteiro.
  //
  // Este botão não é enfeite: é a saída para quem está com o paciente na
  // frente e precisa ter certeza de que está vendo o que chegou agora.
  const [atualizando, setAtualizando] = useState(false)
  async function atualizarAgora() {
    if (atualizando) return
    setAtualizando(true)
    try {
      await loadAll(false)
      const id = selectedRef.current?.id
      if (id) await loadMessages(id)
    } catch {}
    setAtualizando(false)
  }

  async function loadAll(silent = false) {
    // Sem agente carregado, não executa (evita queries com id vazio que zeram a lista)
    if (!agent?.id) return
    const myVersion = ++loadAllVersionRef.current
    const isAdmin = agent?.role === 'admin' || agent?.sees_all_sectors

    // INBOX: sem atendente atribuído, status active ou null (novos)
    // No Postgres, != exclui NULLs, então usamos .or() para incluir status null
    const { data: inbox } = await supabase.from('contacts').select('*')
      .is('assigned_to', null)
      .or('conversation_status.is.null,conversation_status.eq.active')
      .order('last_contacted_at', { ascending: false }).limit(100)

    // PENDING: 
    // 1. assigned_to = agent (atribuído diretamente a mim)
    // 2. sector_id = meu setor + assigned_to null (pendente do setor, qualquer um pode assumir)
    const mysectors = await supabase.from('agent_sectors').select('sector_id').eq('agent_id', agent?.id ?? '')
    const mySectorIds = (mysectors?.data ?? []).map((s: any) => s.sector_id)
    if (isAdmin) {
      const { data: allSectors } = await supabase.from('sectors').select('id')
      setAgentSectorIds((allSectors ?? []).map((s: any) => s.id))
    } else {
      setAgentSectorIds(mySectorIds)
    }

    const { data: pendingMine } = await supabase.from('contacts').select('*')
      .eq('assigned_to', agent?.id ?? '')
      .eq('conversation_status', 'pending')
      .order('last_contacted_at', { ascending: false }).limit(100)

    let pendingSetor: Contact[] = []
    if (mySectorIds.length > 0) {
      const { data } = await supabase.from('contacts').select('*')
        .in('sector_id', mySectorIds)
        .is('assigned_to', null)
        .eq('conversation_status', 'pending')
        .order('last_contacted_at', { ascending: false }).limit(100)
      pendingSetor = data ?? []
    }

    // Admins e sees_all_sectors veem todos os pendentes sem atendente
    let pendingSemAtendente: Contact[] = []
    if (isAdmin) {
      const { data } = await supabase.from('contacts').select('*')
        .is('assigned_to', null)
        .eq('conversation_status', 'pending')
        .order('last_contacted_at', { ascending: false }).limit(100)
      pendingSemAtendente = data ?? []
    }

    // Combina e deduplica
    const allPending = [...(pendingMine ?? []), ...pendingSetor, ...pendingSemAtendente]
    const pending = allPending.filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)

    // ACTIVE: todos veem só os seus próprios + participações
    const { data: mine } = await supabase.from('contacts').select('*')
      .eq('conversation_status', 'active')
      .eq('assigned_to', agent?.id ?? '')
      .order('last_contacted_at', { ascending: false }).limit(100)

    const { data: parts } = await supabase.from('conversation_participants')
      .select('contact_id').eq('agent_id', agent?.id ?? '')
    const partIds = (parts ?? []).map((p: any) => p.contact_id)
    let partContacts: Contact[] = []
    if (partIds.length > 0) {
      const { data } = await supabase.from('contacts').select('*')
        .in('id', partIds).eq('conversation_status', 'active')
      partContacts = data ?? []
    }
    const all = [...(mine ?? []), ...partContacts]
    const active = all.filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)

    // Busca última mensagem para cada contato — em batch para evitar race condition
    async function withLastMsg(contacts: Contact[]): Promise<Conv[]> {
      if (contacts.length === 0) return []
      const ids = contacts.map(c => c.id)
      // v48.26 — Só as colunas que a lista usa. Com select('*') vinham junto o
      // texto inteiro, transcrição de áudio e endereços de mídia de até 500
      // mensagens, a cada 20 segundos, para escrever uma linha de prévia.
      const { data: allMsgs } = await supabase.from('messages')
        .select('id, contact_id, content, direction, media_type, channel, created_at')
        .in('contact_id', ids)
        .or('content.is.null,content.not.like.[INTERNO]%')
        .order('created_at', { ascending: false })
        .limit(ids.length * 5)
      // Pega a primeira mensagem de cada contato
      const lastByContact: Record<string, Message> = {}
      for (const msg of (allMsgs ?? []) as any[]) {
        if (!lastByContact[msg.contact_id]) {
          lastByContact[msg.contact_id] = msg
        }
      }
      return contacts.map(c => ({ contact: c, last_message: lastByContact[c.id] ?? null }))
    }

    const [inboxList, pendingList, activeList] = await Promise.all([
      withLastMsg(inbox ?? []),
      withLastMsg(pending ?? []),
      withLastMsg(active ?? []),
    ])

    // Preserva o contato selecionado na lista correta para não sumir durante reload
    const selectedId = selectedRef.current?.id
    // Se esse contato acabou de ser finalizado/fechado intencionalmente pelo usuário,
    // não o "ressuscita" na lista mesmo que ele ainda esteja selecionado na tela.
    const justClosed = !!selectedId && selectedId === closingIdRef.current
    if (selectedId && !justClosed) {
      const inSelected = [...inboxList, ...pendingList, ...activeList].find(c => c.contact.id === selectedId)
      if (!inSelected) {
        if (myVersion !== loadAllVersionRef.current) return
        setActiveConvs(prev => {
          const wasActive = prev.find(c => c.contact.id === selectedId)
          if (wasActive) return activeList.find(c => c.contact.id === selectedId) ? activeList : [...activeList, wasActive]
          return activeList
        })
        setInboxConvs(inboxList)
        setPendingConvs(pendingList)
        if (!silent) setLoading(false)
        return
      }
    }

    // Se outro loadAll começou depois deste, descarta este resultado (evita sobrescrever com dados obsoletos)
    if (myVersion !== loadAllVersionRef.current) return

    setInboxConvs(inboxList)
    setPendingConvs(pendingList)
    setActiveConvs(activeList)

    // Busca contatos com participantes adicionais
    try {
      // v47.17 — aqui estava escrito `activeContacts`, variável que não existe.
      // Como a linha está dentro de um try, o erro era engolido em silêncio e a
      // lista de participantes nunca era carregada — por isso o menu às vezes
      // mostrava "Finalizar atendimento" onde devia mostrar "Finalizar minha
      // parte". A variável certa é `active`, montada logo acima.
      const allIds = [...(inbox ?? []), ...(pending ?? []), ...active].map(c => c.id)
      if (allIds.length > 0) {
        const { data: parts } = await supabase.from('conversation_participants')
          .select('contact_id').in('contact_id', allIds)
        setParticipantContacts(new Set((parts ?? []).map((p: any) => p.contact_id)))
      }
    } catch {}

    if (!initialLoadDone.current) {
      initialLoadDone.current = true
      setLoading(false)
    }
  }

  async function loadMessages(contactId: string, isInitial?: boolean) {
    // v47.13 — Este era o bug das mensagens que apareciam e sumiam.
    //
    // A consulta trazia 500 mensagens ordenadas da MAIS ANTIGA para a mais nova.
    // Enquanto a conversa tinha menos de 500 ninguém percebeu. Quando passou de
    // 500 (o contato do teste chegou a 513), o "limite 500" passou a cortar pelo
    // fim: o CRM recebia as 500 primeiras e as mais RECENTES ficavam de fora.
    // Como o realtime acrescenta a mensagem nova na tela na hora, ela aparecia —
    // e sumia no primeiro recarregamento da conversa, porque a lista era
    // substituída pelas 500 antigas. Era isso, e não perda de dado.
    //
    // Agora pedimos as 500 MAIS RECENTES (ordem decrescente) e invertemos para
    // exibir. E se a consulta falhar, a tela mantém o que já estava: antes, um
    // erro de rede zerava a conversa inteira.
    const { data, error } = await supabase.from('messages').select('*').eq('contact_id', contactId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500)
    if (error) return
    const recentes = (data ?? []).slice().reverse()
    setMessages(prev => {
      const fresh = recentes
      // Preserva mensagens otimistas (temp-) que ainda não foram confirmadas no banco
      const temps = prev.filter(m => m.id.startsWith('temp-') && !fresh.find(f => f.content === m.content && f.direction === m.direction))
      return [...fresh, ...temps]
    })
    await loadReactions(contactId)
    // Ao abrir a conversa (não durante o polling), o canal de envio padrão deve
    // refletir por onde o paciente está falando AGORA — a última mensagem recebida
    // (inbound) — e não uma prioridade fixa. Isso corrige o caso de um contato com
    // WhatsApp + Instagram vinculados que está no momento conversando pelo Instagram:
    // o seletor deve abrir em "Instagram", não em "WhatsApp".
    if (isInitial) {
      const fresh = recentes
      const lastInbound = [...fresh].reverse().find(m => m.direction === 'inbound' && (m.channel === 'whatsapp' || m.channel === 'instagram'))
      if (lastInbound) setSendChannel(lastInbound.channel as 'whatsapp' | 'instagram')
    }
  }

  async function loadReactions(contactId: string) {
    const { data } = await supabase.from('message_reactions').select('*')
      .eq('contact_id', contactId).order('created_at', { ascending: true })
    setReactions((data ?? []) as MessageReaction[])
  }

  async function sendReaction(message: Message, emoji: string) {
    if (!selected || !agent || !message.external_id || sendingReactionFor) return
    const current = reactions.find(r => r.message_id === message.id && r.reactor_type === 'agent' && r.reactor_id === agent.id)
    const nextEmoji = current?.emoji === emoji ? '' : emoji
    const previousReactions = reactions

    // Atualização otimista: a reação aparece imediatamente no CRM. Caso o envio
    // falhe, o estado anterior é restaurado e o atendente recebe o erro.
    setReactions(prev => {
      const withoutMine = prev.filter(r => !(r.message_id === message.id && r.reactor_type === 'agent' && r.reactor_id === agent.id))
      if (!nextEmoji) return withoutMine
      return [...withoutMine, {
        id: `temp-reaction-${message.id}-${agent.id}`,
        message_id: message.id,
        external_message_id: message.external_id,
        contact_id: selected.id,
        emoji: nextEmoji,
        reactor_type: 'agent',
        reactor_id: agent.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as MessageReaction]
    })

    setSendingReactionFor(message.id)
    setReactionPickerFor(null)
    try {
      const response = await fetch(WH_REACT_MESSAGE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: message.id,
          external_id: message.external_id,
          contact_id: selected.id,
          emoji: nextEmoji,
          reactor_id: agent.id,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.success === false) throw new Error(result.message || 'Falha ao enviar reação')
      await loadReactions(selected.id)
      setToast(nextEmoji ? 'Reação enviada' : 'Reação removida')
    } catch (error) {
      setReactions(previousReactions)
      setToast(error instanceof Error ? error.message : 'Falha ao enviar reação')
    } finally {
      setSendingReactionFor(null)
    }
  }

  // Polling leve das mensagens da conversa aberta (fallback do realtime).
  // Mais frequente que os outros pollings porque é a conversa que o atendente
  // está olhando agora — mas ainda assim só uma rede de segurança, já que o
  // INSERT em "messages" já chega via realtime na maioria dos casos.
  useEffect(() => {
    if (!selected?.id) return
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadMessages(selected.id)
    }, 8000)
    return () => clearInterval(interval)
  }, [selected?.id])

  // Métricas para badges
  const inboxUnread = inboxConvs.length
  const pendingUnread = pendingConvs.length
  const activeUnread = activeConvs.filter(c => {
    if (!c.last_message || c.last_message.direction !== 'inbound') return false
    try { const lr = localStorage.getItem(`crm_last_read_${c.contact.id}`); return !lr || new Date(c.last_message.created_at) > new Date(lr) } catch { return false }
  }).length

  const currentConvs = tab === 'inbox' ? inboxConvs : tab === 'pending' ? pendingConvs : activeConvs
  const filteredRaw = currentConvs.filter(c =>
    c.contact.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.contact.phone?.includes(search)
  )
  // Nos Ativos, quem tem mensagem não lida sempe fica em cima — dentro de cada
  // grupo/setor a ordem por data de última mensagem é preservada (sort é
  // estável), só muda quem tem não lida pra frente da fila.
  const filtered = tab === 'active'
    ? [...filteredRaw].sort((a, b) => Number(isUnread(b)) - Number(isUnread(a)))
    : filteredRaw

  // Agrupamento por setor (só na aba ativa)
  const grouped = tab === 'active'
    ? (() => {
        const bySector = sectors.map(s => ({ sector: s, convs: filtered.filter(c => c.contact.sector_id === s.id) })).filter(g => g.convs.length > 0)
        // Contatos sem setor ou com setor inexistente — não podem sumir. Antes isso
        // sempre criava um grupo "Atendimento" novo à parte, mesmo quando o setor
        // "Atendimento" de verdade já tinha seu próprio grupo na lista — resultado:
        // dois cabeçalhos "ATENDIMENTO" separados na tela em vez de um só (bug
        // relatado: paciente sem sector_id aparecia "separado" do resto do
        // Atendimento, mesmo mesmo setor). Agora, se já existe um grupo
        // "Atendimento" (por nome), funde esses contatos nele; só cria um grupo à
        // parte se nem isso existir.
        const sectorIds = new Set(sectors.map(s => s.id))
        const semSetor = filtered.filter(c => !c.contact.sector_id || !sectorIds.has(c.contact.sector_id))
        if (semSetor.length > 0) {
          const atendimentoGroup = bySector.find(g => g.sector.name.trim().toLowerCase() === 'atendimento')
          if (atendimentoGroup) {
            atendimentoGroup.convs = [...atendimentoGroup.convs, ...semSetor]
          } else {
            bySector.push({ sector: { id: '__none__', name: 'Atendimento', color: '#22c55e' } as Sector, convs: semSetor })
          }
        }
        return bySector
      })()
    : [{ sector: null, convs: filtered }]

  function isUnread(conv: Conv): boolean {
    if (!conv.last_message || conv.last_message.direction !== 'inbound') return false
    try { const lr = localStorage.getItem(`crm_last_read_${conv.contact.id}`); return !lr || new Date(conv.last_message.created_at) > new Date(lr) } catch { return false }
  }

  function selectConversation(contact: Contact) {
    setSelected(contact)
    // Busca sofia_paused atualizado do banco
    supabase.from('contacts').select('sofia_paused, custom_fields').eq('id', contact.id).single()
      .then(({ data }) => {
        const paused = data?.sofia_paused ?? contact.sofia_paused ?? false
        setSofiaPaused(paused)
        setSelected(prev => prev ? { ...prev, sofia_paused: paused, custom_fields: data?.custom_fields ?? prev.custom_fields } : prev)
      })
    setShowList(false)
    try { localStorage.setItem(`crm_last_read_${contact.id}`, new Date().toISOString()) } catch {}
  }

  async function sendMessage() {
    if (!text.trim() || !selected || sending) return
    setSending(true)
    const agentName = agent?.name ?? null
    const isExclusiveSector = sectors.find(sector => sector.id === selected.sector_id)?.is_exclusive === true
    const privacyPrefix = !isPrivate && isExclusiveSector ? '🔒 ' : ''
    const prefix = (!isPrivate && agentName) ? `${privacyPrefix}*${agentName}:*\n` : privacyPrefix
    const content = (isPrivate ? '[INTERNO] ' : prefix) + text.trim()

    // Adiciona otimisticamente antes de salvar no banco
    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      contact_id: selected.id,
      channel: sendChannel,
      direction: 'outbound',
      content,
      media_type: null,
      media_url: null,
      status: isPrivate ? 'sent' : 'queued',
      created_at: new Date().toISOString(),
      sender_id: agent?.id ?? null,
      reply_to_id: replyTo?.id ?? null,
      external_id: null,
    }
    setMessages(prev => [...prev, tempMsg])
    setText(''); setIsPrivate(false); setReplyTo(null)

    const { data: msg } = await supabase.from('messages').insert({
      contact_id: selected.id, channel: sendChannel, direction: 'outbound',
      // send_via: sinal explícito de canal escolhido manualmente pelo operador (só quando enviado
      // pelo composer, quando o contato tem WhatsApp + Instagram vinculados). O despacho real em
      // n8n (CRM - PRINCIPAL, node "Canal Instagram?") prioriza este campo quando presente;
      // mensagens internas/automáticas nunca setam isso e continuam usando a heurística de sempre.
      send_via: bothChannelsAvailable ? sendChannel : null,
      content, status: isPrivate ? 'sent' : 'queued',
      sender_id: agent?.id ?? null,
      reply_to_id: replyTo?.id ?? null,
      quoted_external_id: replyTo?.external_id ?? null,
      quoted_text: replyTo ? (replyTo.content ?? '').replace(/^((?:🔒 )?)\*.+?:\*\n/, '$1') : null,
      quoted_from_me: replyTo ? (replyTo.direction === 'outbound') : null,
    } as any).select().single()

    // Substitui a msg temporária pela real
    if (msg) {
      setMessages(prev => prev.map(m => m.id === tempMsg.id ? msg : m))
    }
    setSending(false)
  }

  function lastPatientMessage() {
    const inbound = [...messages].reverse().find(m => m.direction === 'inbound' && (m.content || '').trim())
    return inbound?.content?.trim() || ''
  }

  // v47.06 — abre a janela de cobrança e busca as descrições prontas cadastradas
  // em Configurações → Cobrança PIX. Se não houver nenhuma, a janela funciona
  // igual, só sem os atalhos.
  // v47.14 — as descrições prontas passaram a carregar o parcelamento sugerido.
  // O formato antigo (lista de textos) continua sendo aceito, para uma
  // configuração salva antes desta versão não sumir da tela.
  function normalizarDescricoes(bruto: any): { texto: string; parcelas: number }[] {
    if (!Array.isArray(bruto)) return []
    return bruto.map((d: any) => typeof d === 'string'
      ? { texto: d, parcelas: /cirurg/i.test(d) ? 12 : 2 }
      : { texto: String(d?.texto || ''), parcelas: Number(d?.parcelas) || 1 }
    ).filter(d => d.texto)
  }

  async function carregarConfigCobranca() {
    const { data } = await supabase.from('clinic_settings').select('*').limit(1)
    const linha: any = data?.[0]
    setPixDescricoes(normalizarDescricoes(linha?.pix_config?.descricoes))
    // v48.50 — Com a chave na InfinitePay, a janela usa a configuração dela no
    // mesmo formato que já usava a do Safra (repassar_taxa, paciente_escolhe,
    // max_parcelas), marcada com _provedor para os textos e a simulação.
    const prov = String(linha?.cartao_provedor || 'safra')
    if (prov === 'infinitepay') {
      const ip = normalizarInfinitePay(linha?.infinitepay_config)
      setSafraCfg({ ...ip, ambiente: 'producao', antecipa: false, _provedor: 'infinitepay', _ip: ip })
    } else if (prov === 'desligado') {
      setSafraCfg({ _provedor: 'desligado', ambiente: 'producao', max_parcelas: 12 })
    } else {
      setSafraCfg(linha?.safra_config ? { ...linha.safra_config, _provedor: 'safra' } : null)
    }
    return linha
  }

  function abrirPix() {
    setShowPix(true); setPixErro(''); setPixOk(false)
    carregarConfigCobranca()
  }

  function abrirCartao() {
    setShowCartao(true); setCartaoErro(''); setCartaoOk(false)
    carregarConfigCobranca().then((linha: any) => {
      const padrao = linha?.safra_config?.bandeira_padrao
      if (padrao) setCartaoBandeira(padrao)
    })
  }

  async function enviarCobrancaCartao() {
    if (!selected) return
    const valor = Number(String(cartaoValor).replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(valor) || valor <= 0) { setCartaoErro('Informe um valor válido.'); return }
    setCartaoEnviando(true); setCartaoErro('')
    try {
      const res = await fetch('/api/cobranca-cartao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: selected.id,
          valor,
          parcelas: cartaoParcelas,
          bandeira: cartaoBandeira,
          descricao: cartaoDescricao.trim(),
          criado_por: agent?.id ?? null,
          criado_por_nome: agent?.name ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.erro) throw new Error(data.erro || 'Falha ao gerar a cobrança')
      // v48.50 — quando o link sai mas a mensagem não, a janela fica aberta com
      // o motivo e o link para copiar, em vez de um aviso genérico que some.
      if (data.parcial) {
        setCartaoErro(data.parcial + (data.url ? ` — Link: ${data.url}` : ''))
        setCartaoEnviando(false)
        return
      }
      setCartaoOk(true)
      setToast('Cobrança no cartão enviada!')
      setTimeout(() => setToast(''), 4000)
      setTimeout(() => { setShowCartao(false); setCartaoOk(false); setCartaoValor(''); setCartaoDescricao(''); setCartaoParcelas(1) }, 1200)
    } catch (e: any) {
      setCartaoErro(e?.message || 'Não foi possível enviar a cobrança.')
    }
    setCartaoEnviando(false)
  }

  // Simulação mostrada na janela do cartão: para cada parcelamento, quanto o
  // paciente paga e de quanto fica cada parcela. Calculado na tela para a
  // secretária ver antes de enviar; o servidor refaz a conta ao criar o link,
  // para a tela nunca ser a fonte da verdade de um valor cobrado.
  function brlCentavos(c: number) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
  const cartaoLiquidoCentavos = Math.round((Number(String(cartaoValor).replace(/\./g, '').replace(',', '.')) || 0) * 100)
  const maxParcelasCfg = Math.min(Number(safraCfg?.max_parcelas) || 12, 12)
  const cartaoInfinite = safraCfg?._provedor === 'infinitepay'
  const cartaoDesligado = safraCfg?._provedor === 'desligado'
  const cartaoEmpresa = cartaoInfinite ? 'da InfinitePay' : 'do Banco Safra'
  const opcoesParcelamento = (cartaoLiquidoCentavos > 0 && safraCfg && !cartaoDesligado)
    ? (cartaoInfinite ? simularInfinitePay(cartaoLiquidoCentavos, safraCfg._ip) : simularParcelas(cartaoLiquidoCentavos, safraCfg, cartaoBandeira))
    : Array.from({ length: maxParcelasCfg }, (_, i) => ({ parcelas: i + 1, taxa: 0, totalCentavos: 0, parcelaCentavos: 0 }))
  const opcaoEscolhida = cartaoLiquidoCentavos > 0
    ? (opcoesParcelamento.find(o => o.parcelas === cartaoParcelas) || null)
    : null

  // v47.06 — gera a cobrança PIX no servidor (que monta o código, o QR e dispara
  // as três mensagens). A tela só manda valor e descrição.
  async function enviarCobrancaPix() {
    if (!selected) return
    const valor = Number(String(pixValor).replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(valor) || valor <= 0) { setPixErro('Informe um valor válido.'); return }
    setPixEnviando(true); setPixErro('')
    try {
      const res = await fetch('/api/cobranca-pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: selected.id,
          valor,
          descricao: pixDescricao.trim(),
          criado_por: agent?.id ?? null,
          criado_por_nome: agent?.name ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.erro) throw new Error(data.erro || 'Falha ao gerar a cobrança')
      setPixOk(true)
      setToast(data.parcial ? 'Cobrança gerada, mas nem todas as mensagens saíram' : 'Cobrança PIX enviada!')
      setTimeout(() => setToast(''), 4000)
      setTimeout(() => { setShowPix(false); setPixOk(false); setPixValor(''); setPixDescricao('') }, 1200)
    } catch (e: any) {
      setPixErro(e?.message || 'Não foi possível enviar a cobrança.')
    }
    setPixEnviando(false)
  }

  function openAiModal() {
    setShowAiModal(true)
    setAiImproveError(''); setAiReplyError('')
    setAiImprove({ list: [], i: -1 })
    setAiReply({ list: [], i: -1 })
    setAiReplyInstruction('')
    // Se já tem um rascunho digitado, já gera as melhorias na hora.
    if (text.trim()) fetchAiImprove()
  }

  async function fetchAiImprove() {
    if (!selected || !text.trim()) return
    setAiImproveLoading(true); setAiImproveError('')
    try {
      const res = await fetch(WH_AI_SUGGEST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modo: 'melhorar',
          texto_atual: text.trim(),
          ultima_mensagem_paciente: lastPatientMessage(),
          contact_id: selected.id,
          nome_paciente: selected.full_name,
          quantidade: 1,
        }),
      })
      const data = await res.json()
      if (!data.sucesso) throw new Error(data.mensagem || 'Falha ao gerar sugestão')
      const nova = (data.sugestoes || [])[0]
      if (!nova) throw new Error('Sem sugestão')
      // Descarta qualquer "próxima" sugestão de uma navegação anterior (como no
      // histórico do navegador) e acrescenta a nova ao final.
      setAiImprove(s => { const list = [...s.list.slice(0, s.i + 1), nova]; return { list, i: list.length - 1 } })
    } catch (e) {
      setAiImproveError('Não foi possível gerar uma sugestão agora. Tente novamente.')
    }
    setAiImproveLoading(false)
  }

  async function fetchAiReply() {
    if (!selected) return
    setAiReplyLoading(true); setAiReplyError('')
    try {
      const res = await fetch(WH_AI_SUGGEST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modo: 'responder',
          texto_atual: '',
          ultima_mensagem_paciente: lastPatientMessage(),
          instrucao: aiReplyInstruction.trim(),
          contact_id: selected.id,
          nome_paciente: selected.full_name,
          quantidade: 1,
        }),
      })
      const data = await res.json()
      if (!data.sucesso) throw new Error(data.mensagem || 'Falha ao gerar sugestão')
      const nova = (data.sugestoes || [])[0]
      if (!nova) throw new Error('Sem sugestão')
      setAiReply(s => { const list = [...s.list.slice(0, s.i + 1), nova]; return { list, i: list.length - 1 } })
    } catch (e) {
      setAiReplyError('Não foi possível gerar uma sugestão agora. Tente novamente.')
    }
    setAiReplyLoading(false)
  }

  function aiImproveBack() { setAiImprove(s => ({ ...s, i: Math.max(0, s.i - 1) })) }
  function aiReplyBack() { setAiReply(s => ({ ...s, i: Math.max(0, s.i - 1) })) }

  function useAiSuggestion(suggestion: string) {
    setText(suggestion)
    setShowAiModal(false)
  }

  async function saveEdit() {
    if (!editingMsg || !editText.trim() || !selected) return
    // Preserva o prefixo *Nome:* original da mensagem (quem enviou)
    const originalMatch = editingMsg.content?.match(/^((?:🔒 )?\*.+?:\*\n)/)
    const originalPrefix = originalMatch ? originalMatch[1] : ''
    const newContent = originalPrefix + editText.trim()

    // Atualiza no CRM e marca como editada
    await supabase.from('messages').update({
      content: newContent, edited: true, edited_at: new Date().toISOString()
    }).eq('id', editingMsg.id)
    setMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, content: newContent, edited: true } : m))

    // Para o WhatsApp, envia só o texto sem o prefixo interno
    const textForWhatsApp = editText.trim()

    const msgBeingEdited = editingMsg
    setEditingMsg(null); setEditText('')

    // Sem external_id a mensagem nunca chegou ao WhatsApp (ainda na fila ou só interna)
    if (!msgBeingEdited.external_id) {
      setToast('Mensagem editada apenas no CRM (ainda não foi enviada ao WhatsApp)')
      return
    }

    // Pede ao n8n para editar de fato no WhatsApp (API do WAHA)
    setToast('Editando no WhatsApp...')
    try {
      const response = await fetch(WH_EDIT_MESSAGE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: msgBeingEdited.id,
          external_id: msgBeingEdited.external_id,
          contact_id: selected.id,
          phone: selected.phone,
          new_text: textForWhatsApp,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'O WhatsApp não aceitou a edição')
      }
      setToast('Mensagem editada no WhatsApp')
    } catch (error) {
      // O texto no CRM já foi alterado; deixamos claro que o WhatsApp não acompanhou,
      // em vez de dar a impressão falsa de que o paciente verá o texto novo.
      const detail = error instanceof Error ? error.message : 'falha de comunicação'
      setToast(`Editada no CRM, mas NÃO no WhatsApp (${detail})`)
    }
  }

  // v48.137 — Apagar mensagem já enviada (pedido do Jorge). Só chama o WAHA
  // pra mensagens que já têm external_id (chegaram de fato ao WhatsApp); sem
  // isso não haveria o que apagar lá. Se o WhatsApp recusar (passou da janela
  // que ele mesmo permite, ou o motor não suporta), a mensagem continua como
  // estava — nunca marcamos como apagada sem confirmação do WAHA.
  async function handleDeleteMessage(msg: Message) {
    if (!selected || !msg.external_id || deletingMsgId) return
    if (!window.confirm('Apagar esta mensagem do WhatsApp do paciente?\n\nEla continua aparecendo aqui no CRM (marcada como apagada), só some do lado do paciente.')) return
    setDeletingMsgId(msg.id)
    try {
      const response = await fetch(WH_DELETE_MESSAGE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: msg.id,
          external_id: msg.external_id,
          contact_id: selected.id,
          phone: selected.phone,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'o WhatsApp não deixou apagar')
      }
      const { error } = await supabase.from('messages')
        .update({ apagado_em: new Date().toISOString(), apagado_por: agent?.id ?? null })
        .eq('id', msg.id)
      if (error) throw new Error('apagou no WhatsApp, mas não consegui marcar aqui no CRM: ' + error.message)
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, apagado_em: new Date().toISOString(), apagado_por: agent?.id ?? null } as any : m))
      setToast('Mensagem apagada no WhatsApp do paciente')
    } catch (error) {
      // v48.137 — É exatamente o caso que o Jorge pediu para avisar: passou do
      // prazo que o WhatsApp permite, ou qualquer outro motivo — nunca falha
      // silenciosamente, e a mensagem não é tocada no CRM.
      const detail = error instanceof Error ? error.message : 'falha de comunicação'
      setToast(`Não foi possível apagar: ${detail}`)
    } finally {
      setDeletingMsgId(null)
    }
  }

  async function handleFileUpload(file: File) {
    if (!selected) return
    setUploading(true)
    const ext = file.name.split('.').pop() || 'bin'
    const fileName = `${selected.id}/${crypto.randomUUID()}.${ext}`
    const { error: uploadErr } = await supabase.storage.from('conversation-media').upload(fileName, file, { upsert: true, contentType: file.type })
    if (uploadErr) { setToast('Erro: ' + uploadErr.message); setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('conversation-media').getPublicUrl(fileName)
    const mediaType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'document'
    const isExclusiveSector = sectors.find(sector => sector.id === selected.sector_id)?.is_exclusive === true
    await supabase.from('messages').insert({ contact_id: selected.id, channel: sendChannel, send_via: bothChannelsAvailable ? sendChannel : null, direction: 'outbound', content: `${isExclusiveSector ? '🔒 ' : ''}${file.name}`, media_type: mediaType, media_url: publicUrl, status: 'queued', sender_id: agent?.id ?? null })
    setUploading(false)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream); const chunks: Blob[] = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = async () => { stream.getTracks().forEach(t => t.stop()); const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' }); await handleFileUpload(new File([blob], `audio_${Date.now()}.ogg`, { type: 'audio/ogg' })); setRecordingTime(0) }
      mr.start(); mediaRecorderRef.current = mr; setRecording(true); setRecordingTime(0)
      recordingIntervalRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch { setToast('Não foi possível acessar o microfone') }
  }
  function stopRecording() { mediaRecorderRef.current?.stop(); if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current); setRecording(false) }

  async function handleLeaveConversation() {
    if (!selected || !agent) return
    // Remove só a participação do agente atual — o dono continua
    await supabase.from('conversation_participants')
      .delete()
      .eq('contact_id', selected.id)
      .eq('agent_id', agent.id)
    await supabase.from('messages').insert({
      contact_id: selected.id, channel: 'whatsapp', direction: 'outbound',
      content: `[INTERNO] 👋 ${agent.name} saiu da conversa`,
      status: 'sent', sender_id: agent.id,
    })
    setToast('Você saiu da conversa')
    closeConversation()
    setActiveConvs(prev => prev.filter(c => c.contact.id !== selected.id))
    setTimeout(() => loadAll(true), 500)
  }

  async function toggleSofia() {
    if (!selected) return
    if (selected.custom_fields?.sofia_never_respond === true) {
      setToast('Bloqueio permanente ativo no cadastro deste paciente')
      return
    }
    // Com a Sofia pausada globalmente, o botão individual funciona como uma
    // exceção explícita para este paciente. Um segundo clique remove a exceção.
    if (sofiaGlobalPaused) {
      const customFields = selected.custom_fields ?? {}
      const forceActive = customFields.sofia_force_active === true
      const nextCustomFields = { ...customFields, sofia_force_active: !forceActive }
      const { error } = await supabase.from('contacts').update({
        sofia_paused: false,
        custom_fields: nextCustomFields,
      }).eq('id', selected.id)
      if (error) { setToast('Erro: ' + error.message); return }
      setSofiaPaused(false)
      setSelected(prev => prev ? { ...prev, sofia_paused: false, custom_fields: nextCustomFields } : prev)
      setToast(!forceActive ? `${assistantName} ativada somente para este paciente` : `${assistantName} voltou a seguir a pausa global`)
      return
    }
    // Busca estado atual do banco para não usar estado stale
    const { data: fresh } = await supabase.from('contacts').select('sofia_paused').eq('id', selected.id).single()
    const currentPaused = fresh?.sofia_paused ?? sofiaPaused
    const newVal = !currentPaused
    setSofiaPaused(newVal)
    await supabase.from('contacts').update({ sofia_paused: newVal }).eq('id', selected.id)
    setSelected(prev => prev ? { ...prev, sofia_paused: newVal } : prev)
    setToast(newVal ? `${assistantName} pausada` : `${assistantName} ativada`)
  }

  async function toggleSofiaGlobal() {
    setTogglingGlobal(true)
    const newVal = !sofiaGlobalPaused
    // Atualiza e retorna as linhas afetadas para confirmar
    const { data, error } = await supabase.from('clinic_settings')
      .update({ sofia_paused_global: newVal })
      .not('id', 'is', null)
      .select()
    if (error) { setToast('Erro: ' + error.message); setTogglingGlobal(false); return }
    if (!data || data.length === 0) {
      setToast('Erro: nenhuma configuração atualizada (verifique clinic_settings)')
      setTogglingGlobal(false)
      return
    }
    setSofiaGlobalPaused(newVal)
    setToast(newVal ? `${assistantName} pausada para todos` : `${assistantName} ativada para todos`)
    setTogglingGlobal(false)
  }

  async function handleScheduleMessage() {
    if (!text.trim() || !selected || !scheduleDate || !scheduleTime) return
    await supabase.from('scheduled_messages').insert({ contact_id: selected.id, content: text.trim(), scheduled_for: new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString(), origin: 'manual', created_by: agent?.id ?? null })
    setText(''); setShowSchedule(false); setToast('Mensagem agendada!')
  }

  async function handleCloseConversation() {
    if (!selected || !agent) return
    setClosingConv(true)

    const contactId = selected.id

    // Busca o estado ATUAL e real da conversa direto do banco, em vez de
    // confiar no objeto `selected` em memória. Isso evita agir sobre uma
    // conversa "desatualizada" (ex: aberta pela busca em vez da lista de
    // atendimentos, ou que mudou de dono/participantes desde que foi
    // carregada) — foi o que causou o envio indevido do link de avaliação
    // em 2026-08-04.
    const { data: freshContact, error: freshContactErr } = await supabase
      .from('contacts').select('assigned_to, full_name').eq('id', contactId).maybeSingle()
    const { data: parts } = await supabase.from('conversation_participants')
      .select('agent_id').eq('contact_id', contactId)
    const participantIds = (parts ?? []).map((p: any) => p.agent_id)

    if (freshContactErr || !freshContact) {
      setToast('Não foi possível confirmar o estado atual da conversa. Tente novamente.')
      setClosingConv(false)
      return
    }

    const iAmOwner = freshContact.assigned_to === agent.id
    const iAmParticipant = participantIds.includes(agent.id)
    // v47.14 — conversa parada no inbox, sem dono e sem participante: qualquer
    // atendente pode encerrar sem precisar assumir antes. É o caso do contato que
    // escreveu por engano, do vendedor, do número errado — não faz sentido obrigar
    // alguém a assumir um atendimento só para poder fechá-lo.
    const semNinguem = !freshContact.assigned_to && participantIds.length === 0
    if (!iAmOwner && !iAmParticipant && !semNinguem) {
      // Este atendente não está mais nesta conversa (provavelmente já saiu
      // antes, ou a conversa mudou de mãos desde que foi aberta). Não deixa
      // finalizar — e principalmente não deixa oferecer/enviar o link de
      // avaliação para um paciente que não é dele agora.
      setToast('Você não está mais neste atendimento — a conversa foi atualizada. Abra-a novamente na lista.')
      setClosingConv(false)
      return
    }

    // Marca esse contato como "recém-fechado" para o loadAll() não reinseri-lo na lista
    // de conversas ativas por causa da lógica de preservar contato selecionado.
    closingIdRef.current = contactId

    // Quem mais está na conversa além de mim?
    const others = participantIds.filter((id: string) => id !== agent.id)
    // Se sou dono, os outros são os participantes. Se sou participante, o dono também conta.
    const ownerStillThere = !iAmOwner && freshContact.assigned_to && freshContact.assigned_to !== agent.id
    const remainingPeople = ownerStillThere ? [freshContact.assigned_to, ...others] : others

    if (remainingPeople.length > 0) {
      // Ainda há gente na conversa — eu apenas saio
      if (iAmOwner) {
        // Sou dono saindo — passo a titularidade para o primeiro participante
        const newOwner = others[0]
        const { data: newOwnerData } = await supabase.from('agents').select('name').eq('id', newOwner).single()
        await supabase.from('conversation_participants').delete()
          .eq('contact_id', contactId).eq('agent_id', newOwner)
        await supabase.from('contacts').update({
          assigned_to: newOwner,
          conversation_status: 'active',
          updated_at: new Date().toISOString(),
        }).eq('id', contactId)
        await supabase.from('messages').insert({
          contact_id: contactId, channel: 'whatsapp', direction: 'outbound',
          content: `[INTERNO] 👋 ${agent.name} finalizou sua parte. ${newOwnerData?.name} continua o atendimento.`,
          status: 'sent', sender_id: agent.id,
        })
      } else {
        // Sou participante saindo — só removo minha participação
        await supabase.from('conversation_participants').delete()
          .eq('contact_id', contactId).eq('agent_id', agent.id)
        await supabase.from('messages').insert({
          contact_id: contactId, channel: 'whatsapp', direction: 'outbound',
          content: `[INTERNO] 👋 ${agent.name} finalizou sua parte no atendimento.`,
          status: 'sent', sender_id: agent.id,
        })
      }
      setToast('Você saiu do atendimento')
    } else {
      // Sou o último — fecha de vez
      // A oferta do link pertence exclusivamente ao fluxo da secretária.
      // Administradores, médicos e demais perfis finalizam sem esta pergunta.
      let sendGoogleReview = false
      // Ninguém atendeu esta conversa — não faz sentido pedir avaliação de um
      // atendimento que não houve. A oferta continua valendo no fluxo normal.
      if (!semNinguem && isSecretaryJobTitle(agent.job_title)) {
        const patientLabel = freshContact.full_name || selected.full_name || 'o paciente'
        sendGoogleReview = await new Promise<boolean>((resolve) => {
          setReviewConfirm({ contactName: patientLabel, resolve })
        })
      }
      if (sendGoogleReview) {
        const { data: settings, error: settingsErr } = await supabase.from('clinic_settings')
          .select('sofia_config').limit(1).maybeSingle()
        const reviewUrl = String(settings?.sofia_config?.google_review_url ?? '').trim()
        if (settingsErr || !reviewUrl) {
          setToast('Link de avaliação do Google não configurado na Agenda de IA')
          setClosingConv(false); setShowMenu(false)
          if (closingIdRef.current === contactId) closingIdRef.current = null
          return
        }
        const reviewText = `Olá! Sua opinião é muito importante para nós. Se puder, deixe sua avaliação no Google pelo link abaixo:\n\n${reviewUrl}\n\nAgradecemos pela confiança! 💙`
        const { error: reviewErr } = await supabase.from('messages').insert({
          contact_id: contactId,
          channel: sendChannel,
          send_via: bothChannelsAvailable ? sendChannel : null,
          direction: 'outbound',
          content: reviewText,
          status: 'queued',
          sender_id: agent.id,
        })
        if (reviewErr) {
          setToast('Não foi possível enfileirar o link de avaliação: ' + reviewErr.message)
          setClosingConv(false); setShowMenu(false)
          if (closingIdRef.current === contactId) closingIdRef.current = null
          return
        }
      }
      await supabase.from('conversation_participants').delete().eq('contact_id', contactId)
      await supabase.from('messages').insert({
        contact_id: contactId, channel: 'whatsapp', direction: 'outbound',
        content: `[INTERNO] ✅ Atendimento finalizado por ${agent.name}`,
        status: 'sent', sender_id: agent.id,
      })
      const { error: closeErr } = await supabase.from('contacts').update({
        conversation_status: 'closed',
        assigned_to: null,
        sofia_paused: selected?.id === contactId && selected.custom_fields?.sofia_never_respond === true,
        updated_at: new Date().toISOString()
      }).eq('id', contactId)
      if (closeErr) {
        // A coluna sofia_paused é NOT NULL — nunca enviar null aqui.
        // Se der erro mesmo assim, avisa o atendente em vez de falhar silenciosamente.
        console.error('Erro ao finalizar atendimento:', closeErr)
        setToast('Erro ao finalizar atendimento: ' + closeErr.message)
        setClosingConv(false); setShowMenu(false)
        if (closingIdRef.current === contactId) closingIdRef.current = null
        return
      }
      setToast(sendGoogleReview ? 'Link de avaliação enviado e conversa finalizada' : 'Conversa finalizada')
    }

    setInboxConvs(prev => prev.filter(c => c.contact.id !== contactId))
    setPendingConvs(prev => prev.filter(c => c.contact.id !== contactId))
    setActiveConvs(prev => prev.filter(c => c.contact.id !== contactId))
    setClosingConv(false); setShowMenu(false)
    closeConversation()
    setTimeout(async () => {
      await loadAll(true)
      // Só libera a "trava" depois que o reload que precisava respeitar o fechamento já rodou
      if (closingIdRef.current === contactId) closingIdRef.current = null
    }, 500)
  }

  // v48.51 — "Bloquear contato" do menu passa a perguntar QUAL canal, pela
  // mesma janela e a mesma regra (lib/bloqueio.ts) da tela de Contatos. Antes
  // ele bloqueava tudo de uma vez, com uma regra própria que não gravava as
  // marcas por canal.
  function handleBlockContact() {
    if (!selected || !agent) return
    setShowMenu(false)
    setBloqueioAberto(true)
  }

  async function aplicarBloqueioAtendimento(canais: CanalBloqueio[], acao: 'bloquear' | 'desbloquear') {
    if (!selected || !agent) return
    const alvo = selected
    const { erro } = acao === 'bloquear'
      ? await bloquearContato(alvo, agent, canais)
      : await desbloquearContato(alvo, agent, canais)
    setBloqueioAberto(false)
    if (erro) { setToast((acao === 'bloquear' ? 'Não foi possível bloquear: ' : 'Não foi possível desbloquear: ') + erro); return }

    const { data: atualizado } = await supabase.from('contacts').select('*').eq('id', alvo.id).single()
    const completo = acao === 'bloquear' && atualizado && bloqueadoPorCompleto(atualizado as Contact)
    if (completo) {
      await supabase.from('conversation_participants').delete().eq('contact_id', alvo.id)
      setInboxConvs(prev => prev.filter(c => c.contact.id !== alvo.id))
      setPendingConvs(prev => prev.filter(c => c.contact.id !== alvo.id))
      setActiveConvs(prev => prev.filter(c => c.contact.id !== alvo.id))
      setToast('Contato bloqueado')
      closeConversation()
      return
    }
    if (atualizado) setSelected(atualizado as Contact)
    setToast(acao === 'bloquear' ? `Bloqueado no ${textoDosCanais(canais)}` : `Desbloqueado no ${textoDosCanais(canais)}`)
    loadAll(true)
  }

  async function assumeConversation(contactId?: string) {
    const cId = contactId || selected?.id
    if (!cId || !agent) return

    // Busca o contato para saber o setor atual
    const { data: contactData } = await supabase.from('contacts').select('sector_id, conversation_status, assigned_to').eq('id', cId).single()

    // Alguém já assumiu antes da nossa tela atualizar (ex.: internet lenta) — não
    // sobrescreve. Sem essa checagem, "Assumir" simplesmente rouba o atendimento
    // de quem já tinha pego, mesmo que a lista aqui ainda mostrasse como livre.
    if (contactData?.assigned_to) {
      setToast('Este atendimento já foi assumido por outro atendente.')
      setInboxConvs(prev => prev.filter(c => c.contact.id !== cId))
      setPendingConvs(prev => prev.filter(c => c.contact.id !== cId))
      loadAll(true)
      return
    }

    // Se já tem setor (pendente de setor ou transferido), mantém. Se veio do INBOX sem setor, busca Atendimento
    let targetSector = contactData?.sector_id
    if (!targetSector) {
      const localDefault = sectors.find(s => s.name.trim().toLowerCase() === 'atendimento')
        ?? sectors.find(s => s.name.toLowerCase().includes('atendimento'))
      if (localDefault) targetSector = localDefault.id
      else {
        const { data: sectorRows } = await supabase.from('sectors').select('id, name').ilike('name', '%atendimento%').limit(10)
        targetSector = sectorRows?.find(s => s.name.trim().toLowerCase() === 'atendimento')?.id ?? sectorRows?.[0]?.id ?? null
      }
    }

    // Update condicional: só efetiva se ninguém assumiu entre a leitura acima e
    // agora (mesma proteção, cobrindo a corrida de milissegundos, não só o caso
    // já visivelmente atribuído verificado em cima).
    const { data: claimed } = await supabase.from('contacts').update({
      assigned_to: agent.id,
      sector_id: targetSector,
      conversation_status: 'active',
      sofia_paused: true,
      updated_at: new Date().toISOString(),
    }).eq('id', cId).is('assigned_to', null).select('id')

    if (!claimed || claimed.length === 0) {
      setToast('Este atendimento já foi assumido por outro atendente.')
      setInboxConvs(prev => prev.filter(c => c.contact.id !== cId))
      setPendingConvs(prev => prev.filter(c => c.contact.id !== cId))
      loadAll(true)
      return
    }

    await supabase.from('messages').insert({
      contact_id: cId, channel: 'whatsapp', direction: 'outbound',
      content: `[INTERNO] 🔄 Atendimento assumido por ${agent.name}`,
      status: 'sent', sender_id: agent.id,
    })

    setToast('Atendimento assumido!')
    // Remove de INBOX e pendentes imediatamente
    setInboxConvs(prev => prev.filter(c => c.contact.id !== cId))
    setPendingConvs(prev => prev.filter(c => c.contact.id !== cId))

    if (selected?.id === cId) {
      const updated = { ...selected, assigned_to: agent.id, sector_id: targetSector, conversation_status: 'active' as const, sofia_paused: true }
      setSelected(updated)
      setSofiaPaused(true)
      changeTab('active')
      // Adiciona em ativos imediatamente
      setActiveConvs(prev => prev.find(c => c.contact.id === cId) ? prev : [{ contact: updated, last_message: null }, ...prev])
    }
    setTimeout(() => loadAll(true), 500)
  }

  async function startConversation() {
    if (!selected) return
    const localDefault = sectors.find(s => s.name.trim().toLowerCase() === 'atendimento')
      ?? sectors.find(s => s.name.toLowerCase().includes('atendimento'))
    let targetSector = selected.sector_id || localDefault?.id || null
    if (!targetSector) {
      const { data: sectorRows } = await supabase.from('sectors').select('id, name').ilike('name', '%atendimento%').limit(10)
      targetSector = sectorRows?.find(s => s.name.trim().toLowerCase() === 'atendimento')?.id ?? sectorRows?.[0]?.id ?? null
    }
    await supabase.from('contacts').update({
      conversation_status: 'active',
      sector_id: targetSector,
      assigned_to: agent?.id ?? selected.assigned_to ?? null,
      sofia_paused: true,  // Desativa Sofia ao iniciar
      updated_at: new Date().toISOString()
    }).eq('id', selected.id)
    await supabase.from('messages').insert({
      contact_id: selected.id, channel: 'whatsapp', direction: 'outbound',
      content: `[INTERNO] ▶️ Atendimento iniciado por ${agent?.name ?? 'Atendente'}`,
      status: 'sent', sender_id: agent?.id ?? null,
    })
    const updatedContact = { ...selected, conversation_status: 'active' as const, sector_id: targetSector, assigned_to: agent?.id ?? selected.assigned_to ?? null }
    setSelected(updatedContact)
    // Atualiza a lista de pendentes removendo imediatamente
    setPendingConvs(prev => prev.filter(c => c.contact.id !== selected.id))
    // Adiciona em ativos imediatamente
    setActiveConvs(prev => {
      if (prev.find(c => c.contact.id === selected.id)) return prev
      return [{ contact: updatedContact, last_message: null }, ...prev]
    })
    setToast('Atendimento iniciado!')
    changeTab('active')
    // Reload após delay para sincronizar com banco
    setTimeout(() => loadAll(true), 500)
  }

  // Atualiza ao voltar para a aba
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      loadAll(true)
      // v47.12 — a lista de conversas já era recarregada aqui, mas a conversa
      // ABERTA não. Se o realtime tinha caído, a tela ficava congelada mesmo
      // depois de voltar para a aba.
      const c = selectedRef.current
      if (c) verificarNovasMensagens(c.id)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  // v47.12 — Rede de segurança da conversa aberta.
  //
  // O que aconteceu: o CRM depende do realtime do Supabase (websocket) para
  // mostrar mensagem nova. Quando esse websocket cai — e ele cai sozinho num
  // deploy do CRM, ao fechar o notebook, ou numa oscilação de rede — a conversa
  // aberta simplesmente para de receber, sem aviso nenhum. A mensagem chega no
  // WhatsApp, é gravada no banco, a Sofia responde, e a tela continua parada.
  // Foi exatamente isso que aconteceu no teste do PIX.
  //
  // A correção não é substituir o realtime (que continua sendo o caminho rápido)
  // e sim ter uma conferência periódica leve: a cada 15 segundos, só com a aba à
  // vista, pergunta se existe algo mais novo do que a última mensagem já na tela.
  // Não é a recarga inteira da conversa — é uma consulta pequena, pelo horário da
  // última mensagem, justamente para não pesar no plano do Supabase.
  async function verificarNovasMensagens(contactId: string) {
    const atuais = messagesRef.current
    const ultima = atuais.filter(m => !m.id.startsWith('temp-')).slice(-1)[0]
    const q = supabase.from('messages').select('*').eq('contact_id', contactId)
      .order('created_at', { ascending: true }).limit(50)
    const { data } = ultima ? await q.gt('created_at', ultima.created_at) : await q
    const novas = (data ?? []) as Message[]
    if (!novas.length) return
    if (selectedRef.current?.id !== contactId) return
    setMessages(prev => {
      const faltando = novas.filter(n => !prev.find(m => m.id === n.id))
      return faltando.length ? [...prev, ...faltando] : prev
    })
  }

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const c = selectedRef.current
      if (c) verificarNovasMensagens(c.id)
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  // Badge no título — persiste entre navegações via localStorage
  useEffect(() => {
    const total = inboxConvs.length + pendingConvs.length + activeUnread
    const base = 'Obesity Health CRM'
    const title = total > 0 ? `(${total}) ${base}` : base
    document.title = title
    try { localStorage.setItem('crm_badge_total', String(total)); localStorage.setItem('crm_badge_base', base) } catch {}

    // Som quando INBOX cresce
    if (inboxConvs.length > prevInboxCountRef.current && prevInboxCountRef.current > 0) {
      playSound('inbox')
    }
    prevInboxCountRef.current = inboxConvs.length

    // Som quando Pendentes cresce
    if (pendingConvs.length > prevPendingCountRef.current && prevPendingCountRef.current > 0) {
      playSound('transfer')
    }
    prevPendingCountRef.current = pendingConvs.length
  }, [inboxConvs.length, pendingConvs.length, activeUnread])

  function handleContactUpdated(updated: Contact) { setSelected(updated); loadAll() }

  const isPending = selected?.conversation_status === 'pending'
  const isClosed = selected?.conversation_status === 'closed'
  const isInboxFree = !selected?.assigned_to && selected?.conversation_status !== 'pending' && selected?.conversation_status !== 'closed'

  // Disponibilidade de cada canal para o contato selecionado — usado pelo
  // seletor de canal de envio no composer (ver sendChannel acima).
  const hasWhatsAppChannel = !!selected?.phone && !selected.phone.startsWith('ig:')
  const hasInstagramChannel = !!(selected?.custom_fields?.instagram_psid || selected?.custom_fields?.ig_sender_psid || selected?.custom_fields?.channel === 'instagram')
  const bothChannelsAvailable = hasWhatsAppChannel && hasInstagramChannel

  // Canal da mensagem mais recente da conversa aberta — usado para o selo de
  // canal e o rótulo no cabeçalho, em vez do canal fixo de quando o contato
  // foi criado (que pode não refletir mais por onde a conversa está indo).
  // Ignora notas internas ("[INTERNO] ..."): elas sempre gravam channel:
  // 'whatsapp' independente do canal real da conversa (ver ex. linha ~776).
  const lastRealMsg = [...messages].reverse().find(m => !m.content?.startsWith('[INTERNO]'))
  const lastMsgChannel = lastRealMsg?.channel ?? (selected?.custom_fields?.channel ?? null)
  function canReadPrivateSectorMessage(message: Message, contact: Contact) {
    return canReadPrivateMessage(message, contact.sector_id, sectors, agentSectorIds)
  }

  const fmt = (s: number) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`

  // ── LISTA DE CONVERSAS ────────────────────────────────────────────────────
  function ConvList() {
    return (
      <div className="flex flex-col h-full">
        {/* Header com Sofia global */}
        <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">Conversas</span>
            <button onClick={toggleSofiaGlobal} disabled={togglingGlobal}
              className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium border',
                sofiaGlobalPaused ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-brand-50 border-brand-200 text-brand-600')}>
              <Bot size={9}/>{togglingGlobal ? '...' : sofiaGlobalPaused ? 'Pausada' : 'Ativa'}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setListPinned(v => !v)} className="hidden md:flex p-1 hover:bg-slate-100 rounded text-slate-400">
              {listPinned ? <ChevronLeft size={13}/> : <ChevronRight size={13}/>}
            </button>
            <button onClick={atualizarAgora} disabled={atualizando} title="Atualizar conversas"
              className="md:hidden p-1 hover:bg-slate-100 rounded text-slate-400 disabled:opacity-50">
              <RefreshCw size={13} className={atualizando ? 'animate-spin' : undefined}/>
            </button>
            <button onClick={() => setShowList(false)} className="md:hidden p-1 hover:bg-slate-100 rounded text-slate-400"><X size={13}/></button>
          </div>
        </div>

        {/* Abas INBOX / Pendentes / Ativos */}
        <div className="flex border-b border-slate-100 flex-shrink-0">
          {([
            { key: 'inbox', label: 'INBOX', count: inboxUnread, bell: inboxUnread > 0, bellColor: 'text-amber-500' },
            { key: 'pending', label: 'Pendentes', count: pendingUnread, bell: pendingUnread > 0, bellColor: 'text-red-500' },
            { key: 'active', label: 'Ativos', count: activeUnread, bell: activeUnread > 0, bellColor: 'text-red-500' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => changeTab(t.key)}
              className={clsx('flex-1 flex flex-col items-center py-2 text-xs font-medium transition-colors relative',
                tab === t.key ? 'text-brand-700 border-b-2 border-brand-600' : 'text-slate-400 hover:text-slate-600')}>
              <div className="flex items-center gap-1">
                {t.bell && <Bell size={10} className={clsx('animate-pulse', t.bellColor)}/>}
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span className={clsx('text-[10px] px-1 rounded-full font-bold', tab === t.key ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>
                    {t.count}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Busca */}
        <div className="px-3 py-2 flex-shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..."
              className="w-full pl-7 pr-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loading && filtered.length === 0 ? <div className="flex items-center justify-center h-16 text-slate-400 text-xs"><Loader2 size={12} className="animate-spin mr-1"/>Carregando...</div> : (
            <>
              {filtered.length === 0 && (
                <div className="flex items-center justify-center h-24 text-slate-400 text-xs">Nenhuma conversa</div>
              )}
              {grouped.map((group, gi) => (
                <div key={gi}>
                  {group.sector && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: group.sector.color }}/>
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate">{group.sector.name}</span>
                      <span className="text-xs text-slate-400 ml-auto">{group.convs.length}</span>
                    </div>
                  )}
                  {group.convs.map(conv => {
                    const unread = isUnread(conv)
                    const isPend = conv.contact.conversation_status === 'pending'
                    const canReadPreview = !conv.last_message || canReadPrivateSectorMessage(conv.last_message, conv.contact)
                    return (
                      <button key={conv.contact.id} onClick={() => selectConversation(conv.contact)}
                        className={clsx('w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition-colors flex items-center gap-2',
                          selected?.id === conv.contact.id && 'bg-brand-50 border-l-2 border-l-brand-500',
                          unread && selected?.id !== conv.contact.id && 'bg-blue-50/40')}>
                        <div className="relative flex-shrink-0">
                          <ContactAvatar avatarUrl={conv.contact.avatar_url} name={conv.contact.full_name} id={conv.contact.id}/>
                          {(conv.last_message as any)?.send_via === 'birthday_flow' && conv.last_message?.created_at && new Date(conv.last_message.created_at).toDateString() === new Date().toDateString()
                            ? <div title="Aniversário" className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center border-2 border-white shadow-sm bg-white text-[8px] leading-none">🎂</div>
                            : <ChannelBadge channel={conv.last_message?.channel ?? conv.contact.custom_fields?.channel} accountName={conv.contact.custom_fields?.ig_account_name} size={12}/>}
                          {(unread || isPend) && <span className={clsx('absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white', unread ? 'bg-red-500' : 'bg-emerald-400')}/>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1 min-w-0">
                              <p className={clsx('text-xs truncate', unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700')}>{conv.contact.full_name}</p>
                              {participantContacts.has(conv.contact.id) && (
                                <span title="Atendimento em grupo" className="text-[10px] flex-shrink-0">👥</span>
                              )}
                            </div>
                            {conv.last_message && <span className={clsx('text-[10px] flex-shrink-0', unread ? 'text-red-500 font-medium' : 'text-slate-400')}>{formatDistanceToNow(new Date(conv.last_message.created_at), { locale: ptBR })}</span>}
                          </div>
                          <p className="text-xs text-slate-400 truncate">
                            {!canReadPreview ? '🔒 Mensagem privada' : (conv.last_message?.content?.replace('[INTERNO] ','').replace(/^((?:🔒 )?)\*.+:\*\n/,'$1')) || (conv.last_message?.media_type ? `[${conv.last_message.media_type}]` : tab === 'inbox' ? 'Aguardando atendimento' : tab === 'pending' ? 'Aguardando início' : 'Sem mensagens')}
                          </p>
                        </div>
                        {/* Botão assumir rápido no INBOX */}
                        {tab === 'inbox' && !conv.contact.assigned_to && (
                          <button onClick={e => { e.stopPropagation(); assumeConversation(conv.contact.id) }}
                            className="flex-shrink-0 p-1 hover:bg-emerald-100 rounded text-emerald-600" title="Assumir">
                            <CheckCircle2 size={14}/>
                          </button>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    )
  }

  // ── RENDER PRINCIPAL ───────────────────────────────────────────────────────
  return (
    // v48.36 — A faixa de canal fora fica por cima de tudo, na tela onde as
    // pessoas passam o dia. Ver components/AvisoCanalFora.tsx.
    <div className="flex flex-col bg-surface overflow-hidden" style={{ height: '100dvh' }}>
      <AvisoCanalFora/>
      <div className="flex flex-1 min-h-0 overflow-hidden">
      <Sidebar/>
      <input ref={fileInputRef} type="file" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])}/>

      {/* DESKTOP: lista */}
      <div className="hidden md:flex flex-shrink-0 bg-white border-r border-slate-100 flex-col relative transition-[width] duration-150"
        style={{ width: listExpanded ? listWidth : COLLAPSED }}
        onMouseEnter={() => setListHovered(true)} onMouseLeave={() => setListHovered(false)}>
        {listExpanded ? <ConvList/> : (
          <div className="flex flex-col items-center gap-2 pt-3">
            <button onClick={() => setListPinned(true)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400"><Menu size={16}/></button>
            {/* Indicadores de abas colapsadas */}
            {[{ t: 'inbox' as Tab, count: inboxUnread, color: 'bg-emerald-400' }, { t: 'pending' as Tab, count: pendingUnread, color: 'bg-red-500' }, { t: 'active' as Tab, count: activeUnread, color: 'bg-red-500' }].map(item => (
              <button key={item.t} onClick={() => { changeTab(item.t); setListPinned(true) }}
                className={clsx('relative p-2 rounded-lg text-xs font-bold', tab === item.t ? 'bg-brand-100 text-brand-700' : 'text-slate-400 hover:bg-slate-100')}>
                {item.t === 'inbox' ? 'IN' : item.t === 'pending' ? 'PE' : 'AT'}
                {item.count > 0 && <span className={clsx('absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full', item.color)}/>}
              </button>
            ))}
          </div>
        )}
        {listExpanded && <div onMouseDown={onResizeStart} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-brand-200 z-10"/>}
      </div>

      {/* MOBILE: drawer */}
      {showList && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="w-80 max-w-[85vw] bg-white h-full shadow-2xl flex flex-col"><ConvList/></div>
          <div className="flex-1 bg-black/30" onClick={() => setShowList(false)}/>
        </div>
      )}

      {/* CONVERSA */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full pb-16 md:pb-0">
          {/* Header fixo no topo */}
          <div className="bg-white border-b border-slate-100 px-4 py-2.5 flex items-center justify-between flex-shrink-0 z-20" style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowList(true)} className="md:hidden p-1.5 -ml-1 text-slate-400 hover:bg-slate-100 rounded-lg"><Menu size={16}/></button>
              <button onClick={atualizarAgora} disabled={atualizando} title="Atualizar mensagens"
                className="md:hidden p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-50">
                <RefreshCw size={16} className={atualizando ? 'animate-spin' : undefined}/>
              </button>
              <div className="relative flex-shrink-0">
                <ContactAvatar avatarUrl={selected.avatar_url} name={selected.full_name} id={selected.id} onClick={() => selected.avatar_url && setZoomedPhotoUrl(selected.avatar_url)}/>
                <ChannelBadge channel={lastMsgChannel} accountName={selected.custom_fields?.ig_account_name} size={12}/>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800">{selected.full_name}</p>
                  {selected.custom_fields?.sofia_never_respond === true && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold" title={`${assistantName} nunca responde a este paciente`}>
                      <Bot size={10}/> {assistantName} bloqueada
                    </span>
                  )}
                  {participantContacts.has(selected.id) && (
                    <span title="Atendimento em grupo" className="text-sm">👥</span>
                  )}
                  {/* Assumir — aparece no INBOX sem dono */}
                  {isInboxFree && (
                    <button onClick={() => assumeConversation()}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white">
                      <CheckCircle2 size={10}/> Assumir
                    </button>
                  )}
                  {/* Iniciar — aparece no Pendente */}
                  {isPending && (
                    <button onClick={startConversation}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white">
                      <Play size={10}/> Iniciar
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  {lastMsgChannel === 'instagram' && selected.phone?.startsWith('ig:')
                    ? `Instagram${selected.custom_fields?.ig_account_name ? ' · ' + selected.custom_fields.ig_account_name : ''}`
                    : (selected.phone || 'Sem telefone')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={toggleSofia} disabled={selected.custom_fields?.sofia_never_respond === true}
                title={sofiaGlobalPaused ? `${assistantName} está pausada globalmente. Clique para liberar somente este atendimento.` : undefined}
                className={clsx('flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border',
                  selected.custom_fields?.sofia_never_respond === true ? 'bg-rose-50 border-rose-200 text-rose-700 cursor-not-allowed' :
                  ((sofiaGlobalPaused && selected.custom_fields?.sofia_force_active !== true) || sofiaPaused) ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-brand-50 border-brand-200 text-brand-700')}>
                <Bot size={11}/>{selected.custom_fields?.sofia_never_respond === true ? (<><span className="hidden sm:inline">Bloqueada neste paciente</span><span className="sm:hidden">Bloqueada</span></>) :
                  sofiaGlobalPaused ? (selected.custom_fields?.sofia_force_active === true ? 'Ativa neste paciente' : 'Pausada (Global)') :
                  sofiaPaused ? 'Pausada' : 'Ativa'}
              </button>
              <div className="relative" ref={menuRef}>
                <button onClick={() => setShowMenu(v => !v)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500"><MoreVertical size={15}/></button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-20">
                    {isInboxFree && <button onClick={() => { assumeConversation(); setShowMenu(false) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 text-left"><CheckCircle2 size={14}/> Assumir</button>}
                    {isPending && <button onClick={() => { startConversation(); setShowMenu(false) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50 text-left"><Play size={14}/> Iniciar atendimento</button>}
                    <button onClick={() => { setShowSidePanel(true); setShowMenu(false) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"><User size={14} className="text-slate-400"/> Dados do paciente</button>
                    <button onClick={() => { setSidePanelRecibos(true); setShowSidePanel(true); setShowMenu(false) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"><Receipt size={14} className="text-slate-400"/> Recibos</button>
                    <button onClick={() => { setSidePanelSchedule(true); setShowSidePanel(true); setShowMenu(false) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50 text-left"><CalendarClock size={14}/> Agendar consulta</button>
                    <button onClick={() => { setSidePanelRetorno(true); setShowSidePanel(true); setShowMenu(false) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50 text-left">📅 Agendar msg de retorno</button>
                    <button onClick={() => { setShowScheduleMsg(true); setShowMenu(false) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-brand-700 hover:bg-brand-50 text-left"><Send size={14}/> Agendar mensagem</button>
                    <button onClick={() => { setShowInvite(true); setShowMenu(false) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"><UserPlus size={14} className="text-slate-400"/> Convidar atendente</button>
                    <button onClick={() => { setShowAssign(true); setShowMenu(false) }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"><Send size={14} className="text-slate-400"/> Transferir</button>
                    {/* v47.14 — Cobrança em bloco próprio, com fundo diferente, logo acima
                        de bloquear/finalizar. São as duas ações que envolvem dinheiro:
                        ficam juntas e visualmente separadas do resto do menu. */}
                    <div className="my-1 mx-1.5 rounded-lg bg-emerald-50/70 border border-emerald-100 py-1">
                      <p className="px-2.5 pt-0.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700/70">Cobrança</p>
                      <button onClick={() => { abrirPix(); setShowMenu(false) }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100/70 rounded-md text-left">
                        <QrCode size={14}/> Enviar via PIX
                      </button>
                      <button onClick={() => { abrirCartao(); setShowMenu(false) }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100/70 rounded-md text-left">
                        <CreditCard size={14}/> Enviar no cartão
                      </button>
                    </div>
                    <div className="h-px bg-slate-100 my-1"/>
                    <button onClick={handleBlockContact} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-rose-700 hover:bg-rose-50 text-left">
                      <Ban size={14}/> Bloquear contato
                    </button>
                    <button onClick={handleCloseConversation} disabled={closingConv} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 text-left disabled:opacity-50">
                      {closingConv ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>}
                      {participantContacts.has(selected.id) ? 'Finalizar minha parte' : 'Finalizar atendimento'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mensagens */}
          <div className="flex-1 min-h-0 relative">
          <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="h-full overflow-y-auto overflow-x-hidden px-4 py-3 space-y-2">
            {messages.map((msg, i) => {
              const isInternal = msg.content?.startsWith('[INTERNO] ') ?? false
              const isOut = msg.direction === 'outbound'
              const isSofia = isOut && !msg.sender_id && !isInternal
              const messagePrivate = !canReadPrivateSectorMessage(msg, selected)
              const showDate = i === 0 || new Date(messages[i-1].created_at).toDateString() !== new Date(msg.created_at).toDateString()
              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex items-center gap-3 my-2">
                      <div className="flex-1 h-px bg-slate-200"/>
                      <span className="text-xs text-slate-400 px-2">{format(new Date(msg.created_at), "d 'de' MMM", { locale: ptBR })}</span>
                      <div className="flex-1 h-px bg-slate-200"/>
                    </div>
                  )}
                  {messagePrivate ? (
                    <div className={clsx('flex', isOut ? 'justify-end' : 'justify-start')}>
                      <div className="max-w-[70%] min-w-0 px-3 py-2 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 text-sm flex items-center gap-2">
                        <Lock size={13} className="flex-shrink-0"/><span>Mensagem privada</span>
                      </div>
                    </div>
                  ) : isInternal ? (
                    // Verifica se é msg de sistema (ações automáticas) ou msg privada do atendente
                    msg.content?.match(/^\[INTERNO\] [🔄✅▶️]/) ? (
                      // Mensagem de sistema — centralizada, cinza, sem bolha
                      <div className="flex justify-center my-1">
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-full text-xs text-slate-500 max-w-[85%]">
                          <span>{(msg.content ?? '').replace('[INTERNO] ', '')}</span>
                          <span className="text-slate-400 flex-shrink-0">{format(new Date(msg.created_at), 'HH:mm')}</span>
                        </div>
                      </div>
                    ) : (
                      // Mensagem privada do atendente — bolha escura à direita
                      <div className="flex justify-end">
                        <div className="max-w-[70%] min-w-0">
                          <div className="flex items-center gap-1 mb-0.5 justify-end"><Lock size={9} className="text-slate-500"/><span className="text-xs text-slate-500 font-medium">Interno</span></div>
                          <div className="px-3 py-2 text-sm rounded-2xl rounded-tr-sm bubble-private">{(msg.content ?? '').replace('[INTERNO] ', '')}</div>
                          <div className="flex items-center gap-1 mt-0.5 justify-end"><span className="text-xs text-slate-400">{format(new Date(msg.created_at), 'HH:mm')}</span><Lock size={9} className="text-slate-400"/></div>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className={clsx('flex group', isOut ? 'justify-end' : 'justify-start')}>
                      {!isOut && (
                        <ContactAvatar avatarUrl={selected.avatar_url} name={selected.full_name} id={selected.id} sizeClass="w-6 h-6" className="mr-1.5 flex-shrink-0 self-end"/>
                      )}

                      {/* Botões de ação hover */}
                      <div className={clsx('flex items-center gap-1 self-center shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity', isOut ? 'order-first mr-1' : 'order-last ml-1')}>
                        {/* Reagir — somente mensagens do WhatsApp já confirmadas pela Evolution */}
                        {msg.channel === 'whatsapp' && msg.external_id && (
                          <div className="relative">
                            <button onClick={() => setReactionPickerFor(v => v === msg.id ? null : msg.id)} title="Reagir"
                              disabled={sendingReactionFor === msg.id}
                              className="p-1 text-slate-400 hover:text-amber-500 hover:bg-slate-100 rounded-full disabled:opacity-50">
                              {sendingReactionFor === msg.id ? <Loader2 size={11} className="animate-spin"/> : <Smile size={11}/>} 
                            </button>
                            {reactionPickerFor === msg.id && (
                              <>
                                {/* No celular usa posição fixa, centralizada e limitada à largura
                                    da tela. Isso impede que o seletor saia do viewport. */}
                                <button aria-label="Fechar reações" onClick={() => setReactionPickerFor(null)}
                                  className="fixed inset-0 z-40 bg-transparent md:hidden" />
                                <div className={clsx(
                                  'z-50 flex gap-0.5 p-1.5 bg-white border border-slate-200 rounded-full shadow-lg',
                                  'fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] max-w-[calc(100vw-1rem)]',
                                  'md:absolute md:left-auto md:translate-x-0 md:bottom-full md:mb-1 md:max-w-none',
                                  isOut ? 'md:right-0' : 'md:left-0'
                                )}>
                                  {REACTION_EMOJIS.map(emoji => (
                                    <button key={emoji} onClick={() => sendReaction(msg, emoji)}
                                      className="w-9 h-9 md:w-7 md:h-7 flex-shrink-0 rounded-full hover:bg-slate-100 active:bg-slate-200 text-xl md:text-base leading-none">{emoji}</button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {/* Responder */}
                        <button onClick={() => setReplyTo(msg)} title="Responder"
                          className="p-1 text-slate-400 hover:text-brand-500 hover:bg-slate-100 rounded-full">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                        </button>
                        {/* Editar — só outbound do atendente */}
                        {isOut && !isSofia && msg.sender_id && !msg.media_type && !(msg as any).apagado_em && (
                          <button onClick={() => {
                            setEditingMsg(msg)
                            setEditText((msg.content ?? '').replace(/^(?:🔒 )?\*.+:\*\n/, ''))
                          }} title="Editar"
                            className="p-1 text-slate-400 hover:text-amber-500 hover:bg-slate-100 rounded-full">
                            <Pencil size={11}/>
                          </button>
                        )}
                        {/* v48.137 — Apagar do WhatsApp do paciente (pedido do
                            Jorge). Só outbound, do WhatsApp, já confirmada
                            (tem external_id) e ainda não apagada. */}
                        {isOut && msg.channel === 'whatsapp' && msg.external_id && !(msg as any).apagado_em && (
                          <button onClick={() => handleDeleteMessage(msg)} title="Apagar do WhatsApp do paciente"
                            disabled={deletingMsgId === msg.id}
                            className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded-full disabled:opacity-50">
                            {deletingMsgId === msg.id ? <Loader2 size={11} className="animate-spin"/> : <Trash2 size={11}/>}
                          </button>
                        )}
                      </div>

                      <div className="max-w-[70%] min-w-0">
                        {isSofia && <div className="flex items-center gap-1 mb-0.5 justify-end"><Bot size={10} className="text-brand-400"/><span className="text-xs text-brand-400 font-medium">{assistantName}</span></div>}
                        {isOut && !isSofia && msg.sender_id && <div className="flex justify-end mb-0.5"><SenderName senderId={msg.sender_id}/></div>}

                        {/* Preview da mensagem respondida */}
                        {msg.reply_to_id && (() => {
                          const replied = messages.find(m => m.id === msg.reply_to_id)
                          if (!replied) return null
                          return (
                            <div className={clsx('px-2.5 py-1.5 mb-1 rounded-lg border-l-2 text-xs cursor-pointer',
                              isOut ? 'bg-black/10 border-white text-slate-700' : 'bg-slate-100 border-brand-300 text-slate-600')}
                              onClick={() => {
                                document.getElementById(`msg-${replied.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                              }}>
                              <p className="font-semibold text-[10px] mb-0.5 opacity-80">
                                {replied.direction === 'inbound' ? selected?.full_name : 'Você'}
                              </p>
                              <p className="truncate opacity-90">
                                {replied.media_type ? `[${replied.media_type}]` : ((replied.content ?? '').replace('[INTERNO] ','').replace(/^((?:🔒 )?)\*.+?:\*\n/,'$1') || '(mensagem)')}
                              </p>
                            </div>
                          )
                        })()}

                        {/* Edição inline */}
                        {editingMsg?.id === msg.id ? (
                          <div className="space-y-1.5">
                            <textarea value={editText} onChange={e => setEditText(e.target.value)}
                              autoFocus rows={2}
                              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() } if (e.key === 'Escape') { setEditingMsg(null); setEditText('') } }}
                              className="w-full px-3 py-2 text-sm rounded-xl border-2 border-brand-400 focus:outline-none resize-none bg-white text-slate-800"/>
                            <div className="flex gap-1.5 justify-end">
                              <button onClick={() => { setEditingMsg(null); setEditText('') }}
                                className="px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-lg">Cancelar</button>
                              <button onClick={saveEdit}
                                className="px-2.5 py-1 text-xs bg-brand-600 hover:bg-brand-700 text-white rounded-lg">Salvar</button>
                            </div>
                          </div>
                        ) : (
                          <div id={`msg-${msg.id}`} className={clsx('px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap',
                            isOut ? (isSofia ? 'bubble-out-sofia' : 'bubble-out') : 'bubble-in',
                            // v48.137 — Apagada do WhatsApp do paciente: nunca some
                            // do CRM (pedido do Jorge), só fica cinza clara e
                            // tachada — ainda legível, pra quem revisar depois.
                            (msg as any).apagado_em && '!bg-slate-100 !text-slate-400 line-through')}>
                            {(msg as any).apagado_em && (
                              <p className="text-[10px] font-semibold text-slate-400 mb-0.5 no-underline">🚫 Mensagem apagada do WhatsApp do paciente</p>
                            )}
                            {msg.media_url && msg.media_type === 'image' && <a href={msg.media_url} target="_blank" rel="noopener noreferrer"><img src={msg.media_url} className="rounded-lg max-w-full cursor-zoom-in hover:opacity-90"/></a>}
                            {msg.media_url && msg.media_type === 'audio' && <AudioPlayer url={msg.media_url} outbound={isOut}/>}
                          {!msg.media_url && msg.media_type === 'audio' && <span className="flex items-center gap-1 text-xs opacity-60"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> Áudio não disponível</span>}
                            {msg.media_url && msg.media_type === 'video' && <video controls className="rounded-lg max-w-full" src={msg.media_url}/>}
                            {msg.media_url && msg.media_type === 'document' && <a href={msg.media_url} target="_blank" rel="noopener noreferrer" download className="flex items-center gap-2 text-xs underline opacity-90"><Paperclip size={11}/>{msg.content || 'Baixar'}</a>}
                            {msg.media_url && !['image','audio','video','document'].includes(msg.media_type ?? '') && <a href={msg.media_url} target="_blank" rel="noopener noreferrer" download className="flex items-center gap-2 text-xs underline opacity-90"><Paperclip size={11}/>{msg.content || 'Arquivo'}</a>}
                            {!msg.media_url && msg.media_type && <span className="flex items-center gap-1 text-xs opacity-70"><Paperclip size={10}/>[{msg.media_type}] {msg.content}</span>}
                            {!msg.media_type && ((msg.content ?? '').replace('[INTERNO] ','').replace(/^((?:🔒 )?)\*.+:\*\n/,'$1'))}
                          </div>
                        )}
                        {(() => {
                          const grouped = reactions.filter(r => r.message_id === msg.id).reduce<Record<string, number>>((acc, r) => {
                            acc[r.emoji] = (acc[r.emoji] || 0) + 1
                            return acc
                          }, {})
                          const entries = Object.entries(grouped)
                          if (!entries.length) return null
                          return (
                            <div className={clsx('flex flex-wrap gap-1 -mt-1 mb-0.5 relative z-10', isOut ? 'justify-end pr-1' : 'justify-start pl-1')}>
                              {entries.map(([emoji, count]) => (
                                <span key={emoji} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white border border-slate-200 shadow-sm text-xs" title="Reação à mensagem">
                                  <span>{emoji}</span>{count > 1 && <span className="text-[10px] text-slate-500">{count}</span>}
                                </span>
                              ))}
                            </div>
                          )
                        })()}
                        <div className={clsx('flex items-center gap-1 mt-0.5', isOut ? 'justify-end' : 'justify-start')}>
                          {msg.channel === 'instagram' ? (
                            <span title="Recebida pelo Instagram" className="flex-shrink-0">
                              <InstagramIcon size={10} className="text-pink-500"/>
                            </span>
                          ) : (
                            <span title="Recebida pelo WhatsApp" className="flex-shrink-0">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="#25D366"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.71 14.02c-.24.68-1.19 1.25-1.94 1.4-.53.11-1.22.19-3.56-.76-2.99-1.23-4.92-4.27-5.07-4.47-.15-.2-1.21-1.61-1.21-3.07 0-1.46.76-2.17 1.03-2.47.27-.3.59-.37.79-.37h.57c.18 0 .43-.01.65.5.27.63.9 2.19.98 2.35.08.16.13.35.03.55-.11.2-.16.32-.32.5-.16.18-.34.4-.48.54-.16.16-.33.34-.14.66.19.33.85 1.4 1.83 2.27 1.26 1.12 2.32 1.47 2.65 1.63.33.16.52.13.71-.08.19-.21.81-.94 1.03-1.26.22-.32.44-.27.74-.16.3.11 1.9.9 2.23 1.06.33.16.54.24.62.38.08.13.08.78-.16 1.46z"/></svg>
                            </span>
                          )}
                          <span className="text-xs text-slate-400">{format(new Date(msg.created_at), 'HH:mm')}</span>
                          {(msg as any).edited && <span className="text-[10px] text-slate-400 italic">editada</span>}
                          {isOut && (() => {
                            // v48.43 — Os tiques diziam a mesma coisa para tudo.
                            //
                            // Antes, QUALQUER mensagem enviada mostrava o tique
                            // duplo: a que saiu, a que estava na fila e a que a
                            // Meta recusou. Em 17/09 o Instagram passou um dia
                            // recusando envio e a tela mostrava tique duplo o
                            // tempo todo — quem olhava a conversa jurava que a
                            // paciente tinha recebido.
                            //
                            // Agora cada estado tem o seu sinal, e o mais
                            // importante deles é o vermelho: não saiu.
                            const st = (msg.status || '').toLowerCase()
                            if (st === 'failed' || st === 'error' || st === 'erro' || st === 'falhou') {
                              return (
                                <span title="Não foi entregue — o canal recusou o envio" className="flex items-center gap-0.5 text-red-600">
                                  <AlertTriangle size={12} strokeWidth={2.5}/>
                                  <span className="text-[10px] font-semibold">não enviada</span>
                                </span>
                              )
                            }
                            if (st === 'read' || st === 'lido' || st === 'played') {
                              return <span title="Lida"><CheckCheck size={14} strokeWidth={2.5} style={{ color: '#0ea5e9' }}/></span>
                            }
                            // v48.44 — "Enviada" e "entregue" mostram o mesmo
                            // tique duplo cinza, de propósito.
                            //
                            // O Instagram não devolve aviso de entrega: o mais
                            // longe que dá para saber é que a Meta aceitou a
                            // mensagem. Se isso aparecesse como um tique só,
                            // toda conversa do Instagram pareceria pendente
                            // para sempre — foi o susto da primeira versão.
                            //
                            // O que esta tela precisa distinguir é outra coisa,
                            // e essa continua distinguida: o que ainda não saiu
                            // (relógio) e o que o canal recusou (vermelho).
                            if (st === 'sent' || st === 'enviada' || st === 'enviado' || st === 'delivered' || st === 'entregue') {
                              return (
                                <span title={st.startsWith('deliver') || st === 'entregue' ? 'Entregue' : 'Enviada — o canal aceitou'}>
                                  <CheckCheck size={14} strokeWidth={2.5} style={{ color: '#94a3b8' }}/>
                                </span>
                              )
                            }
                            // queued, pending, sending e qualquer estado novo que
                            // apareça: ainda não saiu. Relógio, não tique.
                            return <span title="Aguardando envio"><Clock size={12} strokeWidth={2.5} style={{ color: '#cbd5e1' }}/></span>
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef}/>
          </div>
          {!atBottom && (
            <button onClick={scrollToBottom} title="Ir para o fim"
              className="absolute bottom-4 right-6 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-white border border-slate-200 shadow-lg text-slate-500 hover:text-brand-600 hover:border-brand-300 transition-colors">
              <ChevronDown size={18}/>
            </button>
          )}
          </div>

          {/* INPUT — bloqueado se pendente ou inbox sem assumir */}
          {isClosed ? (
            <div className="bg-white border-t border-slate-100 px-4 py-4 flex-shrink-0">
              <div className="flex items-center justify-center gap-3 py-3 bg-slate-50 rounded-xl border border-slate-200">
                <CheckCircle2 size={16} className="text-slate-400"/>
                <span className="text-sm text-slate-500">Conversa finalizada</span>
                <button onClick={async () => {
                  if (!selected) return
                  await supabase.from('contacts').update({
                    conversation_status: 'active',
                    assigned_to: null,
                    sector_id: null,  // volta pro INBOX
                    updated_at: new Date().toISOString()
                  }).eq('id', selected.id)
                  setSelected(prev => prev ? { ...prev, conversation_status: 'active', assigned_to: null, sector_id: null } : prev)
                  setToast('Conversa reaberta — aparece no INBOX')
                  setTimeout(() => loadAll(true), 300)
                }} className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg">
                  Reabrir
                </button>
              </div>
            </div>
          ) : isPending ? (
            <div className="bg-white border-t border-slate-100 px-4 py-4 flex-shrink-0">
              <div className="flex items-center justify-center gap-3 py-3 bg-slate-50 rounded-xl border border-slate-200">
                <Play size={16} className="text-brand-500"/>
                <span className="text-sm text-slate-600">Clique em <strong>Iniciar</strong> para começar o atendimento</span>
                <button onClick={startConversation}
                  className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg">
                  Iniciar
                </button>
              </div>
            </div>
          ) : isInboxFree ? (
            <div className="bg-white border-t border-slate-100 px-4 py-4 flex-shrink-0">
              <div className="flex items-center justify-center gap-3 py-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <CheckCircle2 size={16} className="text-emerald-500"/>
                <span className="text-sm text-slate-600">Clique em <strong>Assumir</strong> para iniciar o atendimento</span>
                <button onClick={() => assumeConversation()}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg">
                  Assumir
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border-t border-slate-100 px-3 py-3 flex-shrink-0">
              {/* Preview de resposta */}
              {replyTo && (
                <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-brand-50 border-l-2 border-brand-400 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-brand-600 mb-0.5">
                      {replyTo.direction === 'inbound' ? selected?.full_name : 'Você'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {replyTo.media_type ? `[${replyTo.media_type}]` : (replyTo.content ?? '').replace('[INTERNO] ','').replace(/^((?:🔒 )?)\*.+:\*\n/,'$1')}
                    </p>
                  </div>
                  <button onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                    <X size={12}/>
                  </button>
                </div>
              )}
              {isPrivate && (
                <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-slate-800 rounded-lg">
                  <Lock size={11} className="text-slate-300"/>
                  <span className="text-xs text-slate-200 font-medium flex-1">Mensagem interna</span>
                  <button onClick={() => setIsPrivate(false)} className="text-slate-400 hover:text-white"><X size={12}/></button>
                </div>
              )}
              {showSchedule && (
                <div className="mb-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <p className="text-xs font-medium text-slate-600 flex items-center gap-1"><Clock size={11}/> Agendar</p>
                  <div className="flex gap-1.5">
                    <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="flex-1 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                    <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="w-24 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                    <button onClick={handleScheduleMessage} disabled={!text.trim()||!scheduleDate||!scheduleTime} className="px-2.5 py-1.5 bg-brand-600 disabled:opacity-40 text-white text-xs font-medium rounded-lg">OK</button>
                    <button onClick={() => setShowSchedule(false)} className="px-2 text-slate-500 hover:bg-slate-100 rounded-lg text-xs">✕</button>
                  </div>
                </div>
              )}
              {showEmoji && (
                <div className="mb-2 p-2 bg-white border border-slate-200 rounded-xl flex flex-wrap gap-1 max-w-xs">
                  {EMOJIS.map(e => <button key={e} onClick={() => { setText(t => t+e); setShowEmoji(false) }} className="text-base hover:bg-slate-100 rounded p-0.5">{e}</button>)}
                </div>
              )}
              {recording ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
                    <span className="text-sm text-red-600 font-medium">Gravando {fmt(recordingTime)}</span>
                  </div>
                  <button onClick={stopRecording} className="p-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl"><Square size={14}/></button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:items-end">
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="order-2 p-2 text-slate-400 hover:text-brand-600 hover:bg-slate-100 rounded-lg flex-shrink-0 sm:order-none">
                    {uploading ? <Loader2 size={16} className="animate-spin"/> : <Paperclip size={16}/>}
                  </button>
                  <button onClick={() => setShowEmoji(v => !v)} className={clsx('order-2 p-2 rounded-lg flex-shrink-0 sm:order-none', showEmoji ? 'text-brand-600 bg-brand-50' : 'text-slate-400 hover:bg-slate-100')}><Smile size={16}/></button>
                  <button onClick={() => { setIsPrivate(v => !v); setShowSchedule(false) }}
                    className={clsx('order-2 p-2 rounded-lg flex-shrink-0 sm:order-none', isPrivate ? 'text-white bg-slate-800' : 'text-slate-400 hover:bg-slate-100')}><Lock size={16}/></button>
                  <button onClick={() => { setShowSchedule(v => !v); setShowEmoji(false) }}
                    className={clsx('order-2 p-2 rounded-lg flex-shrink-0 sm:order-none', showSchedule ? 'text-brand-600 bg-brand-50' : 'text-slate-400 hover:bg-slate-100')}><CalendarClock size={16}/></button>
                  <button onClick={openAiModal} title="Assistente de IA (melhorar texto / sugerir resposta)"
                    className="order-2 p-2 rounded-lg flex-shrink-0 sm:order-none text-slate-400 hover:bg-violet-50 hover:text-violet-600"><Sparkles size={16}/></button>
                  {/* Seletor de canal — só aparece quando o contato tem WhatsApp E Instagram
                      disponíveis (ex.: veio pelo Insta e foi vinculado a um cadastro com telefone real).
                      Deixa explícito por qual canal a próxima mensagem/mídia vai sair. */}
                  {bothChannelsAvailable && (
                    <div className="order-1 flex h-12 -translate-y-1 items-stretch rounded-xl border border-slate-200 overflow-hidden flex-shrink-0 sm:order-none sm:h-auto sm:translate-y-0 sm:rounded-lg" title="Escolher canal de envio">
                      <button type="button" onClick={() => setSendChannel('whatsapp')}
                        title="Enviar por WhatsApp"
                        className={clsx('flex items-center justify-center gap-1 px-2 text-xs font-medium sm:py-2',
                          sendChannel === 'whatsapp' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-400 hover:bg-slate-50')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.71 14.02c-.24.68-1.19 1.25-1.94 1.4-.53.11-1.22.19-3.56-.76-2.99-1.23-4.92-4.27-5.07-4.47-.15-.2-1.21-1.61-1.21-3.07 0-1.46.76-2.17 1.03-2.47.27-.3.59-.37.79-.37h.57c.18 0 .43-.01.65.5.27.63.9 2.19.98 2.35.08.16.13.35.03.55-.11.2-.16.32-.32.5-.16.18-.34.4-.48.54-.16.16-.33.34-.14.66.19.33.85 1.4 1.83 2.27 1.26 1.12 2.32 1.47 2.65 1.63.33.16.52.13.71-.08.19-.21.81-.94 1.03-1.26.22-.32.44-.27.74-.16.3.11 1.9.9 2.23 1.06.33.16.54.24.62.38.08.13.08.78-.16 1.46z"/></svg>
                      </button>
                      <button type="button" onClick={() => setSendChannel('instagram')}
                        title="Enviar por Instagram"
                        className={clsx('flex items-center justify-center gap-1 px-2 text-xs font-medium sm:py-2',
                          sendChannel === 'instagram' ? 'text-white' : 'bg-white text-slate-400 hover:bg-slate-50')}
                        style={sendChannel === 'instagram' ? { background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' } : undefined}>
                        <InstagramIcon size={14}/>
                      </button>
                    </div>
                  )}
                  <div className="order-1 relative min-w-0 flex-1 basis-0 sm:order-none sm:basis-auto">
                    {quickSuggestions.length > 0 && (
                      <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg z-20 max-h-40 overflow-y-auto">
                        {quickSuggestions.map(q => (
                          <button key={q.id} onClick={() => { setText(q.content); setQuickSuggestions([]) }}
                            className="w-full text-left px-3 py-2 hover:bg-brand-50 flex items-start gap-2 border-b border-slate-50 last:border-0">
                            <code className="text-xs text-brand-600 font-mono flex-shrink-0 mt-0.5">{q.shortcut}</code>
                            <span className="text-xs text-slate-600 truncate">{q.content}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea value={text} onChange={e => {
                      const val = e.target.value
                      setText(val)
                      // Detecta atalho /
                      if (val.startsWith('/') && val.length > 0) {
                        const suggestions = quickMessages.filter(q => q.shortcut.toLowerCase().startsWith(val.toLowerCase()))
                        setQuickSuggestions(suggestions)
                      } else {
                        setQuickSuggestions([])
                      }
                    }}
                      onKeyDown={e => {
                        if (e.key === 'Escape') setQuickSuggestions([])
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault(); setQuickSuggestions([])
                          // Enquanto o painel de agendar estiver aberto, Enter agenda em vez de enviar direto
                          if (showSchedule) { handleScheduleMessage() } else { sendMessage() }
                        }
                      }}
                      placeholder={isPrivate ? 'Mensagem interna...' : 'Digite...'}
                      rows={1} className={clsx('h-12 min-h-12 w-full overflow-y-auto px-3 py-2.5 text-base leading-6 sm:h-auto sm:min-h-0 sm:text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none max-h-28 border',
                        isPrivate ? 'bg-slate-800 text-white border-slate-700 placeholder:text-slate-500' : 'bg-slate-50 border-slate-200')}/>
                  </div>
                  {showSchedule ? (
                    // Com o painel de agendar aberto, o botão principal agenda em vez de enviar — evita envio acidental ao paciente
                    <button onClick={handleScheduleMessage} disabled={!text.trim()||!scheduleDate||!scheduleTime}
                      title="Agendar mensagem" className="order-1 flex h-12 w-12 -translate-y-1 items-center justify-center bg-brand-600 hover:bg-brand-700 text-white rounded-xl flex-shrink-0 disabled:opacity-40 sm:order-none sm:h-auto sm:w-auto sm:translate-y-0 sm:p-2.5"><Clock size={15}/></button>
                  ) : text.trim() ? (
                    <button onClick={sendMessage} disabled={sending} className="order-1 flex h-12 w-12 -translate-y-1 items-center justify-center bg-sky-400 hover:bg-sky-500 text-white rounded-xl flex-shrink-0 disabled:opacity-40 sm:order-none sm:h-auto sm:w-auto sm:translate-y-0 sm:p-2.5"><Send size={15}/></button>
                  ) : (
                    <button onClick={startRecording} className="order-1 flex h-12 w-12 -translate-y-1 items-center justify-center bg-slate-100 hover:bg-brand-100 text-slate-500 hover:text-brand-600 rounded-xl flex-shrink-0 sm:order-none sm:h-auto sm:w-auto sm:translate-y-0 sm:p-2.5"><Mic size={15}/></button>
                  )}
                  <div className="order-1 h-0 basis-full sm:hidden" aria-hidden="true"/>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-surface gap-3">
          <button onClick={() => setShowList(true)} className="md:hidden flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium mb-2">
            <Menu size={16}/> Ver conversas
          </button>
          <div className="w-14 h-14 bg-brand-100 rounded-2xl flex items-center justify-center">
            <Bot size={24} className="text-brand-500"/>
          </div>
          <p className="text-slate-600 font-medium text-sm">Selecione uma conversa</p>
        </div>
      )}

      {zoomedPhotoUrl && (
        <div
          className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
          onClick={() => setZoomedPhotoUrl(null)}
        >
          <button
            onClick={() => setZoomedPhotoUrl(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10"
            aria-label="Fechar"
          >
            <X size={24}/>
          </button>
          <img
            src={zoomedPhotoUrl}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full rounded-lg object-contain shadow-2xl"
            alt="Foto do paciente"
          />
        </div>
      )}
      {showSidePanel && selected && <ConversationSidePanel contact={selected} messages={messages} sectors={sectors} agentSectorIds={agentSectorIds}
        initialTab={(sidePanelSchedule || sidePanelRetorno) ? 'medx' : sidePanelRecibos ? 'recibos' : 'data'} openSchedule={sidePanelSchedule} openRetorno={sidePanelRetorno}
        onClose={() => { setShowSidePanel(false); setSidePanelSchedule(false); setSidePanelRetorno(false); setSidePanelRecibos(false) }} onSaved={handleContactUpdated} onReloadMessages={() => loadMessages(selected.id)}/>}
      {showAssign && selected && <AssignModal
        contactId={selected.id} contactName={selected.full_name}
        currentSectorId={selected.sector_id}
        title="Transferir atendimento"
        autoAssign={false}
        transferMessage={true}
        onClose={() => setShowAssign(false)}
        onSaved={(sectorId, agentId, agentName) => {
          setShowAssign(false)
          // Remove da lista imediatamente
          setActiveConvs(prev => prev.filter(c => c.contact.id !== selected.id))
          setSelected(null)
          loadAll()
        }}/> }
      {showInvite && selected && <InviteModal
        contactId={selected.id} contactName={selected.full_name}
        onClose={() => setShowInvite(false)}
        onInvited={() => { setShowInvite(false); setToast('Atendente convidado!'); loadAll(true) }}/> }
      {showScheduleMsg && selected && <NewDispatchModal
        agentId={agent?.id ?? null}
        initialContact={{ id: selected.id, full_name: selected.full_name, phone: selected.phone ?? null }}
        onClose={() => setShowScheduleMsg(false)}
        onSaved={() => { setShowScheduleMsg(false); setToast('Mensagem agendada!') }}/> }
      {reviewConfirm && <ReviewConfirmModal
        contactName={reviewConfirm.contactName}
        onConfirm={() => { reviewConfirm.resolve(true); setReviewConfirm(null) }}
        onCancel={() => { reviewConfirm.resolve(false); setReviewConfirm(null) }}/> }
      {showAiModal && selected && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowAiModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Sparkles size={16} className="text-violet-600"/>
                </div>
                <h2 className="text-base font-semibold text-slate-800">Assistente de IA</h2>
              </div>
              <button onClick={() => setShowAiModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
                <X size={18}/>
              </button>
            </div>
            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              {/* Seção 1: melhorar o texto que já está digitado */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Melhorar sua mensagem</p>
                {!text.trim() ? (
                  <p className="text-sm text-slate-400">Digite algo na caixa de mensagem para receber uma sugestão de melhoria.</p>
                ) : aiImproveLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400 py-3">
                    <Loader2 size={15} className="animate-spin"/> Gerando sugestão...
                  </div>
                ) : aiImproveError ? (
                  <div className="space-y-2">
                    <p className="text-sm text-red-600">{aiImproveError}</p>
                    <button onClick={fetchAiImprove} className="text-xs text-brand-600 hover:underline">Tentar de novo</button>
                  </div>
                ) : aiImprove.list.length > 0 ? (
                  <div className="space-y-2">
                    <button onClick={() => useAiSuggestion(aiImprove.list[aiImprove.i])}
                      className="w-full text-left px-3 py-2.5 bg-slate-50 hover:bg-violet-50 border border-slate-200 hover:border-violet-300 rounded-xl text-sm text-slate-700 transition-colors">
                      {aiImprove.list[aiImprove.i]}
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={aiImproveBack} disabled={aiImprove.i <= 0}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                        <RotateCcw size={12}/> Anterior
                      </button>
                      <button onClick={fetchAiImprove}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-violet-600 hover:bg-violet-50">
                        <RefreshCw size={12}/> Refazer
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={fetchAiImprove}
                    className="flex items-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 text-sm font-medium rounded-lg">
                    <Sparkles size={14}/> Gerar sugestão de melhoria
                  </button>
                )}
              </div>

              <div className="border-t border-slate-100"/>

              {/* Seção 2: perguntar à IA como responder — considera a última mensagem do
                  paciente e, opcionalmente, uma instrução digitada pelo atendente (ex.: "diga
                  que não temos horário essa semana"). */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Como devo responder?</p>
                <p className="text-xs text-slate-400 mb-2">A IA considera a última mensagem enviada pelo paciente. Se quiser, digite também uma instrução (ex.: "diga que não temos horário essa semana").</p>
                <textarea value={aiReplyInstruction} onChange={e => setAiReplyInstruction(e.target.value)}
                  placeholder="Instrução para a IA (opcional)"
                  rows={2}
                  className="w-full mb-2 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"/>
                {aiReplyLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400 py-3">
                    <Loader2 size={15} className="animate-spin"/> Gerando sugestão...
                  </div>
                ) : aiReplyError ? (
                  <div className="space-y-2">
                    <p className="text-sm text-red-600">{aiReplyError}</p>
                    <button onClick={fetchAiReply} className="text-xs text-brand-600 hover:underline">Tentar de novo</button>
                  </div>
                ) : aiReply.list.length > 0 ? (
                  <div className="space-y-2">
                    <button onClick={() => useAiSuggestion(aiReply.list[aiReply.i])}
                      className="w-full text-left px-3 py-2.5 bg-slate-50 hover:bg-violet-50 border border-slate-200 hover:border-violet-300 rounded-xl text-sm text-slate-700 transition-colors">
                      {aiReply.list[aiReply.i]}
                    </button>
                    <div className="flex items-center gap-2">
                      <button onClick={aiReplyBack} disabled={aiReply.i <= 0}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                        <RotateCcw size={12}/> Anterior
                      </button>
                      <button onClick={fetchAiReply}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-violet-600 hover:bg-violet-50">
                        <RefreshCw size={12}/> Refazer
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={fetchAiReply}
                    className="flex items-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 text-sm font-medium rounded-lg">
                    <Sparkles size={14}/> Perguntar à IA como devo responder
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {showPix && selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4"
          onClick={() => !pixEnviando && setShowPix(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 flex flex-col items-center border-b border-slate-100">
              <img src="/logo-safra.png" alt="Banco Safra" className="h-16 object-contain mb-3"/>
              <h2 className="text-base font-semibold text-slate-800">Enviar cobrança via PIX</h2>
              <p className="text-xs text-slate-500 mt-1 text-center">
                {selected.full_name} recebe o link, o QR Code e o copia e cola.
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Valor (R$)</label>
                <input value={pixValor} onChange={e => { setPixValor(e.target.value); setPixErro('') }}
                  inputMode="decimal" autoFocus placeholder="0,00"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-lg font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400"/>
              </div>
              {pixDescricoes.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Descrição</label>
                  <div className="flex flex-wrap gap-1.5">
                    {pixDescricoes.map(d => (
                      <button key={d.texto} type="button" onClick={() => setPixDescricao(pixDescricao === d.texto ? '' : d.texto)}
                        className={clsx('px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                          pixDescricao === d.texto
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700')}>
                        {d.texto}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Ou digite outra</label>
                <input value={pixDescricao} onChange={e => setPixDescricao(e.target.value)}
                  placeholder="Ex.: consulta de retorno" maxLength={40}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400"/>
              </div>
              {pixErro && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <X size={14} className="mt-0.5 flex-shrink-0"/><span>{pixErro}</span>
                </div>
              )}
            </div>
            <div className="px-6 pb-6 flex gap-2">
              <button onClick={() => setShowPix(false)} disabled={pixEnviando}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={enviarCobrancaPix} disabled={pixEnviando || pixOk}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60">
                {pixEnviando ? <Loader2 size={15} className="animate-spin"/> : pixOk ? <CheckCircle2 size={15}/> : <QrCode size={15}/>}
                {pixEnviando ? 'Enviando...' : pixOk ? 'Enviada!' : 'Gerar e enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v47.14 — Cobrança no cartão. A secretária digita quanto a clínica quer
          RECEBER; a tela mostra o que o paciente vai pagar em cada parcelamento,
          com a taxa do contrato já embutida. Assim ninguém precisa fazer a conta
          de cabeça — nem errar somando a taxa por cima, que dá a menos. */}
      {bloqueioAberto && selected && (
        <EscolherCanaisBloqueio contato={selected}
          onFechar={() => setBloqueioAberto(false)}
          onConfirmar={aplicarBloqueioAtendimento}/>
      )}

      {showCartao && selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4"
          onClick={() => !cartaoEnviando && setShowCartao(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 flex flex-col items-center border-b border-slate-100">
              {cartaoInfinite
                ? <img src="/logo-infinitepay.png" alt="InfinitePay" className="h-10 object-contain mb-4 mt-3"/>
                : <img src="/logo-safra.png" alt="Banco Safra" className="h-16 object-contain mb-3"/>}
              <h2 className="text-base font-semibold text-slate-800">Enviar cobrança no cartão</h2>
              <p className="text-xs text-slate-500 mt-1 text-center">
                {cartaoDesligado
                  ? 'A cobrança no cartão está desligada em Configurações → Cobrança.'
                  : <>{selected.full_name} recebe um link e paga em ambiente seguro {cartaoEmpresa}.</>}
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              {/* v48.06 — Aviso de ambiente de testes.
                  Em homologação o link abre, a página do Safra aparece e o
                  paciente "paga" — mas o dinheiro não existe. Sem este aviso,
                  uma cobrança de teste enviada a um paciente de verdade só seria
                  descoberta quando o valor não caísse na conta. */}
              {safraCfg && safraCfg.ambiente !== 'producao' && (
                <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs font-semibold text-amber-800">Ambiente de testes (homologação)</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    O link vai funcionar e o paciente consegue concluir, mas <strong>nenhum valor é cobrado
                    de verdade</strong>. Use só para testar. Para cobrar, é preciso liberar a produção com a Safrapay.
                  </p>
                </div>
              )}

              {safraCfg && safraCfg.ambiente !== 'producao' && (
                <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  Ambiente de <strong>homologação</strong>: nenhuma cobrança real é feita.
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  {(safraCfg?.repassar_taxa || cartaoInfinite) ? 'Valor que a clínica recebe (R$)' : 'Valor a cobrar (R$)'}
                </label>
                <input value={cartaoValor} onChange={e => { setCartaoValor(e.target.value); setCartaoErro('') }}
                  inputMode="decimal" autoFocus placeholder="0,00"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-lg font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"/>
              </div>

              {pixDescricoes.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Descrição</label>
                  <div className="flex flex-wrap gap-1.5">
                    {pixDescricoes.map(d => (
                      <button key={d.texto} type="button"
                        onClick={() => {
                          const marcando = cartaoDescricao !== d.texto
                          setCartaoDescricao(marcando ? d.texto : '')
                          if (marcando) setCartaoParcelas(Math.min(d.parcelas || 1, safraCfg?.max_parcelas || 12))
                        }}
                        className={clsx('px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                          cartaoDescricao === d.texto
                            ? 'bg-brand-600 border-brand-600 text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700')}>
                        {d.texto} <span className="opacity-60">· {d.parcelas}x</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Ou digite outra</label>
                <input value={cartaoDescricao} onChange={e => setCartaoDescricao(e.target.value)}
                  placeholder="Ex.: consulta de retorno" maxLength={40}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400"/>
              </div>

              {!cartaoInfinite && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Bandeira do cartão</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['visa_master', 'elo', 'amex'] as Bandeira[]).map(b => (
                    <button key={b} type="button" onClick={() => setCartaoBandeira(b)}
                      className={clsx('flex flex-col items-center gap-1 px-2 py-2 rounded-lg border transition-colors',
                        cartaoBandeira === b
                          ? 'bg-brand-50 border-brand-400 text-brand-800'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-brand-200')}>
                      <BandeiraIcone bandeira={b} className="w-8 h-5"/>
                      <span className="text-[11px] font-semibold leading-none">{NOME_BANDEIRA[b]}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Pergunte ao paciente qual cartão ele vai usar — a taxa muda por bandeira.</p>
              </div>
              )}

              {cartaoInfinite && !safraCfg?.repassar_taxa ? (
                <div className="space-y-2">
                  <div className="px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
                    A clínica recebe o valor digitado. O paciente escolhe o parcelamento na página da InfinitePay, que
                    acrescenta os juros{Number(safraCfg?._ip?.assume_ate) > 0 ? ` a partir de ${Number(safraCfg._ip.assume_ate) + 1}x` : ''}.
                  </div>
                  {cartaoLiquidoCentavos > 0 && (() => {
                    const ops = simularRepasseInfinitePay(cartaoLiquidoCentavos, safraCfg._ip)
                    const textoOrcamento = ops.map(o => o.parcelas === 1
                      ? `À vista: ${brlCentavos(o.totalCentavos)}`
                      : `${o.parcelas}x de ${brlCentavos(o.parcelaCentavos)} (total ${brlCentavos(o.totalCentavos)})`).join('\n')
                    return (
                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                          <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">O paciente vai ver (estimativa)</span>
                          <button type="button"
                            onClick={() => { try { navigator.clipboard.writeText(textoOrcamento); setToast('Orçamento copiado'); setTimeout(() => setToast(''), 2500) } catch {} }}
                            className="text-[11px] font-semibold text-brand-600 hover:text-brand-700">Copiar orçamento</button>
                        </div>
                        <div className="max-h-44 overflow-y-auto">
                          <table className="w-full text-xs text-slate-600">
                            <tbody>
                              {ops.map(o => (
                                <tr key={o.parcelas} className="border-b border-slate-100 last:border-0">
                                  <td className="px-3 py-1">{o.parcelas === 1 ? 'À vista' : `${o.parcelas}x`}</td>
                                  <td className="px-2 py-1 text-right">{o.parcelas > 1 ? `${brlCentavos(o.parcelaCentavos)}` : ''}</td>
                                  <td className="px-2 py-1 text-right font-semibold text-slate-700">{brlCentavos(o.totalCentavos)}</td>
                                  <td className="px-3 py-1 text-right text-slate-400">{o.taxa ? o.taxa.toFixed(2).replace('.', ',') + '%' : 'sem juros'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="px-3 py-1.5 text-[10px] text-slate-400 bg-slate-50 border-t border-slate-200">
                          Calculado pela tabela de taxas de Configurações → Cobrança. O valor final é o que a InfinitePay mostrar.
                        </p>
                      </div>
                    )
                  })()}
                </div>
              ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  {safraCfg?.paciente_escolhe ? 'Máximo de parcelas que o paciente pode escolher' : 'Em quantas vezes'}
                </label>
                <select value={cartaoParcelas} onChange={e => setCartaoParcelas(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  {opcoesParcelamento.map(o => (
                    <option key={o.parcelas} value={o.parcelas}>
                      {o.parcelas}x {o.parcelas > 1 ? `de ${brlCentavos(o.parcelaCentavos)}` : `de ${brlCentavos(o.totalCentavos)}`}
                      {o.taxa ? ` — taxa ${o.taxa.toLocaleString('pt-BR')}%` : ''}
                    </option>
                  ))}
                </select>
              </div>
              )}

              {opcaoEscolhida && !(cartaoInfinite && !safraCfg?.repassar_taxa) && (
                <div className="px-3 py-2.5 bg-brand-50 border border-brand-200 rounded-lg text-sm">
                  <div className="flex justify-between text-brand-900">
                    <span>O paciente paga</span>
                    <span className="font-semibold">{brlCentavos(opcaoEscolhida.totalCentavos)}</span>
                  </div>
                  {safraCfg?.repassar_taxa && opcaoEscolhida.taxa > 0 && (
                    <p className="mt-1 text-xs text-brand-700/80">
                      Inclui {opcaoEscolhida.taxa.toFixed(2).replace('.', ',')}% de taxa
                      {safraCfg?.antecipa ? ' (cartão + antecipação)' : ' do cartão'}. A clínica recebe o valor digitado.
                    </p>
                  )}
                  {cartaoInfinite && safraCfg?.repassar_taxa && cartaoParcelas > 1 && !safraCfg?.paciente_escolhe && (
                    <p className="mt-1 text-xs text-brand-700/70">
                      A InfinitePay não trava o parcelamento: a mensagem pede ao paciente para marcar {cartaoParcelas}x
                      na página. Se ele marcar outro número, a cobrança aparece com aviso de divergência.
                    </p>
                  )}
                  {!cartaoInfinite && safraCfg?.repassar_taxa && cartaoParcelas > 1 && !safraCfg?.paciente_escolhe && (
                    <p className="mt-1 text-xs text-brand-700/70">
                      O link vai travado em {cartaoParcelas}x — o paciente não escolhe outro parcelamento,
                      senão a taxa muda e a conta não fecha.
                    </p>
                  )}
                  {safraCfg?.paciente_escolhe && safraCfg?.repassar_taxa && (
                    <p className="mt-1 text-xs text-brand-700/70">
                      O paciente vai receber uma página com as opções de 1x até {cartaoParcelas}x, cada uma pelo
                      preço certo, e escolhe a que couber. O valor acima é o de {cartaoParcelas}x.
                    </p>
                  )}
                  {safraCfg?.paciente_escolhe && !safraCfg?.repassar_taxa && cartaoParcelas > 1 && (
                    <p className="mt-1 text-xs text-brand-700/70">
                      O paciente escolhe de 1x até {cartaoParcelas}x na página {cartaoInfinite ? 'da InfinitePay' : 'do Safra'}.
                    </p>
                  )}
                </div>
              )}

              {cartaoErro && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <X size={14} className="mt-0.5 flex-shrink-0"/><span>{cartaoErro}</span>
                </div>
              )}
            </div>
            <div className="px-6 pb-6 flex gap-2">
              <button onClick={() => setShowCartao(false)} disabled={cartaoEnviando}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={enviarCobrancaCartao} disabled={cartaoEnviando || cartaoOk || cartaoDesligado}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60">
                {cartaoEnviando ? <Loader2 size={15} className="animate-spin"/> : cartaoOk ? <CheckCircle2 size={15}/> : <CreditCard size={15}/>}
                {cartaoEnviando ? 'Enviando...' : cartaoOk ? 'Enviada!' : 'Gerar e enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-400"/>{toast}
        </div>
      )}
      </div>
    </div>
  )
}
