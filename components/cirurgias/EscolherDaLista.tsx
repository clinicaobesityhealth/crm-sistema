'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Search, Plus, Trash2, Loader2, Check, X } from 'lucide-react'
import { semAcento } from '@/lib/texto'

// Uma lista em que dá para digitar, cadastrar e apagar — sem sair da tela.
//
// Serve para hospital e para qualquer outra lista simples. A diferença para um
// seletor comum aparece quando a lista cresce: com 30 hospitais, rolar uma
// caixa de seleção é pior do que digitar três letras.

type Item = { id: string; nome: string }

export default function EscolherDaLista({
  valor, nome, tabela, rotulo, camposExtras, onEscolher, className,
}: {
  valor: string | null
  nome: string
  tabela: string
  rotulo: string
  camposExtras?: Record<string, any>
  onEscolher: (id: string | null, nome: string) => void
  className?: string
}) {
  const [itens, setItens] = useState<Item[]>([])
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  const carregar = async () => {
    const { data } = await supabase.from(tabela).select('id, nome').eq('ativo', true).order('ordem').order('nome')
    setItens((data ?? []) as Item[])
  }
  useEffect(() => { carregar() /* eslint-disable-next-line */ }, [tabela])

  const q = semAcento(busca)
  const filtrados = q ? itens.filter(i => semAcento(i.nome).includes(q)) : itens
  const existeIgual = itens.some(i => semAcento(i.nome) === q)

  async function criar() {
    const nomeNovo = busca.trim()
    if (!nomeNovo) return
    setOcupado(true)
    const { data, error } = await supabase.from(tabela)
      .insert({ nome: nomeNovo, ordem: itens.length + 1, ...(camposExtras || {}) })
      .select('id, nome').single()
    setOcupado(false)
    if (error || !data) { alert('Não foi possível cadastrar: ' + (error?.message || '')); return }
    await carregar()
    onEscolher(data.id, data.nome)
    setBusca(''); setAberto(false)
  }

  async function excluir(item: Item, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Apagar "${item.nome}" da lista?\n\nAs cirurgias que já usaram este nome continuam com ele registrado.`)) return
    setOcupado(true)
    const { error } = await supabase.from(tabela).delete().eq('id', item.id)
    setOcupado(false)
    if (error) {
      // Apagar algo em uso costuma esbarrar na integridade do banco. Desativar
      // resolve o mesmo problema sem quebrar o que já aponta para ele.
      if (confirm('Este item está em uso e não pode ser apagado. Quer apenas tirá-lo da lista de escolhas?')) {
        await supabase.from(tabela).update({ ativo: false }).eq('id', item.id)
        await carregar()
      }
      return
    }
    await carregar()
    if (valor === item.id) onEscolher(null, '')
  }

  if (valor) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
        <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{nome}</span>
        <button type="button" onClick={() => { onEscolher(null, ''); setBusca(''); setAberto(true) }}
          className="p-1 text-slate-400 hover:text-slate-700 shrink-0"><X size={15}/></button>
      </div>
    )
  }

  return (
    <div ref={caixa} className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300"/>
      <input value={busca} onChange={e => { setBusca(e.target.value); setAberto(true) }}
        onFocus={() => setAberto(true)}
        placeholder={`Digite para buscar ou cadastrar ${rotulo}...`}
        className={(className || '') + ' pl-9'}/>

      {aberto && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtrados.map(i => (
            <div key={i.id}
              onClick={() => { onEscolher(i.id, i.nome); setBusca(''); setAberto(false) }}
              className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 border-b border-slate-50 cursor-pointer">
              <span className="flex-1 text-sm text-slate-700 truncate">{i.nome}</span>
              <button type="button" onClick={e => excluir(i, e)} disabled={ocupado}
                title="Apagar da lista" className="p-1 text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={13}/></button>
            </div>
          ))}

          {busca.trim() && !existeIgual && (
            <button type="button" onClick={criar} disabled={ocupado}
              className="w-full text-left px-3 py-2 hover:bg-emerald-50 flex items-center gap-2">
              {ocupado ? <Loader2 size={13} className="animate-spin text-emerald-600"/> : <Plus size={13} className="text-emerald-600"/>}
              <span className="text-xs text-emerald-700">
                Cadastrar <strong>{busca.trim()}</strong> e usar
              </span>
            </button>
          )}

          {filtrados.length === 0 && !busca.trim() && (
            <p className="px-3 py-2.5 text-xs text-slate-400">Lista vazia. Digite um nome para cadastrar.</p>
          )}
        </div>
      )}
    </div>
  )
}
