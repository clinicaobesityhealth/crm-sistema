'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Clock3, Loader2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'

type Registration = { status: 'pending' | 'approved' | 'rejected'; rejection_reason?: string | null }

export default function PendingApprovalPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [registration, setRegistration] = useState<Registration | null>(null)
  const [email, setEmail] = useState('')

  async function checkAccess() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }
    setEmail(user.email || '')
    const { data: profile } = await supabase.from('agents').select('id').eq('id', user.id).maybeSingle()
    if (profile) { router.replace('/inbox'); return }
    const { data } = await supabase.from('user_registration_requests').select('status,rejection_reason').eq('user_id', user.id).maybeSingle()
    setRegistration(data as Registration | null)
    setLoading(false)
  }

  useEffect(() => {
    checkAccess()
    const channel = supabase.channel('my-registration-status').on('postgres_changes', { event: '*', schema: 'public', table: 'user_registration_requests' }, checkAccess).subscribe()
    const interval = setInterval(checkAccess, 15000)
    return () => { clearInterval(interval); supabase.removeChannel(channel) }
  }, [])

  async function leave() { await supabase.auth.signOut(); router.replace('/login') }

  return <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
    <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 p-8 text-center">
      <div className={`w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center ${registration?.status === 'rejected' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
        {loading ? <Loader2 size={28} className="animate-spin"/> : registration?.status === 'rejected' ? <ShieldCheck size={28}/> : <Clock3 size={28}/>} 
      </div>
      <h1 className="text-xl font-semibold text-slate-800">{registration?.status === 'rejected' ? 'Acesso não autorizado' : 'Aguardando autorização'}</h1>
      <p className="text-sm text-slate-500 mt-3 leading-relaxed">
        {registration?.status === 'rejected' ? (registration.rejection_reason || 'O administrador não autorizou este cadastro.') : 'Seu cadastro foi recebido. Um administrador da clínica concluirá seu perfil e liberará o acesso.'}
      </p>
      {email && <p className="text-xs text-slate-400 mt-3">Cadastro: {email}</p>}
      <div className="flex gap-2 mt-7">
        <button onClick={leave} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 flex items-center justify-center gap-2"><LogOut size={15}/> Sair</button>
        <button onClick={checkAccess} disabled={loading} className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"><RefreshCw size={15}/> Verificar</button>
      </div>
    </div>
  </div>
}
