'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, Loader2, Check, X, Pencil, Bell, Palette } from 'lucide-react'

// Situações da cirurgia — a coluna SITUAÇÃO da planilha.
//
// Duas coisas aqui não existem na planilha e resolvem problemas dela:
//
//   categoria: hoje "realizada" e "cancelada" viram ABAS separadas na planilha,
//     e a linha é movida de lugar. No CRM a cirurgia não muda de lugar: muda de
//     categoria, e a lista filtra. Nada se perde no caminho.
//
//   dispara_mensagens: marca qual situação aciona o pré e o pós-operatório.
//     No script da planilha isso está escrito dentro do código (AUTORIZADA).
//     Aqui é uma caixinha — se um dia mudar, ninguém precisa mexer em programa.

type Status = {
  id: string; nome: string; categoria: string; cor: string
  dispara_mensagens: boolean; ativo: boolean; ordem: number
}

const CATEGORIAS = [
  { valor: 'aberta', label: 'Em andamento' },
  { valor: 'realizada', label: 'Realizada' },
  { valor: 'cancelada', label: 'Cancelada' },
]
// Paleta de cores da situação: começa pelas cores já usadas nas situações
// pré-cadastradas (ver seed em supabase/migrations/20260914_cadastros_cirurgia_v48_01.sql)
// e completa com outros tons comuns, para dar opções sem precisar digitar código.
const CORES = [
  '#64748b', '#94a3b8', '#0ea5e9', '#10b981', '#059669', '#84cc16', '#f59e0b',
  '#f97316', '#ef4444', '#dc2626', '#8b5cf6',
  '#06b6d4', '#14b8a6', '#22c55e', '#eab308', '#3b82f6', '#6366f1', '#d946ef', '#ec4899', '#f43f5e',
]

