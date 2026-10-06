'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, UserPlus, LogIn } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingGoogle, setLoadingGoogle] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [primaryColor, setPrimaryColor] = useState('#0c8ee7')
  const [clinicName, setClinicName] = useState('Obesity Health')

  // v48.112 — Código da equipe para completar o cadastro. O mesmo domínio do
  // CRM recebe paciente (links de confirmação, cirurgia etc.) e, de vez em
  // quando, alguém cai aqui e "se cadastra" achando que precisa — vira um
  // pedido de aprovação de atendente que não é atendente nenhum (caso real:
  // Claudiana Rodrigues, uma paciente). Sem código configurado pela clínica
  // (Configurações → Sistema), nada muda — o cadastro continua livre.
  const [codigoExigido, setCodigoExigido] = useState(false)
  const [codigoConvite, setCodigoConvite] = useState('')

  useEffect(() => {
    supabase.from('clinic_branding').select('logo_url, primary_color, clinic_name')
      .eq('clinic_id', '00000000-0000-0000-0000-000000000001').single()
      .then(({ data }) => {
        if (data?.logo_url) setLogoUrl(data.logo_url)
        if (data?.primary_color) setPrimaryColor(data.primary_color)
        if (data?.clinic_name) setClinicName(data.clinic_name)
      })
    supabase.rpc('codigo_convite_equipe_exigido').then(({ data }) => setCodigoExigido(!!data))
  }, [])

  async function codigoConviteValido() {
    if (!codigoExigido) return true
    const { data, error: rpcError } = await supabase.rpc('verificar_codigo_convite_equipe', { candidate: codigoConvite.trim() })
    if (rpcError || !data) {
      setError('Código da equipe incorreto. Peça o código a um administrador da clínica.')
      return false
    }
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setNotice('')
    if (mode === 'login') {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) { setError('Email ou senha incorretos.'); setLoading(false); return }
      // v48.159 — Não decide a navegação aqui. O AuthProvider (lib/AuthContext.tsx)
      // já escuta esse mesmo login via onAuthStateChange e faz a checagem igual
      // (tem perfil em agents? manda pra /inbox, senão /pending). Fazer isso nos
      // dois lugares ao mesmo tempo -- aqui e lá -- é o motivo provável do "só
      // entra de verdade na segunda tentativa" no celular: duas buscas do
      // perfil e dois router.replace concorrentes, podendo um atropelar o
      // outro numa rede mais lenta. Deixa só o AuthProvider navegar; se por
      // algum motivo ele não navegar, libera o botão depois de 8s pra tentar
      // de novo em vez de travar pra sempre em "Aguarde...".
      window.setTimeout(() => setLoading(false), 8000)
      return
    }

    if (name.trim().length < 3) { setError('Informe seu nome completo.'); setLoading(false); return }
    if (password.length < 8) { setError('A senha precisa ter pelo menos 8 caracteres.'); setLoading(false); return }
    if (!(await codigoConviteValido())) { setLoading(false); return }
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: {
        emailRedirectTo: `${window.location.origin}/pending`,
        data: { full_name: name.trim(), registration_source: 'email' },
      },
    })
    if (signUpError) { setError(signUpError.message.includes('already') ? 'Este email já está cadastrado.' : 'Não foi possível fazer o cadastro.'); setLoading(false); return }
    if (data.session) router.replace('/pending')
    else setNotice('Cadastro recebido. Confirme seu email e depois aguarde a autorização do administrador.')
    setLoading(false)
  }

  async function handleGoogle() {
    setLoadingGoogle(true); setError('')
    if (mode === 'signup' && !(await codigoConviteValido())) { setLoadingGoogle(false); return }
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/pending`,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    })
    if (oauthError) { setError('Não foi possível iniciar o acesso com Google.'); setLoadingGoogle(false) }
  }

  return (
    <div className="h-[100dvh] overflow-y-auto flex items-start sm:items-center justify-center px-3 py-3 sm:p-4" style={{ background: `linear-gradient(135deg, ${primaryColor}dd, ${primaryColor}88)` }}>
      <div className="w-full max-w-md my-auto">
        <div className="text-center mb-3 sm:mb-4">
          {logoUrl ? <img src={logoUrl} alt="Logo" className="h-14 sm:h-28 max-w-[230px] sm:max-w-full w-auto object-contain drop-shadow-lg mx-auto mb-2 sm:mb-3"/> :
            <div className="inline-flex items-center justify-center w-14 h-14 sm:w-20 sm:h-20 bg-white/10 rounded-2xl mb-2 sm:mb-4 border border-white/20"><span className="text-white text-2xl sm:text-3xl font-bold">O</span></div>}
          <h1 className="text-xl sm:text-2xl font-bold text-white">{clinicName}</h1>
          <p className="text-white/70 text-sm mt-1">Painel de Atendimento</p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-xl p-1 mb-4">
            <button type="button" onClick={() => { setMode('login'); setError(''); setNotice('') }} className={`py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 ${mode === 'login' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}><LogIn size={15}/> Entrar</button>
            <button type="button" onClick={() => { setMode('signup'); setError(''); setNotice('') }} className={`py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 ${mode === 'signup' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}><UserPlus size={15}/> Cadastrar</button>
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-800 mb-3 sm:mb-4">{mode === 'login' ? 'Entrar na sua conta' : 'Solicitar acesso ao CRM'}</h2>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">{error}</div>}
          {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3 rounded-lg mb-4">{notice}</div>}
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'signup' && <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Nome completo</label><input value={name} onChange={e => setName(e.target.value)} required placeholder="Seu nome completo" className="w-full px-4 py-3 sm:py-2.5 rounded-xl border border-slate-200 text-base sm:text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"/></div>}
            {mode === 'signup' && codigoExigido && <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Código da equipe</label><input value={codigoConvite} onChange={e => setCodigoConvite(e.target.value)} required placeholder="Peça a um administrador" className="w-full px-4 py-3 sm:py-2.5 rounded-xl border border-slate-200 text-base sm:text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"/></div>}
            <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="seu@email.com" className="w-full px-4 py-3 sm:py-2.5 rounded-xl border border-slate-200 text-base sm:text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"/></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Senha</label><div className="relative"><input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'signup' ? 8 : undefined} placeholder="••••••••" className="w-full px-4 py-3 sm:py-2.5 pr-12 rounded-xl border border-slate-200 text-base sm:text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"/><button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 p-1">{showPwd ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></div>
            <button type="submit" disabled={loading} className="w-full text-white font-semibold py-3 sm:py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60" style={{ backgroundColor: primaryColor }}>{loading ? <><Loader2 size={16} className="animate-spin"/> Aguarde...</> : mode === 'login' ? 'Entrar' : 'Criar cadastro'}</button>
          </form>
          <div className="relative my-4"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"/></div><div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-slate-400">ou</span></div></div>
          <button onClick={handleGoogle} disabled={loadingGoogle} className="w-full flex items-center justify-center gap-3 px-4 py-3 sm:py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">{loadingGoogle ? <Loader2 size={16} className="animate-spin"/> : <GoogleIcon/>}{mode === 'login' ? 'Entrar com Google' : 'Cadastrar com Google'}</button>
          <p className="text-center text-xs text-slate-400 mt-4">Novos cadastros precisam ser autorizados por um administrador.</p>
        </div>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.259h2.909c1.702-1.567 2.684-3.875 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.909-2.259c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.963 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58z"/>
  </svg>
}
