'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import BuscaCodigo, { formatarCid } from './BuscaCodigo'
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'

// v48.74 — Os diagnósticos DESTA cirurgia.
//
// O CID cadastrado no procedimento é o típico da operação; o desta tela é o do
// paciente — a mesma herniorrafia sai com K40.9 num caso e K40.2 no outro, e é
// o do paciente que vai na guia e nas cartas.
//
// Os CID dos procedimentos escolhidos aparecem como sugestão de um clique: na
// maioria das vezes é um deles, e digitar de novo o que já está cadastrado é
// onde nasce o código errado.

type Cid = { id: string; codigo: string | null; descricao: string; ordem: number }

export default function DiagnosticosDaCirurgia({ cirurgiaId, procedimentoIds }: {
  cirurgiaId: string
  procedimentoIds: string[]
}) {
  const [lista, setLista] = useState<Cid[]>([])
  const [sugestoes, setSugestoes] = useState<{ codigo: string; descricao: string }[]>([])
  const [carregando, setCarregando] = useState(true)
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.from('cirurgia_cids')
      .select('id, codigo, descricao, ordem').eq('cirurgia_id', cirurgiaId).order('ordem')
    if (error) setErro(error.message + (/cirurgia_cids/.test(error.message) ? ' — falta rodar a migração 20260923_busca_paciente_v48_74.sql.' : ''))
    else setErro('')
    setLista((data ?? []) as Cid[])
    setCarregando(false)
  }, [cirurgiaId])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!procedimentoIds.length) { setSugestoes([]); return }
    supabase.from('cirurgia_proc_cid').select('codigo, descricao, ordem')
      .in('procedimento_id', procedimentoIds).order('ordem')
      .then(({ data }) => {
        const vistos = new Set<string>()
        setSugestoes((data ?? []).filter((d: any) => {
          const k = (d.codigo || '') + '|' + (d.descricao || '')
          if (vistos.has(k)) return false
          vistos.add(k); return true
        }) as any)
      })
  }, [procedimentoIds.join(',')])

  async function adicionar(cod: string, desc: string) {
    const d = desc.trim()
    if (!d) return
    if (lista.some(x => (x.codigo || '') === cod && x.descricao.toLowerCase() === d.toLowerCase())) return
    const { error } = await supabase.from('cirurgia_cids').insert({
      cirurgia_id: cirurgiaId, codigo: cod.trim() || null, descricao: d, ordem: lista.length,
    })
    if (error) { setErro('Não foi possível adicionar: ' + error.message); return }
    setCodigo(''); setDescricao('')
    carregar()
  }

  async function remover(c: Cid) {
    await supabase.from('cirurgia_cids').delete().eq('id', c.id)
    carregar()
  }

  const jaTem = (cod: string, desc: string) =>
    lista.some(x => (x.codigo || '') === cod && x.descricao.toLowerCase() === desc.toLowerCase())

  return (
    <div className="bg-slate-50 rounded-xl p-3 space-y-3">
      <div>
        <p className="text-xs font-semibold text-slate-600">Diagnósticos (CID)</p>
        <p className="text-[11px] text-slate-400 mt-0.5">Vão nas cartas e na guia. Pode ter mais de um.</p>
      </div>

      {erro && <p className="text-[11px] text-red-600">{erro}</p>}

      {carregando ? (
        <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin"/> Carregando...</div>
      ) : lista.length > 0 && (
        <div className="space-y-1.5">
          {lista.map(c => (
            <div key={c.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
              {c.codigo && <span className="text-[11px] font-mono font-semibold text-slate-500 shrink-0">{c.codigo}</span>}
              <span className="text-xs text-slate-700 flex-1 min-w-0">{c.descricao}</span>
              <button type="button" onClick={() => remover(c)} className="p-1 text-slate-300 hover:text-red-600 shrink-0">
                <Trash2 size={12}/>
              </button>
            </div>
          ))}
        </div>
      )}

      {sugestoes.filter(su => !jaTem(su.codigo || '', su.descricao)).length > 0 && (
        <div>
          <p className="text-[11px] text-slate-400 flex items-center gap-1 mb-1"><Sparkles size={10}/> do cadastro da cirurgia</p>
          <div className="flex flex-wrap gap-1.5">
            {sugestoes.filter(su => !jaTem(su.codigo || '', su.descricao)).map((su, i) => (
              <button key={i} type="button" onClick={() => adicionar(su.codigo || '', su.descricao)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-[11px] text-slate-600 hover:border-brand-300 hover:text-brand-700">
                <Plus size={10}/>{su.codigo ? <span className="font-mono">{su.codigo}</span> : null} {su.descricao}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Busca no catálogo oficial, para quando o diagnóstico não é o típico. */}
      <div className="space-y-1.5">
        <BuscaCodigo tipo="cid" codigo={codigo} descricao={descricao}
          onEscolher={(cod, desc) => adicionar(formatarCid(cod), desc)}
          onCodigo={setCodigo} onDescricao={setDescricao}/>
        {(codigo.trim() || descricao.trim()) && (
          <button type="button" onClick={() => adicionar(codigo ? formatarCid(codigo) : '', descricao)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-semibold">
            <Plus size={12}/> Adicionar diagnóstico
          </button>
        )}
      </div>
    </div>
  )
}
