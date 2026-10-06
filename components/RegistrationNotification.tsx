'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'
import { UserPlus, X } from 'lucide-react'

export default function RegistrationNotification() {
  const { isAdmin } = useAuth()
  const router = useRouter()
  const [count, setCount] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    const load = async (notify = false) => {
      const { count: total } = await supabase.from('user_registration_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending')
      const next = total || 0
      setCount(next)
      if (notify && next > 0) setVisible(true)
    }
    // Também mostra o aviso quando o administrador entra depois que o pedido
    // já foi criado. Antes, apenas novos INSERTs em tempo real abriam o alerta.
    load(true)
    const channel = supabase.channel('admin-registration-notification').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_registration_requests' }, () => load(true)).subscribe()
    const interval = setInterval(() => load(), 15000)
    return () => { clearInterval(interval); supabase.removeChannel(channel) }
  }, [isAdmin])

  if (!isAdmin || count === 0) return null
  return <>{visible && <div className="fixed top-5 right-5 z-[10000] w-[340px] bg-white border border-amber-200 rounded-2xl shadow-2xl p-4">
    <button onClick={() => setVisible(false)} className="absolute top-3 right-3 text-slate-400"><X size={15}/></button>
    <div className="flex gap-3"><div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center"><UserPlus size={18}/></div><div className="pr-5"><p className="text-sm font-semibold text-slate-800">Novo cadastro aguardando</p><p className="text-xs text-slate-500 mt-1">Há {count} usuário(s) esperando configuração e autorização.</p></div></div>
    <button onClick={() => { setVisible(false); router.push('/settings/agents') }} className="w-full mt-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-medium">Revisar cadastros</button>
  </div>}</>
}
