'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// A via de acesso — robótica, videolaparoscopia, convencional.
//
// Está numa tabela, e não numa lista fixa no código, porque a via é do tipo de
// coisa que muda sozinha: amanhã aparece endoscópica, ou robótica de um
// fabricante específico, e ninguém deveria precisar de uma versão nova do
// sistema por causa disso.
//
// As três chegam semeadas pela migração v48.25; o resto se cadastra em
// Configurações → Cirurgias.

export type Via = { id: string; nome: string }

export function useVias() {
  const [vias, setVias] = useState<Via[]>([])

  useEffect(() => {
    let vivo = true
    supabase.from('cirurgia_vias').select('id, nome').eq('ativo', true).order('ordem')
      .then(({ data }) => { if (vivo) setVias((data ?? []) as Via[]) })
    return () => { vivo = false }
  }, [])

  return vias
}

// Abreviação que cabe no cartão da lista sem empurrar o resto para baixo.
export function viaCurta(via: string | null | undefined) {
  const v = (via || '').toUpperCase()
  if (!v) return ''
  if (v.startsWith('ROB')) return 'robótica'
  if (v.startsWith('VIDEO') || v.startsWith('VÍDEO') || v.includes('LAPAROSCOP')) return 'vídeo'
  if (v.startsWith('CONVEN')) return 'convencional'
  return via!.toLowerCase()
}
