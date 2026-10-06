'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, Check, X, Pencil, Loader2, GripVertical } from 'lucide-react'

// Lista de cadastro simples: nome + ativo + ordem.
// Usada por Hospitais, Modalidades e Formas de pagamento — três telas que só
// diferem no nome da tabela, e que não valia a pena escrever três vezes.

type Item = { id: string; nome: string; ativo: boolean; ordem: number; [k: string]: any }

// Campo numérico opcional ao lado do nome — usado pela modalidade, que carrega
// o percentual da prévia de reembolso. Sem isso, os 30% ficariam escritos
// dentro do programa e mudá-los exigiria um deploy.
type CampoNumerico = { nome: string; label: string; sufixo?: string; dica?: string }

export default function ListaSimples({
  tabela, titulo, descricao, placeholder, campoNumerico,
}: { tabela: string; titulo: string; descricao: string; placeholder: string; campoNumerico?: CampoNumerico }) {
  const [itens, setItens] = useState<Item[]>([])
  const [carregando, setCarregando] = useState(true)
  const [novo, setNovo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')
  const [editNumero, setEditNumero] = useState('')

  useEffect(() => { carregar() /* eslint-disable-next-line */ }, [tabela])

  async function carregar() {
    setCarregando(true)
    const { data } = await supabase.from(tabela).select('*').order('ordem').order('nome')
    setItens((data ?? []) as Item[])
    setCarregando(false)
  }

  async function criar() {
    const nome = novo.trim()
    if (!nome) return
    setSalvando(true)
    const ordem = (itens[itens.length - 1]?.ordem ?? 0) + 1
    const { error } = await supabase.from(tabela).insert({ nome, ordem })
    setSalvando(false)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    setNovo('')
    carregar()
  }

  async function salvarEdicao(id: string) {
    const nome = editNome.trim()
    if (!nome) return
    const payload: any = { nome }
    if (campoNumerico) payload[campoNumerico.nome] = Number(editNumero) || 0
    const { error } = await supabase.from(tabela).update(payload).eq('id', id)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    setEditId(null); setEditNome('')
    carregar()
  }

  // Desativar, não apagar: cirurgias antigas apontam para estes nomes, e apagar
  // deixaria registro histórico sem referência.
  async function alternarAtivo(item: Item) {
    await supabase.from(tabela).update({ ativo: !item.ativo }).eq('id', item.id)
    carregar()
  }

  async function excluir(item: Item) {
    if (!confirm(`Excluir "${item.nome}" definitivamente?\n\nSe ele já foi usado em alguma cirurgia, prefira desativar.`)) return
    const { error } = await supabase.from(tabela).delete().eq('id', item.id)
    if (error) { alert('Não foi possível excluir: ' + error.message); return }
    carregar()
  }

  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold text-slate-700">{titulo}</p>
      <p className="text-xs text-slate-400 mt-0.5 mb-4">{descricao}{campoNumerico?.dica ? ' · ' + campoNumerico.dica : ''}</p>

      <div className="flex gap-2 mb-4">
        <input value={novo} onChange={e => setNovo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && criar()}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        <button onClick={criar} disabled={salvando || !novo.trim()}
          className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5">
          {salvando ? <Loader2 size={15} className="animate-spin"/> : <Plus size={15}/>} Adicionar
        </button>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-6"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
      ) : itens.length === 0 ? (
        <p className="text-sm text-slate-400 py-6">Nenhum item cadastrado ainda.</p>
      ) : (
        <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
          {itens.map(item => (
            <div key={item.id} className="flex items-center gap-2 px-3 py-2.5">
              <GripVertical size={14} className="text-slate-200 shrink-0"/>
              {editId === item.id ? (
                <>
                  <input autoFocus value={editNome} onChange={e => setEditNome(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') salvarEdicao(item.id); if (e.key === 'Escape') setEditId(null) }}
                    className="flex-1 min-w-0 px-2 py-1 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                  {campoNumerico && (
                    <input type="number" step="0.01" value={editNumero} onChange={e => setEditNumero(e.target.value)}
                      title={campoNumerico.label}
                      className="w-20 shrink-0 px-2 py-1 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                  )}
                  <button onClick={() => salvarEdicao(item.id)} className="p-1.5 text-emerald-600"><Check size={15}/></button>
                  <button onClick={() => setEditId(null)} className="p-1.5 text-slate-400"><X size={15}/></button>
                </>
              ) : (
                <>
                  <span className={'flex-1 text-sm ' + (item.ativo ? 'text-slate-700' : 'text-slate-300 line-through')}>{item.nome}</span>
                  {campoNumerico && Number(item[campoNumerico.nome]) > 0 && (
                    <span className="text-[11px] text-slate-400 shrink-0" title={campoNumerico.label}>
                      {campoNumerico.label} {item[campoNumerico.nome]}{campoNumerico.sufixo ?? ''}
                    </span>
                  )}
                  <button onClick={() => alternarAtivo(item)}
                    className={'text-[11px] px-2 py-0.5 rounded-full font-semibold ' + (item.ativo ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
                    {item.ativo ? 'ativo' : 'inativo'}
                  </button>
                  <button onClick={() => { setEditId(item.id); setEditNome(item.nome); setEditNumero(String(item[campoNumerico?.nome ?? ''] ?? '')) }} className="p-1.5 text-slate-300 hover:text-slate-600"><Pencil size={14}/></button>
                  <button onClick={() => excluir(item)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 size={14}/></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
