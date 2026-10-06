'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'

// Quem pode ver a agenda cirúrgica.
//
// Administrador sempre pode. Fora isso, depende do CARGO — e não da pessoa:
// quando alguém novo entra na equipe, o acesso vem junto com o cargo, sem
// ninguém precisar lembrar de liberar.
//
// Enquanto a resposta não chega, o valor é `null`: nem sim nem não. As telas
// esperam esse momento em vez de decidir, senão o menu piscaria e a página
// redirecionaria antes de saber.

export function useAcessoCirurgias(): boolean | null {
  const { agent, isAdmin, loading } = useAuth()
  const [pode, setPode] = useState<boolean | null>(null)

  useEffect(() => {
    if (loading) return
    if (!agent) { setPode(false); return }
    if (isAdmin) { setPode(true); return }

    const cargo = (agent.job_title || '').trim()
    if (!cargo) { setPode(false); return }

    let cancelado = false
    supabase.from('job_titles').select('ve_cirurgias').ilike('name', cargo).limit(1)
      .then(({ data, error }) => {
        if (cancelado) return
        // Se a coluna ainda não existe (SQL não rodado), não trava ninguém de
        // fora à toa — mas também não abre: mantém só o administrador.
        if (error) { setPode(false); return }
        setPode(data?.[0]?.ve_cirurgias === true)
      })
    return () => { cancelado = true }
  }, [agent, isAdmin, loading])

  return pode
}
