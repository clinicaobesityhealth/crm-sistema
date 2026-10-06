'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, ListChecks } from 'lucide-react'

// O campo de NOME da cirurgia, buscando na tabela TUSS enquanto se digita.
//
// Antes era um campo de texto livre: dava para escrever "Gas" e salvar. O nome
// da cirurgia, porém, não é texto livre em lugar nenhum — ele sai na guia, no
// pedido ao hospital e no reembolso, e o convênio confere contra a descrição
// oficial da ANS. Um nome abreviado ali é glosa depois.
//
// Continua aceitando digitação livre, porque cirurgia sem TUSS existe (as
// particulares que a ANS não lista). A diferença é que agora o nome oficial
// está a duas letras de distância, e vem com o código junto.

type Achado = { codigo: string; nome: string }

export default function BuscaNomeTuss({
  valor, onTexto, onEscolher, placeholder, className, autoFocus,
}: {
  valor: string
  onTexto: (v: string) => void
  onEscolher: (nome: string, codigoTuss: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  const [achados, setAchados] = useState<Achado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [tocado, setTocado] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  const procurar = useCallback(async (q: string) => {
    setBuscando(true)
    const so = q.replace(/[%(),*]/g, ' ').trim()
    const numeros = so.replace(/\D/g, '')
    const filtro = numeros.length >= 4
      ? `code.ilike.${numeros}%`
      : `procedure_name.ilike.%${so}%`

    const { data } = await supabase
      .from('tuss_catalog')
      .select('code, procedure_name')
      .or(filtro)
      .eq('is_active', true)
      .limit(10)

    setAchados(((data ?? []) as any[]).map(t => ({ codigo: t.code, nome: t.procedure_name })))
    setBuscando(false)
  }, [])

  // Só busca depois que a pessoa mexeu no campo. Sem isso, abrir uma cirurgia
  // já cadastrada dispararia uma busca pelo nome inteiro dela, e a lista
  // apareceria por cima do formulário sem ninguém ter pedido.
  useEffect(() => {
    if (!tocado) return
    const q = valor.trim()
    if (q.length < 3) { setAchados([]); return }
    const t = setTimeout(() => procurar(q), 250)
    return () => clearTimeout(t)
  }, [valor, tocado, procurar])

  const cls = className
    || 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div ref={caixa} className="relative">
      <input
        value={valor}
        autoFocus={autoFocus}
        onChange={e => { setTocado(true); setAberto(true); onTexto(e.target.value) }}
        onFocus={() => { if (tocado) setAberto(true) }}
        placeholder={placeholder || 'Nome da cirurgia ou código TUSS...'}
        className={cls}/>

      {aberto && tocado && valor.trim().length >= 3 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          <p className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-50">
            <ListChecks size={11}/> tabela TUSS
          </p>
          {buscando ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-400">
              <Loader2 size={13} className="animate-spin"/> Procurando...
            </div>
          ) : achados.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-slate-400">
              Nada com esse nome na tabela TUSS. Pode deixar escrito assim mesmo — o nome digitado é salvo.
            </p>
          ) : achados.map(a => (
            <button key={a.codigo} type="button"
              onClick={() => { onEscolher(a.nome, a.codigo); setAberto(false) }}
              className="w-full text-left px-3 py-2 hover:bg-brand-50 border-b border-slate-50">
              <p className="text-xs text-slate-700 leading-snug">{a.nome}</p>
              <p className="text-[11px] text-brand-600 font-semibold">TUSS {a.codigo}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
