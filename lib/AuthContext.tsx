'use client'
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Agent, ClinicBranding } from '@/lib/supabase'

type AuthContextValue = {
  agent: Agent | null
  loading: boolean
  isAdmin: boolean
  branding: ClinicBranding | null
  onlineIds: Set<string>
  refreshAgent: () => Promise<void>
  refreshBranding: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  agent: null,
  loading: true,
  isAdmin: false,
  branding: null,
  onlineIds: new Set(),
  refreshAgent: async () => {},
  refreshBranding: async () => {},
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

// Converte uma cor hex (#rrggbb) em variações de tonalidade, parecido
// com a paleta brand-50..950 que já existia fixa no tailwind.config.js.
// Isso permite trocar a cor principal do sistema dinamicamente sem rebuild.
function hexToRgb(hex: string) {
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean, 16)
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
}

function mix(c1: number, c2: number, ratio: number) {
  return Math.round(c1 * (1 - ratio) + c2 * ratio)
}

function shade(hex: string, ratio: number, towards: 'white' | 'black') {
  const { r, g, b } = hexToRgb(hex)
  const target = towards === 'white' ? 255 : 0
  return `rgb(${mix(r, target, ratio)}, ${mix(g, target, ratio)}, ${mix(b, target, ratio)})`
}

function applyBrandColor(hex: string) {
  const root = document.documentElement
  root.style.setProperty('--brand-50', shade(hex, 0.94, 'white'))
  root.style.setProperty('--brand-100', shade(hex, 0.86, 'white'))
  root.style.setProperty('--brand-200', shade(hex, 0.7, 'white'))
  root.style.setProperty('--brand-300', shade(hex, 0.5, 'white'))
  root.style.setProperty('--brand-400', shade(hex, 0.25, 'white'))
  root.style.setProperty('--brand-500', hex)
  root.style.setProperty('--brand-600', shade(hex, 0.12, 'black'))
  root.style.setProperty('--brand-700', shade(hex, 0.28, 'black'))
  root.style.setProperty('--brand-800', shade(hex, 0.42, 'black'))
  root.style.setProperty('--brand-900', shade(hex, 0.56, 'black'))
  root.style.setProperty('--brand-950', shade(hex, 0.7, 'black'))
}

function applyFavicon(url: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = url
}

function applyBubbleColors(b: ClinicBranding) {
  const root = document.documentElement
  root.style.setProperty('--bubble-out-bg', b.bubble_out_bg || '#dcfce7')
  root.style.setProperty('--bubble-out-color', b.bubble_out_color || '#14532d')
  root.style.setProperty('--bubble-in-bg', b.bubble_in_bg || '#ffffff')
  root.style.setProperty('--bubble-in-color', b.bubble_in_color || '#0f172a')
  root.style.setProperty('--bubble-private-bg', b.bubble_private_bg || '#fff7ed')
  root.style.setProperty('--bubble-private-color', b.bubble_private_color || '#7c2d12')
  if (b.clinic_name) {
    // Preserva o badge se já existir
    try {
      const total = localStorage.getItem('crm_badge_total')
      const base = b.clinic_name + ' CRM'
      localStorage.setItem('crm_badge_base', base)
      document.title = (total && total !== '0') ? `(${total}) ${base}` : base
    } catch {
      document.title = b.clinic_name + ' CRM'
    }
  }
}

// v46.86: rotas públicas — sem login — que o AuthProvider global (abaixo)
// NUNCA deve redirecionar para /login. São os links que o paciente recebe por
// WhatsApp e abre no celular dele, onde login nenhum existe:
//   /confirmar/[id] — confirmação de consulta
//   /pagar/[id]     — cobrança PIX (v47.09)
//   /pagar-cartao/[id]    — paciente escolhe o parcelamento (v47.18)
//   /pagamento-confirmado — retorno depois de pagar no Safra (v47.14)
// Qualquer nova rota pública futura tem que ser acrescentada aqui, senão o
// paciente cai na tela de login.
const ROTAS_PUBLICAS = ['/confirmar/', '/pagar/', '/pagar-cartao/', '/pagamento-confirmado', '/rgo/', '/agendar-cirurgia/']  // /rgo/ e /agendar-cirurgia/ — telas do cirurgião, sem login (v48.59, v48.76)

