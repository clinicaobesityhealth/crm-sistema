'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  MessageSquare, Users, Calendar, Settings, BarChart2, LogOut, Send,
  ChevronDown, Palette, QrCode, Briefcase, UserCog, Zap, Pencil, PanelLeftClose, PanelLeft, Tag, Smartphone, MessageCircle,
  Stethoscope, CalendarDays, CalendarRange, Cake, Bot, Menu, X, Ban, Contact, Scissors, SlidersHorizontal, AlarmClock, PieChart
} from 'lucide-react'
import clsx from 'clsx'
import ProfileModal from './ProfileModal'
import { useAcessoCirurgias } from '@/lib/acessoCirurgias'
import { useAcessoAgendaPessoal } from '@/lib/acessoAgendaPessoal'
import { useMinutosDeSessao } from '@/lib/tempoDeSessao'
import InstagramIcon from './icons/InstagramIcon'

// v48.90 — Três agendas diferentes (minha, médica, cirurgias) espalhadas no
// meio do menu, cada uma parecendo só mais um item — difícil de achar de
// relance. Ficam juntas, nesta ordem, e destacadas num bloco próprio.
//
// A Agenda de Mensagens é outra coisa (mensagens agendadas para os contatos,
// não uma agenda de compromissos) — fica de fora do destaque, na posição em
// que sempre esteve.
const AGENDAS_DESTAQUE = ['/agenda-pessoal', '/agenda-medica', '/cirurgias']

const navCompleto = [
  { label: 'Atendimentos', icon: MessageSquare, href: '/inbox' },
  { label: 'Contatos', icon: Users, href: '/contacts' },
  { label: 'Msgs Rápidas', icon: Zap, href: '/settings/quickmessages' },
  { label: 'Agenda de Mensagens', icon: Calendar, href: '/agenda' },
  { label: 'Minha agenda', icon: AlarmClock, href: '/agenda-pessoal' },
  { label: 'Agenda Médica', icon: CalendarRange, href: '/agenda-medica' },
  { label: 'Cirurgias', icon: Scissors, href: '/cirurgias' },
  { label: 'Disparos', icon: Send, href: '/broadcasts' },
  { label: 'Dashboard', icon: BarChart2, href: '/dashboard' },
  // v48.112 — Não faz parte do bloco de destaque das agendas (AGENDAS_DESTAQUE):
  // é uma tela de estatística, não uma agenda de compromissos, então fica
  // junto do Dashboard geral em vez de vizinha de "Cirurgias".
  { label: 'Dashboard Cirurgias', icon: PieChart, href: '/cirurgias/dashboard' },
  { label: 'Aniversariantes', icon: Cake, href: '/birthdays' },
]

// Agrupa os itens de agenda consecutivos num bloco só, para desenhar o
// destaque ao redor deles sem mexer na lista plana usada pelo resto (busca de
// permissão, nav mobile etc.) — a ordem acima já garante que ficam vizinhos.
type ItemNav = typeof navCompleto[number]
type BlocoNav = { tipo: 'item'; item: ItemNav } | { tipo: 'agendas'; itens: ItemNav[] }
function agruparNav(lista: ItemNav[]): BlocoNav[] {
  const blocos: BlocoNav[] = []
  for (const item of lista) {
    if (AGENDAS_DESTAQUE.includes(item.href)) {
      const ultimo = blocos[blocos.length - 1]
      if (ultimo?.tipo === 'agendas') { ultimo.itens.push(item); continue }
      blocos.push({ tipo: 'agendas', itens: [item] })
    } else {
      blocos.push({ tipo: 'item', item })
    }
  }
  return blocos
}

