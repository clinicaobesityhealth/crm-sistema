'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export function useAiAssistantName() {
  const [name, setName] = useState('Sofia')

  useEffect(() => {
    let active = true
    const load = () => supabase.from('clinic_settings').select('sofia_config').limit(1)
      .then(({ data }) => {
        const configured = data?.[0]?.sofia_config?.assistant_name?.trim()
        if (active && configured) setName(configured)
      })
    load()
    // v48.53 — nome de canal ÚNICO por uso. Com o mesmo nome, o Supabase
    // devolve o canal já inscrito da outra tela aberta (ex.: Atendimento +
    // painel do cadastro) e o .on() depois do subscribe() derruba a página
    // inteira com "Application error".
    const channel = supabase.channel('assistant-display-name-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clinic_settings' }, (payload) => {
        const configured = (payload.new as any)?.sofia_config?.assistant_name?.trim()
        if (configured) setName(configured)
        else load()
      }).subscribe()
    return () => { active = false; supabase.removeChannel(channel) }
  }, [])

  return name
}