export default function SituacoesAba() {
  const [lista, setLista] = useState<Status[]>([])
  const [carregando, setCarregando] = useState(true)
  const [novo, setNovo] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Partial<Status>>({})

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setCarregando(true)
    const { data } = await supabase.from('cirurgia_status').select('*').order('ordem')
    setLista((data ?? []) as Status[])
    setCarregando(false)
  }

  async function criar() {
    const nome = novo.trim()
    if (!nome) return
    const ordem = (lista[lista.length - 1]?.ordem ?? 0) + 1
    const { error } = await supabase.from('cirurgia_status').insert({ nome, ordem })
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    setNovo(''); carregar()
  }

  async function salvar(id: string) {
    const nome = (rascunho.nome ?? '').trim()
    if (!nome) return
    const { error } = await supabase.from('cirurgia_status')
      .update({ nome, categoria: rascunho.categoria, cor: rascunho.cor }).eq('id', id)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    setEditId(null); carregar()
  }

  // Só uma situação dispara as mensagens. Marcar uma desmarca a anterior — do
  // contrário o paciente receberia o pré-operatório duas vezes.
  async function marcarDisparo(s: Status) {
    if (s.dispara_mensagens) {
      await supabase.from('cirurgia_status').update({ dispara_mensagens: false }).eq('id', s.id)
    } else {
      await supabase.from('cirurgia_status').update({ dispara_mensagens: false }).eq('dispara_mensagens', true)
      await supabase.from('cirurgia_status').update({ dispara_mensagens: true }).eq('id', s.id)
    }
    carregar()
  }

  async function alternarAtivo(s: Status) {
    await supabase.from('cirurgia_status').update({ ativo: !s.ativo }).eq('id', s.id)
    carregar()
  }

  async function excluir(s: Status) {
    if (!confirm(`Excluir a situação "${s.nome}"?\n\nSe alguma cirurgia já está nela, prefira desativar.`)) return
    const { error } = await supabase.from('cirurgia_status').delete().eq('id', s.id)
    if (error) { alert('Não foi possível excluir: ' + error.message); return }
    carregar()
  }

  const input = 'px-2 py-1 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold text-slate-700">Situações da cirurgia</p>
      <p className="text-xs text-slate-400 mt-0.5 mb-4">
        A situação marcada com o sino é a que dispara as mensagens de pré e pós-operatório.
      </p>

      <div className="flex gap-2 mb-4">
        <input value={novo} onChange={e => setNovo(e.target.value)} onKeyDown={e => e.key === 'Enter' && criar()}
          placeholder="Nova situação..."
          className="flex-1 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        <button onClick={criar} disabled={!novo.trim()}
          className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5">
          <Plus size={15}/> Adicionar
        </button>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
          {lista.map(s => (
            <div key={s.id} className="px-3 py-2.5">
              {editId === s.id ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input autoFocus value={rascunho.nome ?? ''} onChange={e => setRascunho(r => ({ ...r, nome: e.target.value }))}
                      className={input + ' flex-1 min-w-[140px]'}/>
                    <select value={rascunho.categoria} onChange={e => setRascunho(r => ({ ...r, categoria: e.target.value }))} className={input}>
                      {CATEGORIAS.map(c => <option key={c.valor} value={c.valor}>{c.label}</option>)}
                    </select>
                    <button onClick={() => salvar(s.id)} className="p-1.5 text-emerald-600"><Check size={15}/></button>
                    <button onClick={() => setEditId(null)} className="p-1.5 text-slate-400"><X size={15}/></button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-0.5">
                    {CORES.map(c => (
                      <button key={c} type="button" title={c} onClick={() => setRascunho(r => ({ ...r, cor: c }))}
                        className={'w-5 h-5 rounded-full border border-black/10 transition ' +
                          (rascunho.cor === c ? 'ring-2 ring-offset-1 ring-brand-500' : 'hover:scale-110')}
                        style={{ background: c }}/>
                    ))}
                    <label title="Cor personalizada"
                      className={'relative w-5 h-5 rounded-full flex items-center justify-center cursor-pointer overflow-hidden ' +
                        (rascunho.cor && !CORES.includes(rascunho.cor)
                          ? 'ring-2 ring-offset-1 ring-brand-500'
                          : 'border border-dashed border-slate-300 text-slate-400')}
                      style={rascunho.cor && !CORES.includes(rascunho.cor) ? { background: rascunho.cor } : {}}>
                      {(!rascunho.cor || CORES.includes(rascunho.cor)) && <Palette size={11}/>}
                      <input type="color" value={rascunho.cor ?? '#64748b'}
                        onChange={e => setRascunho(r => ({ ...r, cor: e.target.value }))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"/>
                    </label>
                    <input value={rascunho.cor ?? ''} onChange={e => setRascunho(r => ({ ...r, cor: e.target.value }))}
                      placeholder="#hex" title="Código da cor (opcional)"
                      className="w-[72px] px-1.5 py-0.5 text-[11px] text-slate-400 border border-slate-100 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"/>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.cor }}/>
                  <span className={'flex-1 text-sm ' + (s.ativo ? 'text-slate-700' : 'text-slate-300 line-through')}>{s.nome}</span>
                  <span className="text-[11px] text-slate-400 hidden sm:inline">
                    {CATEGORIAS.find(c => c.valor === s.categoria)?.label ?? s.categoria}
                  </span>
                  <button onClick={() => marcarDisparo(s)} title="Dispara as mensagens de pré e pós-operatório"
                    className={'p-1.5 ' + (s.dispara_mensagens ? 'text-amber-500' : 'text-slate-200 hover:text-slate-400')}>
                    <Bell size={14} fill={s.dispara_mensagens ? 'currentColor' : 'none'}/>
                  </button>
                  <button onClick={() => alternarAtivo(s)}
                    className={'text-[11px] px-2 py-0.5 rounded-full font-semibold ' + (s.ativo ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
                    {s.ativo ? 'ativo' : 'inativo'}
                  </button>
                  <button onClick={() => { setEditId(s.id); setRascunho({ nome: s.nome, categoria: s.categoria, cor: s.cor }) }}
                    className="p-1.5 text-slate-300 hover:text-slate-600"><Pencil size={14}/></button>
                  <button onClick={() => excluir(s)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 size={14}/></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