const settingsSubnavCompleto = [
  { label: 'Agente de IA', icon: Bot, href: '/settings/sofia' },
  { label: 'Aparência', icon: Palette, href: '/settings/appearance' },
  { label: 'Setores', icon: Briefcase, href: '/settings/sectors' },
  { label: 'Cargos', icon: Contact, href: '/settings/job-titles' },
  { label: 'Atendentes', icon: UserCog, href: '/settings/agents' },
  { label: 'Contatos bloqueados', icon: Ban, href: '/settings/blocked-contacts' },
  { label: 'Config. Agenda', icon: Stethoscope, href: '/settings/agenda-config' },
  { label: 'Cad. Cirurgias', icon: Scissors, href: '/settings/cirurgias' },
  { label: 'Feriados', icon: CalendarDays, href: '/settings/feriados' },
  { label: 'Tags', icon: Tag, href: '/settings/tags' },
  { label: 'Cobrança', icon: QrCode, href: '/settings/pagamentos' },
  { label: 'WhatsApp', icon: Smartphone, href: '/settings/whatsapp' },
  { label: 'Instagram', icon: InstagramIcon, href: '/settings/instagram' },
  { label: 'Sistema', icon: SlidersHorizontal, href: '/settings/sistema' },
]

// Nav items para o bottom nav mobile (só os principais)
//
// v48.47 — O Painel saiu daqui e foi para o "Mais".
//
// No celular cabem quatro atalhos, e eles deveriam ser as quatro coisas que a
// clínica abre o dia inteiro. O Painel não é uma delas: é uma tela de olhar de
// vez em quando, sentado. A agenda de cirurgias é — e estava a dois toques de
// distância.
const mobileNav = [
  { label: 'Chat', icon: MessageSquare, href: '/inbox' },
  { label: 'Contatos', icon: Users, href: '/contacts' },
  { label: 'Consultas', icon: CalendarRange, href: '/agenda-medica' },
  { label: 'Cirurgias', icon: Scissors, href: '/cirurgias' },
]

// Para quem não tem acesso à agenda cirúrgica (nutrição, psicologia, clínica),
// o lugar não fica vazio: volta o Painel, que é o que havia antes.
const mobileNavSemCirurgias = [
  { label: 'Chat', icon: MessageSquare, href: '/inbox' },
  { label: 'Contatos', icon: Users, href: '/contacts' },
  { label: 'Consultas', icon: CalendarRange, href: '/agenda-medica' },
  { label: 'Painel', icon: BarChart2, href: '/dashboard' },
]

