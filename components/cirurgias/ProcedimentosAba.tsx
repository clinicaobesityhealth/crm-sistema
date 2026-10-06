'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ListasDeMateriais from './ListasDeMateriais'
import { Plus, Trash2, Loader2, Search, X, Save, Scissors } from 'lucide-react'
import BuscaCodigo from './BuscaCodigo'
import BuscaNomeTuss from './BuscaNomeTuss'
import { useVias } from '@/lib/viasCirurgia'

// Cadastro de procedimentos cirúrgicos.
//
// A abreviação (BP, Sleeve, HIB...) é a chave de trabalho da equipe: é por ela
// que a cirurgia é escolhida na hora do lançamento. O nome completo é o que sai
// na carta e na guia.
//
// TUSS e CID ficam em linhas próprias, e não dentro do nome, porque uma mesma
// cirurgia pode ter mais de um código — hemorroidas tem três — e porque a guia
// do convênio pede o número isolado.

type Codigo = { id?: string; codigo: string; descricao: string; ordem: number }
type Procedimento = {
  id: string
  sigla: string
  nome: string
  valor_equipe: number
  valor_anestesista: number
  via_padrao: string | null
  materiais: string | null
  orientacoes: string | null
  empresas: string | null
  ativo: boolean
  ordem: number
  tuss: Codigo[]
  cid: Codigo[]
}

const VAZIO: Procedimento = {
  id: '', sigla: '', nome: '', valor_equipe: 0, valor_anestesista: 0, via_padrao: '',
  materiais: '', orientacoes: '', empresas: '', ativo: true, ordem: 999, tuss: [], cid: [],
}