function isPublicPath(pathname: string) {
  return pathname === '/login' || ROTAS_PUBLICAS.some(r => pathname.startsWith(r))
}

export function isSecretaryJobTitle(jobTitle: string | null | undefined) {
  const normalized = (jobTitle || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  return /\bsecretari[ao]\b/.test(normalized)
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [branding, setBranding] = useState<ClinicBranding | null>(null)
  const [loading, setLoading] = useState(true)
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const agentRef = useRef<Agent | null>(null)
  const baseTitle = useRef('Obesity Health CRM')

  // Atualiza badge globalmente
  function updateBadge(total: number) {
    const title = total > 0 ? `(${total}) ${baseTitle.current}` : baseTitle.current
    document.title = title
    try { localStorage.setItem('crm_badge_total', String(total)) } catch {}
  }

  // Busca contagens de não lidos
  async function loadBadge(agentId: string, isAdmin: boolean) {
    try {
      // INBOX: sem assigned_to, não closed/inactive/pending
      const { count: inboxCount } = await supabase.from('contacts')
        .select('*', { count: 'exact', head: true })
        .is('assigned_to', null)
        .or('conversation_status.is.null,conversation_status.eq.active')

      // PENDENTES: assigned_to = agent
      const { count: pendingCount } = await supabase.from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to', agentId)
        .eq('conversation_status', 'pending')

      // ATIVOS com msg não lida (última msg inbound)
      const activeQuery = supabase.from('contacts')
        .select('id')
        .eq('conversation_status', 'active')
        .not('sector_id', 'is', null)
      if (!isAdmin) activeQuery.eq('assigned_to', agentId)
      const { data: activeContacts } = await activeQuery.limit(100)

      updateBadge((inboxCount ?? 0) + (pendingCount ?? 0))
    } catch {}
  }

  const loadAgent = useCallback(async (userId: string) => {
    const { data } = await supabase.from('agents').select('*').eq('id', userId).single()
    setAgent(data as Agent | null)
    agentRef.current = data as Agent | null
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
    if (!data) {
      // Uma identidade válida no Supabase não significa acesso liberado ao CRM.
      // Sem perfil em agents, o usuário permanece na fila de aprovação.
      if (currentPath !== '/pending' && currentPath !== '/login') router.replace('/pending')
      return
    }
    if (data) {
      // Uma secretária presente assume o atendimento humano. Pausa a Sofia global
      // uma única vez por sessão de login (não a cada refresh da página).
      if (isSecretaryJobTitle(data.job_title)) {
        const pauseKey = `secretary-login-global-pause:${data.id}`
        let alreadyApplied = false
        try { alreadyApplied = sessionStorage.getItem(pauseKey) === '1' } catch {}
        if (!alreadyApplied) {
          const { error: pauseError } = await supabase.from('clinic_settings')
            .update({ sofia_paused_global: true })
            .not('id', 'is', null)
          if (!pauseError) {
            try { sessionStorage.setItem(pauseKey, '1') } catch {}
          }
        }
      }
      const isAdm = data.role === 'admin' || data.sees_all_sectors
      loadBadge(data.id, isAdm)
    }
    if (currentPath === '/login' || currentPath === '/pending') router.replace('/inbox')
  }, [])

  const loadBranding = useCallback(async () => {
    const { data } = await supabase
      .from('clinic_branding')
      .select('*')
      .eq('clinic_id', '00000000-0000-0000-0000-000000000001')
      .single()
    if (data) {
      setBranding(data as ClinicBranding)
      applyBrandColor((data as ClinicBranding).primary_color)
      applyBubbleColors(data as ClinicBranding)
      const logoUrl = (data as ClinicBranding).logo_url
      if (logoUrl) {
        try { localStorage.setItem('crm_favicon', logoUrl) } catch {}
        applyFavicon(logoUrl)
      }
      const clinicName = (data as ClinicBranding).clinic_name
      if (clinicName) {
        baseTitle.current = clinicName + ' CRM'
        try { localStorage.setItem('crm_badge_base', baseTitle.current) } catch {}
      }
      // Restaura badge ao carregar
      try {
        const total = localStorage.getItem('crm_badge_total')
        document.title = (total && total !== '0') ? `(${total}) ${baseTitle.current}` : baseTitle.current
      } catch {
        document.title = baseTitle.current
      }
    }
  }, [])

  useEffect(() => {
    loadBranding()

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) loadAgent(session.user.id)
      else if (!isPublicPath(window.location.pathname)) router.replace('/login')
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadAgent(session.user.id)
      } else {
        setAgent(null)
        agentRef.current = null
        if (!isPublicPath(window.location.pathname)) router.replace('/login')
      }
    })

    // Realtime global para badge — atualiza em qualquer página
    const badgeChannel = supabase.channel('global-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => {
        const a = agentRef.current
        if (a) loadBadge(a.id, a.role === 'admin' || a.sees_all_sectors)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        const a = agentRef.current
        if (a) loadBadge(a.id, a.role === 'admin' || a.sees_all_sectors)
      })
      .subscribe()

    // Heartbeat de presença — marca online a cada 15s
    async function heartbeat() {
      const a = agentRef.current
      if (a?.id) {
        try { await supabase.from('agents').update({ is_online: true, last_seen_at: new Date().toISOString() }).eq('id', a.id) } catch {}
      }
    }
    heartbeat()
    const presenceInterval = setInterval(heartbeat, 15000)
    const onFocus = () => heartbeat()
    window.addEventListener('focus', onFocus)

    // Supabase Presence — detecta saída instantânea (websocket cai ao fechar aba)
    //
    // v48.113 — O websocket do Realtime cai e reconecta sozinho de vez em
    // quando (rede oscilando, VPN, notebook suspendendo o wi-fi por um
    // instante) sem que a pessoa tenha realmente saído. Cada uma dessas
    // quedas dispara um 'leave' seguido, segundos depois, de um novo 'sync'
    // com a pessoa de volta — e isso aparecia pra quem está olhando (painel
    // "Equipe agora" do Dashboard) como o usuário "saindo e voltando" o
    // tempo todo. A correção: não tira ninguém de onlineIds nem marca
    // offline no banco na hora do 'leave' — dá um prazo de tolerância
    // e só marca offline de verdade se a pessoa continuar ausente do
    // presenceState() depois desse prazo. Se ela voltar antes (reconexão
    // normal), o timer é cancelado e ninguém percebe a queda.
    //
    // v48.170 — Jorge: "ainda está oscilando online e offline". 12s de
    // tolerância é pouco para celular: trocar de app, a tela apagar, ou uma
    // oscilação normal de 4G/wi-fi facilmente levam 15-30s para o navegador
    // reconectar o websocket — o suficiente para estourar os 12s e marcar
    // offline, e aí a reconexão (que ainda ia acontecer) faz oscilar nos
    // olhos de quem está olhando. Subindo para 40s.
    const TOLERANCIA_PRESENCA_MS = 40000
    let presenceChannel: ReturnType<typeof supabase.channel> | null = null
    const pendingOffline = new Map<string, ReturnType<typeof setTimeout>>()
    const currentlyPresentIds = () => {
      const state = presenceChannel!.presenceState() as any
      const ids = new Set<string>()
      Object.values(state).forEach((arr: any) => {
        arr.forEach((p: any) => { if (p.agent_id) ids.add(p.agent_id) })
      })
      return ids
    }
    const initPresence = () => {
      const a = agentRef.current
      if (!a?.id) return
      presenceChannel = supabase.channel('online-agents', {
        config: { presence: { key: a.id } }
      })
      presenceChannel
        .on('presence', { event: 'sync' }, () => {
          // Estado completo de quem está online AGORA (instantâneo)
          const present = currentlyPresentIds()
          setOnlineIds(prev => {
            const next = new Set(prev)
            present.forEach(id => {
              next.add(id)
              const t = pendingOffline.get(id)
              if (t) { clearTimeout(t); pendingOffline.delete(id) }
            })
            prev.forEach(id => {
              if (present.has(id) || pendingOffline.has(id)) return
              // Sumiu do presence agora — não remove ainda, espera o prazo
              // de tolerância pra ver se foi só uma queda momentânea.
              const timer = setTimeout(() => {
                pendingOffline.delete(id)
                if (currentlyPresentIds().has(id)) return
                setOnlineIds(curr => {
                  if (!curr.has(id)) return curr
                  const s = new Set(curr); s.delete(id); return s
                })
                supabase.from('agents')
                  .update({ is_online: false, last_seen_at: new Date(Date.now() - 300000).toISOString() })
                  .eq('id', id)
                  .then(() => {}, () => {})
              }, TOLERANCIA_PRESENCA_MS)
              pendingOffline.set(id, timer)
            })
            return next
          })
        })
        .subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED') {
            await presenceChannel!.track({ agent_id: a.id, online_at: new Date().toISOString() })
          }
        })
    }
    initPresence()

    // Marca offline ao fechar/sair — envia last_seen antigo para expirar imediatamente
    const markOffline = () => {
      const a = agentRef.current
      if (!a?.id) return
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/agents?id=eq.${a.id}`
      const body = JSON.stringify({ is_online: false, last_seen_at: new Date(Date.now() - 300000).toISOString() })
      const blob = new Blob([body], { type: 'application/json' })
      // sendBeacon não permite headers customizados; usa fetch keepalive
      try {
        fetch(url, {
          method: 'PATCH',
          headers: {
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body,
          keepalive: true,
        })
      } catch {}
      // Fechar a aba/janela deve ter o mesmo efeito do botão Sair para a Sofia.
      // keepalive permite concluir a atualização mesmo durante o fechamento.
      if (isSecretaryJobTitle(a.job_title)) {
        const settingsUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/clinic_settings?id=not.is.null`
        try {
          fetch(settingsUrl, {
            method: 'PATCH',
            headers: {
              'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
              'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ sofia_paused_global: false }),
            keepalive: true,
          })
        } catch {}
      }
    }
    const onUnload = () => markOffline()
    // Trocar de aba não é logout. Marcar offline em `hidden` concorria com o
    // heartbeat e fazia o estado alternar entre online/offline.
    const onVisibility = () => { if (document.visibilityState === 'visible') heartbeat() }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('pagehide', onUnload)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      listener.subscription.unsubscribe()
      supabase.removeChannel(badgeChannel)
      if (presenceChannel) supabase.removeChannel(presenceChannel)
      clearInterval(presenceInterval)
      pendingOffline.forEach(t => clearTimeout(t))
      pendingOffline.clear()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('pagehide', onUnload)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loadAgent, loadBranding])

  const signOut = useCallback(async () => {
    const current = agentRef.current
    // A segunda autenticação da configuração da Sofia nunca sobrevive ao logout.
    try {
      sessionStorage.removeItem('sofia-settings-unlocked') // compatibilidade com a v44 inicial
      if (current?.id) sessionStorage.removeItem(`sofia-settings-unlocked:${current.id}`)
    } catch {}
    if (current?.id) {
      try { sessionStorage.removeItem(`secretary-login-global-pause:${current.id}`) } catch {}
      if (isSecretaryJobTitle(current.job_title)) {
        await supabase.from('clinic_settings')
          .update({ sofia_paused_global: false })
          .not('id', 'is', null)
      }
      await supabase.from('agents').update({
        is_online: false,
        last_seen_at: new Date(Date.now() - 300000).toISOString(),
      }).eq('id', current.id)
    }
    await supabase.auth.signOut()
    setOnlineIds(new Set())
    setAgent(null)
    router.replace('/login')
  }, [router])

  const value: AuthContextValue = {
    agent,
    loading,
    isAdmin: agent?.role === 'admin',
    branding,
    onlineIds,
    refreshAgent: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) await loadAgent(session.user.id)
    },
    refreshBranding: loadBranding,
    signOut,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