export default function Sidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const { agent, isAdmin, signOut } = useAuth()
  // Nutricionista, psicólogo e clínico não veem a agenda cirúrgica. Some do
  // menu — e as próprias telas também recusam, porque esconder um item não
  // impede ninguém de digitar o endereço.
  const veCirurgias = useAcessoCirurgias()
  // A agenda pessoal é individual: quem não tem uma não vê o item.
  const veAgendaPessoal = useAcessoAgendaPessoal()
  const minutosDeSessao = useMinutosDeSessao()
  const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith('/settings'))
  // v48.94 — Configurações fica perto do fim do menu; abrir o submenu sem
  // rolar deixava a lista aparecendo fora da tela, por baixo do "Sair" — quem
  // clicasse via a seta girar e nada mais, parecia que não tinha feito nada.
  const settingsRef = useRef<HTMLDivElement | null>(null)
  function alternarSettings() {
    setSettingsOpen(v => {
      const abrindo = !v
      if (abrindo) requestAnimationFrame(() => requestAnimationFrame(() => {
        settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }))
      return abrindo
    })
  }
  const [showProfile, setShowProfile] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // v48.78 — O menu para onde estava.
  //
  // Cada página monta o seu próprio Sidebar, então a cada clique ele nasce de
  // novo e a rolagem volta ao topo — quem estava em "Cad. Cirurgias", lá
  // embaixo na lista de Configurações, perdia o lugar e tinha de descer outra
  // vez. Guardar a posição na aba do navegador resolve sem estado global.
  const menuRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    try {
      const salvo = Number(sessionStorage.getItem('crm_menu_scroll') || 0)
      // Sem o quadro seguinte a restauração acontece antes de o submenu de
      // Configurações abrir, e a altura ainda não é a final.
      if (salvo > 0) requestAnimationFrame(() => { el.scrollTop = salvo })
    } catch {}
    let t: any
    const aoRolar = () => {
      clearTimeout(t)
      t = setTimeout(() => { try { sessionStorage.setItem('crm_menu_scroll', String(el.scrollTop)) } catch {} }, 120)
    }
    el.addEventListener('scroll', aoRolar, { passive: true })
    return () => { clearTimeout(t); el.removeEventListener('scroll', aoRolar) }
  }, [])

  const nav = navCompleto
    .filter(i => i.href !== '/cirurgias' || veCirurgias === true)
    .filter(i => i.href !== '/cirurgias/dashboard' || veCirurgias === true)
    .filter(i => i.href !== '/agenda-pessoal' || veAgendaPessoal === true)
  // veCirurgias começa indefinido enquanto a permissão carrega; até saber,
  // mostra a barra sem cirurgias, para o item não piscar e sumir.
  const barraMobile = veCirurgias === true ? mobileNav : mobileNavSemCirurgias
  const settingsSubnav = settingsSubnavCompleto.filter(i => i.href !== '/settings/cirurgias' || veCirurgias === true)

  // Em dispositivos móveis, encerra a sessão após um tempo sem interação.
  // No desktop, a política atual de sessão permanece inalterada.
  //
  // v48.47 — O tempo virou configuração da clínica (Configurações → Sistema).
  // Zero desliga o encerramento automático.
  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px)')
    if (!mobileQuery.matches) return
    if (!minutosDeSessao || minutosDeSessao <= 0) return
    const storageKey = `crm_mobile_last_activity:${agent?.id || 'session'}`
    let inactivityTimer: ReturnType<typeof setTimeout>
    let signingOut = false
    const expireSession = () => {
      if (signingOut) return
      signingOut = true
      try { localStorage.removeItem(storageKey) } catch {}
      void signOut()
    }
    const checkElapsedTime = () => {
      let lastActivity = Date.now()
      try { lastActivity = Number(localStorage.getItem(storageKey)) || Date.now() } catch {}
      const remaining = minutosDeSessao * 60 * 1000 - (Date.now() - lastActivity)
      clearTimeout(inactivityTimer)
      if (remaining <= 0) expireSession()
      else inactivityTimer = setTimeout(expireSession, remaining)
    }
    const resetTimer = () => {
      try { localStorage.setItem(storageKey, String(Date.now())) } catch {}
      checkElapsedTime()
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'touchstart', 'keydown', 'scroll']
    events.forEach(event => window.addEventListener(event, resetTimer, { passive: true }))
    const checkOnReturn = () => { if (document.visibilityState === 'visible') checkElapsedTime() }
    window.addEventListener('focus', checkElapsedTime)
    document.addEventListener('visibilitychange', checkOnReturn)
    let hasSavedActivity = false
    try { hasSavedActivity = Boolean(localStorage.getItem(storageKey)) } catch {}
    if (hasSavedActivity) checkElapsedTime()
    else resetTimer()
    return () => {
      clearTimeout(inactivityTimer)
      events.forEach(event => window.removeEventListener(event, resetTimer))
      window.removeEventListener('focus', checkElapsedTime)
      document.removeEventListener('visibilitychange', checkOnReturn)
    }
  }, [agent?.id, signOut, minutosDeSessao])

  useEffect(() => {
    if (!agent) return
    async function loadUnread() {
      const { data } = await supabase.from('internal_messages')
        .select('id').eq('to_agent', agent!.id).eq('read', false)
      setChatUnread((data ?? []).length)
    }
    loadUnread()
    const interval = setInterval(loadUnread, 10000)
    const ch = supabase.channel('sidebar-chat-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_messages' }, loadUnread)
      .subscribe()
    return () => { clearInterval(interval); supabase.removeChannel(ch) }
  }, [agent])

  function openChat() {
    window.dispatchEvent(new Event('toggle-internal-chat'))
  }

  function avatarInitials(name?: string) {
    return name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?'
  }

  // Match exato ou por segmento de path — evita que '/agenda' fique marcado como ativo
  // quando a rota atual é '/agenda-medica' (ou qualquer outra rota que comece com o mesmo prefixo).
  function isNavActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <>
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)}/>}

      {/* DESKTOP: sidebar lateral (escondido no mobile) */}
      <aside className={clsx(
        'hidden md:flex flex-shrink-0 bg-white border-r border-slate-100 flex-col h-screen sticky top-0 transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-[220px]'
      )}>
        {/* Perfil */}
        <div className="flex items-center border-b border-slate-100">
          <button onClick={() => setShowProfile(true)}
            className={clsx('flex-1 py-4 text-left hover:bg-slate-50 transition-colors group', collapsed ? 'px-3' : 'px-5')}>
            <div className="flex items-center gap-3">
              <div className="relative flex-shrink-0">
                {agent?.photo_url ? (
                  <img src={agent.photo_url} alt={agent.name} className="w-8 h-8 rounded-lg object-cover border border-slate-100"/>
                ) : (
                  <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                    {agent ? avatarInitials(agent.name) : <Users size={14}/>}
                  </div>
                )}
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-slate-200">
                  <Pencil size={8} className="text-slate-500"/>
                </div>
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 leading-tight truncate">{agent?.name || 'Obesity Health'}</p>
                  <p className="text-xs text-slate-400 truncate">{agent?.job_title || 'CRM'}</p>
                </div>
              )}
            </div>
          </button>
        </div>

        {/* Nav */}
        <nav ref={menuRef} className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {agruparNav(nav).map((bloco, i) => {
            if (bloco.tipo === 'item') {
              const item = bloco.item
              const active = isNavActive(item.href)
              return (
                <button key={item.href} onClick={() => router.push(item.href)}
                  title={collapsed ? item.label : undefined}
                  className={clsx('w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left',
                    active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                    collapsed && 'justify-center')}>
                  <item.icon size={18} className="flex-shrink-0"/>
                  {!collapsed && item.label}
                </button>
              )
            }
            // v48.90 — As agendas, num bloco só, para achar de relance.
            //
            // v48.91 — O item ativo ficava branco em cima de um fundo âmbar já
            // quase branco (70% de opacidade): sumia, em vez de destacar. Agora
            // o ativo é sólido na cor da marca — contraste alto não importa o
            // que tiver por baixo — e o bloco em si ficou com o âmbar mais
            // presente, para se notar antes mesmo de olhar para os itens.
            return (
              <div key={'agendas-' + i} className={clsx('bg-amber-50 border border-amber-200 rounded-xl space-y-0.5', collapsed ? 'p-1' : 'p-1.5')}>
                {!collapsed && <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800 px-2 pt-1 pb-0.5">Agendas</p>}
                {bloco.itens.map(item => {
                  const active = isNavActive(item.href)
                  return (
                    <button key={item.href} onClick={() => router.push(item.href)}
                      title={collapsed ? item.label : undefined}
                      className={clsx('w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left',
                        active ? 'bg-brand-600 text-white shadow-sm' : 'text-amber-900 hover:bg-amber-100 hover:text-amber-950',
                        collapsed && 'justify-center')}>
                      <item.icon size={18} className="flex-shrink-0"/>
                      {!collapsed && item.label}
                    </button>
                  )
                })}
              </div>
            )
          })}

          {/* Chat da equipe */}
          <button onClick={openChat}
            title={collapsed ? 'Chat da equipe' : undefined}
            className={clsx('w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left relative text-slate-500 hover:bg-slate-50 hover:text-slate-700',
              collapsed && 'justify-center')}>
            <div className="relative">
              <MessageCircle size={18} className="flex-shrink-0"/>
              {chatUnread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {chatUnread > 9 ? '9+' : chatUnread}
                </span>
              )}
            </div>
            {!collapsed && 'Chat da equipe'}
          </button>

          {isAdmin && !collapsed && (
            <div ref={settingsRef}>
              <button onClick={alternarSettings}
                className={clsx('w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left',
                  pathname.startsWith('/settings') ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
                <Settings size={18}/>
                Configurações
                <ChevronDown size={14} className={clsx('ml-auto transition-transform', settingsOpen && 'rotate-180')}/>
              </button>
              {settingsOpen && (
                <div className="ml-3 mt-1 space-y-1 border-l border-slate-100 pl-3">
                  {settingsSubnav.map(item => {
                    const active = pathname === item.href
                    return (
                      <button key={item.href} onClick={() => router.push(item.href)}
                        className={clsx('w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left',
                          active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700')}>
                        <item.icon size={14}/>
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {isAdmin && collapsed && (
            <button onClick={() => router.push('/settings/appearance')}
              title="Configurações"
              className={clsx('w-full flex items-center justify-center px-3 py-2.5 rounded-lg text-slate-500 hover:bg-slate-50',
                pathname.startsWith('/settings') && 'bg-brand-50 text-brand-700')}>
              <Settings size={18}/>
            </button>
          )}
        </nav>

        {/* Logout + Recolher */}
        <div className="px-3 py-4 border-t border-slate-100 flex items-center gap-2">
          <button onClick={signOut}
            title={collapsed ? 'Sair' : undefined}
            className={clsx('flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-500 hover:bg-red-50',
              collapsed ? 'flex-1 justify-center' : 'flex-1')}>
            <LogOut size={18}/>
            {!collapsed && 'Sair'}
          </button>
          <button onClick={() => setCollapsed(v => !v)}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className="p-2.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 flex-shrink-0">
            {collapsed ? <PanelLeft size={18}/> : <PanelLeftClose size={18}/>}
          </button>
        </div>
      </aside>

      {/* MOBILE: bottom nav */}
      {mobileMenuOpen && <div className="md:hidden fixed inset-0 z-50 bg-slate-900/40" onClick={() => setMobileMenuOpen(false)}>
        <div className="absolute bottom-0 left-0 right-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-white pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
            <div><p className="text-sm font-bold text-slate-800">Menu completo</p><p className="text-xs text-slate-400">Todas as funções do CRM</p></div>
            <button onClick={() => setMobileMenuOpen(false)} className="rounded-xl bg-slate-100 p-2 text-slate-500"><X size={20}/></button>
          </div>
          <div className="grid grid-cols-2 gap-2 p-4">
            {nav.map(item => <button key={item.href} onClick={() => { router.push(item.href); setMobileMenuOpen(false) }} className={clsx('flex items-center gap-3 rounded-xl border p-3 text-left text-sm font-semibold',isNavActive(item.href)?'border-brand-200 bg-brand-50 text-brand-700':'border-slate-100 text-slate-600')}><item.icon size={18}/>{item.label}</button>)}
            <button onClick={() => { openChat(); setMobileMenuOpen(false) }} className="relative flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-left text-sm font-semibold text-slate-600"><MessageCircle size={18}/>Chat da equipe{chatUnread>0&&<span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] text-white">{chatUnread>9?'9+':chatUnread}</span>}</button>
            <button onClick={() => { setShowProfile(true); setMobileMenuOpen(false) }} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-left text-sm font-semibold text-slate-600"><UserCog size={18}/>Meu perfil</button>
          </div>
          {isAdmin && <div className="border-t border-slate-100 px-4 pt-4"><p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Configurações</p><div className="grid grid-cols-2 gap-2">{settingsSubnav.map(item=><button key={item.href} onClick={()=>{router.push(item.href);setMobileMenuOpen(false)}} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-left text-xs font-semibold text-slate-600"><item.icon size={16}/>{item.label}</button>)}</div></div>}
          <div className="px-4 pt-4"><button onClick={signOut} className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600"><LogOut size={17}/>Sair do CRM</button></div>
        </div>
      </div>}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around z-40 h-16 pb-safe">
        {barraMobile.map(item => {
          const active = isNavActive(item.href)
          return (
            <button key={item.href} onClick={() => router.push(item.href)}
              className={clsx('flex flex-col items-center justify-center gap-0.5 flex-1 h-full',
                active ? 'text-brand-600' : 'text-slate-400')}>
              <item.icon size={20}/>
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          )
        })}
        <button onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-slate-400">
          <Menu size={20}/><span className="text-[10px] font-medium">Mais</span>
        </button>
      </nav>
    </>
  )
}
