'use client'
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

// Botão de copiar. Existe porque identificador longo digitado à mão é
// identificador digitado errado — e o erro só aparece depois, quando a
// vinculação não funciona e ninguém sabe por quê.

export default function CopiarTexto({ valor, titulo = 'Copiar' }: { valor: string; titulo?: string }) {
  const [copiado, setCopiado] = useState(false)

  async function copiar(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(valor)
    } catch {
      // Navegador sem permissão de área de transferência: seleciona o texto
      // para a pessoa copiar com o teclado, em vez de falhar em silêncio.
      const el = document.createElement('textarea')
      el.value = valor
      document.body.appendChild(el)
      el.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(el)
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1800)
  }

  return (
    <button type="button" onClick={copiar} title={titulo}
      className="p-1 text-slate-300 hover:text-slate-600 shrink-0">
      {copiado ? <Check size={13} className="text-emerald-500"/> : <Copy size={13}/>}
    </button>
  )
}
