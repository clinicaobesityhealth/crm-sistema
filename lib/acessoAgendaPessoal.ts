'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'

// Quem tem agenda pessoal no CRM.
//
// Mesmo desenho do acesso às cirurgias: depende do CARGO, não da pessoa. Quem
// não tem, não vê o item no menu — e a tela também recusa, porque esconder o
// menu não impede quem souber o endereço.
//
// `null` enquanto carrega: as telas esperam em vez de decidir, senão o menu
// pisca e a página redireciona antes de saber a resposta.

export function useAcessoAgendaPessoal(): boolean | null {
  const { agent, isAdmin, loading } = useAuth()
  const [pode, setPode] = useState<boolean | null>(null)

  useEffect(() => {
    if (loading) return
    if (!agent) { setPode(false); return }
    if (isAdmin) { setPode(true); return }

    const cargo = (agent.job_title || '').trim()
    if (!cargo) { setPode(false); return }

    let cancelado = false
    supabase.from('job_titles').select('ve_agenda_pessoal').ilike('name', cargo).limit(1)
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) { setPode(false); return }
        setPode(data?.[0]?.ve_agenda_pessoal === true)
      })
    return () => { cancelado = true }
  }, [agent, isAdmin, loading])

  return pode
}
