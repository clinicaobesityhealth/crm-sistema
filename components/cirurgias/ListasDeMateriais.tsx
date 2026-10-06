'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Check, Loader2, Plus, Star, Trash2 } from 'lucide-react'

// v48.73 — Os padrões de material de uma cirurgia.
//
// A mesma cirurgia costuma ter mais de um: com tela Parietex ou com tela Bard,
// por vídeo ou robótica. Antes era um campo só, e trocar de padrão significava
// apagar a lista e redigitar — o que foi apagado não voltava, e a secretária
// acabava mantendo um único jeito de fazer no cadastro e corrigindo na mão a
// cada solicitação.
//
// As empresas ficam JUNTO da lista porque a empresa é de quem é o material:
// trocar a tela troca o fornecedor.

type Lista = {
  id: string; procedimento_id: string; nome: string; itens: string
  empresas: string | null; padrao: boolean; ativo: boolean; ordem: number
}

export default function ListasDeMateriais({ procedimentoId }: { procedimentoId: string }) {
  const [listas, setListas] = useState<Lista[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)
  const [salvo, setSalvo] = useState<string | null>(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.from('cirurgia_material_listas')
      .select('*').eq('procedimento_id', procedimentoId).order('ordem')
    if (error) setErro(error.message + (/material_listas/.test(error.message) ? ' — falta rodar a migração 20260923_materiais_e_solicitacao_v48_73.sql.' : ''))
    else setErro('')
    setListas((data ?? []) as Lista[])
    setCarregando(false)
  }, [procedimentoId])

  useEffect(() => { carregar() }, [carregar])

  const alterar = (id: string, campo: keyof Lista, valor: any) => {
    setListas(ls => ls.map(l => l.id === id ? { ...l, [campo]: valor } : l))
    setSalvo(null)
  }

  async function salvar(l: Lista) {
    setSalvandoId(l.id); setErro('')
    const { error } = await supabase.from('cirurgia_material_listas').update({
      nome: l.nome.trim() || 'Sem nome', itens: l.itens, empresas: l.empresas?.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', l.id)
    setSalvandoId(null)
    if (error) { setErro('Não foi possível salvar: ' + error.message); return }
    setSalvo(l.id)
    setTimeout(() => setSalvo(s => s === l.id ? null : s), 2500)
  }

  async function nova() {
    const { error } = await supabase.from('cirurgia_material_listas').insert({
      procedimento_id: procedimentoId, nome: 'Novo padrão', itens: '',
      padrao: listas.length === 0, ordem: listas.length,
    })
    if (error) { setErro('Não foi possível criar: ' + error.message); return }
    carregar()
  }

  // Só uma lista é a padrão: marcar uma desmarca a anterior, senão a
  // solicitação não saberia qual trazer já escolhida.
  async function marcarPadrao(l: Lista) {
    await supabase.from('cirurgia_material_listas').update({ padrao: false }).eq('procedimento_id', procedimentoId)
    await supabase.from('cirurgia_material_listas').update({ padrao: true }).eq('id', l.id)
    carregar()
  }

  async function apagar(l: Lista) {
    if (!window.confirm(`Apagar a lista "${l.nome}"?`)) return
    await supabase.from('cirurgia_material_listas').delete().eq('id', l.id)
    carregar()
  }

  const campo = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-700">Listas de materiais</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Os padrões desta cirurgia. Na solicitação, a secretária escolhe qual usar.
          </p>
        </div>
        <button type="button" onClick={nova}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:border-slate-300">
          <Plus size={13}/> Nova lista
        </button>
      </div>

      {erro && <p className="text-xs text-red-600">{erro}</p>}

      {carregando ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-4"><Loader2 size={14} className="animate-spin"/> Carregando...</div>
      ) : listas.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">
          Nenhuma lista cadastrada. Crie a primeira — ela já entra como padrão.
        </p>
      ) : listas.map(l => (
        <div key={l.id} className="bg-white border border-slate-100 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input value={l.nome} onChange={e => alterar(l.id, 'nome', e.target.value)}
              className="flex-1 min-w-0 text-sm font-semibold text-slate-700 bg-transparent focus:outline-none"/>
            <button type="button" onClick={() => marcarPadrao(l)} title={l.padrao ? 'É a lista padrão' : 'Tornar padrão'}
              className={'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 '
                + (l.padrao ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400 hover:bg-slate-200')}>
              <Star size={11}/>{l.padrao ? 'padrão' : 'tornar padrão'}
            </button>
            <button type="button" onClick={() => apagar(l)} className="p-1.5 text-slate-300 hover:text-red-600 shrink-0">
              <Trash2 size={13}/>
            </button>
          </div>

          <textarea value={l.itens} onChange={e => alterar(l.id, 'itens', e.target.value)} rows={6}
            placeholder={'* 1 UNIDADE - AGULHA DE VERES\n* 1 UNIDADE - TROCARTE 12/5MM DESCARTÁVEL'}
            className={campo + ' font-mono text-xs'}/>

          <input value={l.empresas ?? ''} onChange={e => alterar(l.id, 'empresas', e.target.value)}
            placeholder="Empresas: Medtronic, Ethicon, Bard" className={campo}/>

          <button type="button" onClick={() => salvar(l)} disabled={salvandoId === l.id}
            className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5">
            {salvandoId === l.id ? <Loader2 size={13} className="animate-spin"/> : salvo === l.id ? <Check size={13}/> : null}
            {salvo === l.id ? 'Salvo' : 'Salvar lista'}
          </button>
        </div>
      ))}
    </div>
  )
}
