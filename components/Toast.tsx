'use client'
import { useEffect } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'

// v48.84 — O aviso de "salvo" que dá para ver.
//
// O texto discreto no rodapé do formulário não era lido: quem acabou de clicar
// em salvar está olhando para o botão, não para o pé da página. Este aparece
// por cima, no meio de baixo, e some sozinho.
//
// Sem contexto nem provedor de propósito: a tela pública do cirurgião não tem
// os provedores do CRM, e um aviso de salvamento não deveria depender disso.

export type Aviso = { texto: string; tom?: 'ok' | 'erro' } | null

export default function Toast({ aviso, aoFechar, segundos = 4 }: {
  aviso: Aviso
  aoFechar: () => void
  segundos?: number
}) {
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(aoFechar, segundos * 1000)
    return () => clearTimeout(t)
  }, [aviso, aoFechar, segundos])

  if (!aviso) return null
  const erro = aviso.tom === 'erro'

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-[80] w-[min(26rem,calc(100vw-2rem))]"
      role="status" aria-live="polite">
      <div className={'flex items-start gap-2.5 rounded-2xl px-4 py-3 shadow-xl border '
        + (erro ? 'bg-red-600 border-red-700 text-white' : 'bg-slate-900 border-slate-800 text-white')}>
        {erro ? <AlertCircle size={17} className="shrink-0 mt-0.5"/> : <CheckCircle2 size={17} className="shrink-0 mt-0.5 text-emerald-400"/>}
        <p className="text-sm flex-1 leading-snug">{aviso.texto}</p>
        <button onClick={aoFechar} className="p-0.5 text-white/60 hover:text-white shrink-0"><X size={15}/></button>
      </div>
    </div>
  )
}