const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function ProcedimentosAba() {
  const [lista, setLista] = useState<Procedimento[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<Procedimento | null>(null)

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setCarregando(true)
    const { data, error } = await supabase
      .from('cirurgia_procedimentos')
      .select('*, tuss:cirurgia_proc_tuss(*), cid:cirurgia_proc_cid(*)')
      .order('ordem')
    if (error) { alert('Não foi possível carregar: ' + error.message); setCarregando(false); return }
    const norm = (data ?? []).map((p: any) => ({
      ...p,
      tuss: (p.tuss ?? []).slice().sort((a: Codigo, b: Codigo) => a.ordem - b.ordem),
      cid: (p.cid ?? []).slice().sort((a: Codigo, b: Codigo) => a.ordem - b.ordem),
    })) as Procedimento[]
    setLista(norm)
    setCarregando(false)
  }

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return lista
    return lista.filter(p =>
      p.sigla.toLowerCase().includes(q) ||
      p.nome.toLowerCase().includes(q) ||
      p.tuss.some(t => t.codigo.includes(q)) ||
      p.cid.some(c => c.codigo.toLowerCase().includes(q)))
  }, [lista, busca])

  async function excluir(p: Procedimento) {
    if (!confirm(`Excluir "${p.sigla} — ${p.nome}"?\n\nSe ele já foi usado em alguma cirurgia, prefira desativar.`)) return
    const { error } = await supabase.from('cirurgia_procedimentos').delete().eq('id', p.id)
    if (error) { alert('Não foi possível excluir: ' + error.message); return }
    carregar()
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300"/>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por abreviação, nome, TUSS ou CID..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <button onClick={() => setAberto({ ...VAZIO })}
          className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold flex items-center justify-center gap-1.5">
          <Plus size={15}/> Nova cirurgia
        </button>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
      ) : filtrada.length === 0 ? (
        <p className="text-sm text-slate-400 py-8">Nenhuma cirurgia encontrada.</p>
      ) : (
        <div className="space-y-2">
          {filtrada.map(p => (
            <div key={p.id} className="bg-white border border-slate-100 rounded-xl px-4 py-3">
              <div className="flex items-start gap-3">
                <button onClick={() => setAberto(p)} className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-md bg-brand-50 text-brand-600 text-xs font-bold">{p.sigla}</span>
                    {!p.ativo && <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 font-semibold">inativo</span>}
                  </div>
                  <p className="text-sm font-medium text-slate-700 mt-1">{p.nome}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {p.tuss.map(t => 'TUSS ' + t.codigo).join(' · ') || 'sem TUSS'}
                    {p.cid.length > 0 && '  |  ' + p.cid.map(c => c.codigo).join(' · ')}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Equipe {brl(p.valor_equipe)}
                    {p.valor_anestesista > 0 && ` · Anestesista ${brl(p.valor_anestesista)}`}
                  </p>
                </button>
                <button onClick={() => excluir(p)} className="p-1.5 text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={14}/></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {aberto && <EditorProcedimento proc={aberto} onFechar={() => setAberto(null)} onSalvo={() => { setAberto(null); carregar() }}/>}
    </div>
  )
}

function EditorProcedimento({ proc, onFechar, onSalvo }: { proc: Procedimento; onFechar: () => void; onSalvo: () => void }) {
  const vias = useVias()
  const [f, setF] = useState<Procedimento>({ ...proc })
  const [salvando, setSalvando] = useState(false)
  const novo = !proc.id
  const set = (campo: keyof Procedimento, valor: any) => setF(a => ({ ...a, [campo]: valor }))

  function setCod(tipo: 'tuss' | 'cid', i: number, campo: 'codigo' | 'descricao', valor: string) {
    setF(a => {
      const arr = a[tipo].slice()
      arr[i] = { ...arr[i], [campo]: valor }
      return { ...a, [tipo]: arr }
    })
  }
  const addCod = (tipo: 'tuss' | 'cid') =>
    setF(a => ({ ...a, [tipo]: [...a[tipo], { codigo: '', descricao: '', ordem: a[tipo].length + 1 }] }))
  const remCod = (tipo: 'tuss' | 'cid', i: number) =>
    setF(a => ({ ...a, [tipo]: a[tipo].filter((_, j) => j !== i) }))

  async function salvar() {
    if (!f.sigla.trim()) { alert('A abreviação é obrigatória — é por ela que a secretária encontra a cirurgia.'); return }
    if (!f.nome.trim()) { alert('O nome completo é obrigatório: é ele que sai na carta e na guia.'); return }
    setSalvando(true)

    const dados = {
      sigla: f.sigla.trim(),
      nome: f.nome.trim(),
      valor_equipe: Number(f.valor_equipe) || 0,
      valor_anestesista: Number(f.valor_anestesista) || 0,
      via_padrao: f.via_padrao?.trim() || null,
      materiais: f.materiais?.trim() || null,
      orientacoes: f.orientacoes?.trim() || null,
      empresas: f.empresas?.trim() || null,
      ativo: f.ativo,
      ordem: f.ordem ?? 999,
      updated_at: new Date().toISOString(),
    }

    let id = f.id
    if (novo) {
      const { data, error } = await supabase.from('cirurgia_procedimentos').insert(dados).select('id').single()
      if (error || !data) { setSalvando(false); alert('Não foi possível salvar: ' + (error?.message || '')); return }
      id = data.id
    } else {
      const { error } = await supabase.from('cirurgia_procedimentos').update(dados).eq('id', id)
      if (error) { setSalvando(false); alert('Não foi possível salvar: ' + error.message); return }
    }

    // Os códigos são regravados por inteiro. São poucas linhas por cirurgia, e
    // assim uma linha removida na tela some de verdade do banco — sem depender
    // de comparar o que mudou.
    for (const [tipo, tabela] of [['tuss', 'cirurgia_proc_tuss'], ['cid', 'cirurgia_proc_cid']] as const) {
      await supabase.from(tabela).delete().eq('procedimento_id', id)
      const linhas = f[tipo]
        .map((c, i) => ({ procedimento_id: id, codigo: c.codigo.trim(), descricao: c.descricao?.trim() || null, ordem: i + 1 }))
        .filter(c => c.codigo)
      if (linhas.length > 0) {
        const { error } = await supabase.from(tabela).insert(linhas)
        if (error) { setSalvando(false); alert('A cirurgia foi salva, mas os códigos falharam: ' + error.message); return }
      }
    }

    setSalvando(false)
    onSalvo()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFechar}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Scissors size={16} className="text-brand-500"/>
            <h2 className="text-sm font-semibold text-slate-800">{novo ? 'Nova cirurgia' : 'Editar cirurgia'}</h2>
          </div>
          <button onClick={onFechar} className="p-1 text-slate-400"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Campo label="Abreviação" dica="Como a equipe chama">
              <input value={f.sigla} onChange={e => set('sigla', e.target.value)} placeholder="BP"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </Campo>
            <div className="sm:col-span-2">
              {/* v48.25 — Digitar três letras procura na tabela TUSS. Escolher
                  de lá traz o nome oficial e acrescenta o código na lista
                  abaixo, que é onde o convênio confere. */}
              <Campo label="Nome completo" dica="Busca na tabela TUSS — sai na carta e na guia">
                <BuscaNomeTuss
                  valor={f.nome}
                  onTexto={v => set('nome', v)}
                  onEscolher={(nome, codigo) => {
                    set('nome', nome)
                    setF(a => a.tuss.some(t => t.codigo === codigo)
                      ? { ...a, nome }
                      : { ...a, nome, tuss: [...a.tuss, { codigo, descricao: nome, ordem: a.tuss.length + 1 }] })
                  }}
                  placeholder="Gastroplastia por Videolaparoscopia (Sleeve)"/>
              </Campo>
            </div>
          </div>

          <Campo label="Via de acesso" dica="Preenche sozinha o lançamento desta cirurgia">
            <select value={f.via_padrao ?? ''} onChange={e => set('via_padrao', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">—</option>
              {vias.map(v => <option key={v.id} value={v.nome}>{v.nome}</option>)}
            </select>
          </Campo>

          <ListaCodigos tipo="tuss" titulo="Códigos TUSS"
            dica="Busque pelo nome do procedimento — o código vem conferido da tabela da ANS"
            itens={f.tuss} onAdd={() => addCod('tuss')} onRem={i => remCod('tuss', i)}
            onSet={(i, campo, v) => setCod('tuss', i, campo, v)}/>

          <ListaCodigos tipo="cid" titulo="CID / diagnóstico"
            dica="Busque pelo diagnóstico — o código vem conferido da CID-10 do DATASUS"
            itens={f.cid} onAdd={() => addCod('cid')} onRem={i => remCod('cid', i)}
            onSet={(i, campo, v) => setCod('cid', i, campo, v)}/>

          <div className="grid grid-cols-2 gap-3">
            <Campo label="Valor da equipe">
              <input type="number" step="0.01" value={f.valor_equipe} onChange={e => set('valor_equipe', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </Campo>
            <Campo label="Valor do anestesista">
              <input type="number" step="0.01" value={f.valor_anestesista} onChange={e => set('valor_anestesista', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </Campo>
          </div>

          {/* v48.73 — Os materiais deixaram de ser um texto só.
              Uma cirurgia tem mais de um padrão (tela A ou tela B, vídeo ou
              robótica) e quem escolhe é o cirurgião no dia. As listas ficam
              cadastradas aqui, e a secretária escolhe na hora da solicitação.
              O que estava no campo antigo virou a lista "Padrão" na migração. */}
          {f.id ? (
            <div className="bg-slate-50 rounded-xl p-3">
              <ListasDeMateriais procedimentoId={f.id}/>
            </div>
          ) : (
            <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2.5">
              Salve a cirurgia para cadastrar as listas de materiais dela.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Ordem na lista">
              <input type="number" value={f.ordem} onChange={e => set('ordem', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </Campo>
          </div>

          <Campo label="Orientações" dica="Texto livre, aparece para a equipe no lançamento">
            <textarea value={f.orientacoes ?? ''} onChange={e => set('orientacoes', e.target.value)} rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </Campo>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={f.ativo} onChange={e => set('ativo', e.target.checked)} className="rounded"/>
            Disponível para novos lançamentos
          </label>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
          <button onClick={onFechar} className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600">Cancelar</button>
          <button onClick={salvar} disabled={salvando}
            className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {salvando ? <><Loader2 size={15} className="animate-spin"/> Salvando...</> : <><Save size={15}/> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      {children}
      {dica && <p className="text-[11px] text-slate-400 mt-1">{dica}</p>}
    </div>
  )
}

function ListaCodigos({ tipo, titulo, dica, itens, onAdd, onRem, onSet }: {
  tipo: 'tuss' | 'cid'; titulo: string; dica: string; itens: Codigo[]
  onAdd: () => void; onRem: (i: number) => void
  onSet: (i: number, campo: 'codigo' | 'descricao', v: string) => void
}) {
  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-slate-600">{titulo}</p>
        <button onClick={onAdd} className="text-xs font-semibold text-brand-600 flex items-center gap-1"><Plus size={13}/> Adicionar</button>
      </div>
      <p className="text-[11px] text-slate-400 mb-2">{dica}</p>
      {itens.length === 0 ? (
        <p className="text-[11px] text-slate-400">Nenhum código. Uma cirurgia pode ter mais de um.</p>
      ) : (
        <div className="space-y-1.5">
          {itens.map((c, i) => (
            <div key={i} className="flex gap-1.5 items-start">
              <BuscaCodigo
                tipo={tipo}
                codigo={c.codigo}
                descricao={c.descricao ?? ''}
                onCodigo={v => onSet(i, 'codigo', v)}
                onDescricao={v => onSet(i, 'descricao', v)}
                onEscolher={(cod, desc) => { onSet(i, 'codigo', cod); onSet(i, 'descricao', desc) }}/>
              <button onClick={() => onRem(i)} className="p-1.5 text-slate-300 hover:text-red-500 mt-0.5"><Trash2 size={14}/></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
