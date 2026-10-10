'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'

// v48.175 — Quem pode ver o Prontuário (histórico clínico do paciente, vindo
// do MedX: anotações de evolução, alergias, medicamentos, exames...).
//
// Pedido do Jorge: "esta área deve ser acessada só pelos médicos, secretária
// não" — é dado clínico sensível. Mesmo desenho já usado para cirurgias e
// agenda pessoal: o acesso vem do CARGO, não da pessoa, então quem entra
// novo na equipe já nasce com a permissão certa conforme o cargo.
//
// `null` enquanto carrega: as telas esperam esse momento em vez de decidir,
// senão o conteúdo piscaria antes de saber a resposta.
export function useAcessoProntuario(): boolean | null {
  const { agent, isAdmin, loading } = useAuth()
  const [pode, setPode] = useState<boolean | null>(null)

  useEffect(() => {
    if (loading) return
    if (!agent) { setPode(false); return }
    if (isAdmin) { setPode(true); return }

    const cargo = (agent.job_title || '').trim()
    if (!cargo) { setPode(false); return }

    let cancelado = false
    supabase.from('job_titles').select('ve_prontuario').ilike('name', cargo).limit(1)
      .then(({ data, error }) => {
        if (cancelado) return
        // Se a coluna ainda não existe (SQL não rodado), não libera ninguém
        // à toa — fica só com o administrador até a migração rodar.
        if (error) { setPode(false); return }
        setPode(data?.[0]?.ve_prontuario === true)
      })
    return () => { cancelado = true }
  }, [agent, isAdmin, loading])

  return pode
}
