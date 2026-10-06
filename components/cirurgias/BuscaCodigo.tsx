'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, Check } from 'lucide-react'

// Busca no catálogo oficial (CID-10 do DATASUS, TUSS 22 da ANS).
//
// O ganho aqui não é comodidade: é que um dígito trocado no TUSS só aparece
// quando o convênio devolve a guia, semanas depois. Buscando pelo nome, o
// código vem conferido da tabela oficial.
//
// A tela continua aceitando digitação livre — se o catálogo ainda não foi
// importado, ou se o código é de uma versão que não está nele, nada trava.

type Sugestao = { codigo: string; descricao: string }

// No arquivo do DATASUS o CID vem sem ponto (K811). Na guia, na carta e na
// planilha ele aparece com ponto (K81.1). Guardamos na forma que as pessoas
// leem, e a busca ignora o ponto dos dois lados.
export function formatarCid(code: string) {
  const c = code.replace(/\./g, '').toUpperCase()
  return /^[A-Z]\d{2}.+$/.test(c) ? c.slice(0, 3) + '.' + c.slice(3) : c
}

export default function BuscaCodigo({
  tipo, codigo, descricao, onEscolher, onCodigo, onDescricao,
}: {
  tipo: 'tuss' | 'cid'
  codigo: string
  descricao: string
  onEscolher: (codigo: string, descricao: string) => void
  onCodigo: (v: string) => void
  onDescricao: (v: string) => void
}) {
  const [termo, setTermo] = useState('')
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [buscando, setBuscando] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [semCatalogo, setSemCatalogo] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora — sem isso a lista fica pendurada sobre o formulário.
  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  useEffect(() => {
    const q = termo.trim()
    if (q.length < 3) { setSugestoes([]); return }
    // Espera a pessoa parar de digitar. Buscar a cada tecla em 12 mil linhas
    // enche a fila de consultas e a lista pisca com resultado velho.
    const t = setTimeout(() => buscar(q), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo, tipo])

  async function buscar(q: string) {
    setBuscando(true)
    const tabela = tipo === 'tuss' ? 'tuss_catalog' : 'cid_catalog'
    const campoNome = tipo === 'tuss' ? 'procedure_name' : 'description'
    // Vírgula e parêntese são separadores na sintaxe do filtro — precisam sair
    // do termo, ou a consulta volta erro em vez de resultado.
    const limpo = q.replace(/[,()*%]/g, ' ').replace(/\s+/g, ' ').trim()
    const porCodigo = limpo.replace(/[.\s]/g, '').toUpperCase()
    if (!limpo) { setBuscando(false); return }

    const { data, error } = await supabase
      .from(tabela)
      .select(`code, ${campoNome}`)
      .or(`code.ilike.${porCodigo}%,${campoNome}.ilike.%${limpo}%`)
      .eq('is_active', true)
      .limit(10)

    setBuscando(false)
    if (error) {
      // Catálogo ainda não importado: a tela segue funcionando na digitação.
      setSemCatalogo(true); setSugestoes([]); return
    }
    setSemCatalogo(false)
    setSugestoes((data ?? []).map((r: any) => ({
      codigo: tipo === 'cid' ? formatarCid(r.code) : r.code,
      descricao: r[campoNome],
    })))
  }

  function escolher(s: Sugestao) {
    onEscolher(s.codigo, s.descricao)
    setTermo(''); setSugestoes([]); setAberto(false)
  }

  return (
    <div ref={caixa} className="relative flex-1 min-w-0">
      <div className="flex gap-1.5">
        <input
          value={codigo}
          onChange={e => { onCodigo(e.target.value); setTermo(e.target.value); setAberto(true) }}
          onFocus={() => setAberto(true)}
          placeholder={tipo === 'tuss' ? '31002390' : 'E66.0'}
          className="w-28 shrink-0 px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        <input
          value={descricao ?? ''}
          onChange={e => { onDescricao(e.target.value); setTermo(e.target.value); setAberto(true) }}
          onFocus={() => setAberto(true)}
          placeholder={tipo === 'tuss' ? 'busque pelo nome do procedimento...' : 'busque pelo diagnóstico...'}
          className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"/>
      </div>

      {aberto && termo.trim().length >= 3 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {buscando ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-400">
              <Loader2 size={13} className="animate-spin"/> Buscando no catálogo...
            </div>
          ) : semCatalogo ? (
            <p className="px-3 py-2.5 text-xs text-slate-400">
              Catálogo oficial ainda não importado. Você pode digitar o código à mão normalmente.
            </p>
          ) : sugestoes.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-slate-400">Nada encontrado. Confira a grafia ou digite à mão.</p>
          ) : (
            sugestoes.map(s => (
              <button key={s.codigo} type="button" onClick={() => escolher(s)}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-bold text-brand-600 shrink-0 w-20">{s.codigo}</span>
                  <span className="text-xs text-slate-600 leading-snug">{s.descricao}</span>
                  {codigo === s.codigo && <Check size={13} className="text-emerald-500 shrink-0"/>}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
