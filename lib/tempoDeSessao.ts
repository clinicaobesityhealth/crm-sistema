'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// v48.47 — Quanto tempo de tela parada até o CRM encerrar a sessão no celular.
//
// Era um número escrito no código: trinta minutos, decididos uma vez. Virou
// configuração da clínica porque quem sabe o tempo certo é quem trabalha no
// balcão, não quem escreveu o programa.
//
// Zero desliga o encerramento automático. Vazio, ou qualquer valor que não faça
// sentido, volta para os trinta minutos — este hook nunca devolve um tempo
// absurdo, porque um erro de digitação aqui seria alguém perdendo a sessão a
// cada dez segundos.

export const MINUTOS_PADRAO = 30
export const MINUTOS_MAXIMO = 24 * 60

export function normalizarMinutos(v: any): number {
  const n = Math.round(Number(v))
  if (!isFinite(n) || n < 0) return MINUTOS_PADRAO
  if (n === 0) return 0
  if (n > MINUTOS_MAXIMO) return MINUTOS_MAXIMO
  return n
}

export function useMinutosDeSessao(): number {
  const [minutos, setMinutos] = useState<number>(MINUTOS_PADRAO)

  useEffect(() => {
    let vivo = true
    supabase.from('clinic_settings').select('mobile_logout_minutes').limit(1).maybeSingle()
      .then(({ data, error }) => {
        // Coluna ainda não criada (migração não rodada) ou leitura negada: fica
        // no padrão. O CRM não pode deixar de funcionar por causa disto.
        if (!vivo || error || !data) return
        const v = (data as any).mobile_logout_minutes
        if (v === null || v === undefined) return
        setMinutos(normalizarMinutos(v))
      })
    return () => { vivo = false }
  }, [])

  return minutos
}
