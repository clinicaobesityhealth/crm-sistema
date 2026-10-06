'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, Loader2, Save, ChevronRight, ChevronDown, Table2 } from 'lucide-react'

// Convênios, planos e a tabela de preços de cada um.
//
// A tabela de preços é a parte que precisa ser rápida de preencher: são dezenas
// de procedimentos por convênio. Por isso ela é uma grade editável, com tudo na
// tela e um salvar só — não um formulário por linha.
//
// Só o que foge à regra precisa ser cadastrado: preço em branco significa
// "use o particular", e preço no convênio vale para todos os planos dele.

type Convenio = { id: string; nome: string; registro_ans: string | null; ativo: boolean; ordem: number }
type Plano = { id: string; convenio_id: string; nome: string; ativo: boolean; ordem: number }
type Proc = { id: string; sigla: string; nome: string; valor_equipe: number; valor_anestesista: number }
type Preco = { procedimento_id: string; plano_id: string | null; valor_equipe: number; valor_anestesista: number }

const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function ConveniosAba() {
  const [convenios, setConvenios] = useState<Convenio[]>([])
  const [planos, setPlanos] = useState<Plano[]>([])
  const [carregando, setCarregando] = useState(true)
  const [novoNome, setNovoNome] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const [precosDe, setPrecosDe] = useState<{ convenio: Convenio; plano: Plano | null } | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [c, p] = await Promise.all([
      supabase.from('cirurgia_convenios').select('*').order('ordem').order('nome'),
      supabase.from('cirurgia_planos').select('*').order('ordem').order('nome'),
    ])
    setConvenios((c.data ?? []) as Convenio[])
    setPlanos((p.data ?? []) as Plano[])
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function criarConvenio() {
    const nome = novoNome.trim()
    if (!nome) return
    const { error } = await supabase.from('cirurgia_convenios')
      .insert({ nome, ordem: convenios.length + 1 })
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    setNovoNome(''); carregar()
  }

  async function excluirConvenio(c: Convenio) {
    if (!confirm(`Excluir o convênio "${c.nome}"?\n\nOs planos e a tabela de preços dele somem junto. As cirurgias já lançadas mantêm o nome registrado.`)) return
    const { error } = await supabase.from('cirurgia_convenios').delete().eq('id', c.id)
    if (error) { alert('Não foi possível excluir: ' + error.message); return }
    carregar()
  }

  async function salvarConvenio(c: Convenio, campos: Partial<Convenio>) {
    const { error } = await supabase.from('cirurgia_convenios').update(campos).eq('id', c.id)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    carregar()
  }

  async function criarPlano(convenioId: string, nome: string) {
    if (!nome.trim()) return
    const { error } = await supabase.from('cirurgia_planos')
      .insert({ convenio_id: convenioId, nome: nome.trim(), ordem: planos.filter(p => p.convenio_id === convenioId).length + 1 })
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    carregar()
  }

  async function excluirPlano(p: Plano) {
    if (!confirm(`Excluir o plano "${p.nome}"?`)) return
    await supabase.from('cirurgia_planos').delete().eq('id', p.id)
    carregar()
  }

  const input = 'px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="max-w-3xl">
      <p className="text-sm font-semibold text-slate-700">Convênios e planos</p>
      <p className="text-xs text-slate-400 mt-0.5 mb-4">
        Cada convênio pode ter a sua tabela de preços. O que não estiver na tabela usa o valor particular.
      </p>

      <div className="flex gap-2 mb-4">
        <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && criarConvenio()}
          placeholder="Nome do convênio..." className={input + ' flex-1'}/>
        <button onClick={criarConvenio} disabled={!novoNome.trim()}
          className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5">
          <Plus size={15}/> Adicionar
        </button>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
      ) : convenios.length === 0 ? (
        <p className="text-sm text-slate-400 py-6">
          Nenhum convênio cadastrado. Enquanto não houver, tudo continua funcionando como particular.
        </p>
      ) : (
        <div className="space-y-2">
          {convenios.map(c => {
            const meusPlanos = planos.filter(p => p.convenio_id === c.id)
            const expandido = aberto === c.id
            return (
              <div key={c.id} className="bg-white border border-slate-100 rounded-xl">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => setAberto(expandido ? null : c.id)} className="text-slate-400 shrink-0">
                    {expandido ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={'text-sm font-semibold truncate ' + (c.ativo ? 'text-slate-700' : 'text-slate-300 line-through')}>{c.nome}</p>
                    <p className="text-[11px] text-slate-400">
                      {meusPlanos.length === 0 ? 'sem planos' : `${meusPlanos.length} plano${meusPlanos.length > 1 ? 's' : ''}`}
                      {c.registro_ans ? ` · ANS ${c.registro_ans}` : ''}
                    </p>
                  </div>
                  <button onClick={() => setPrecosDe({ convenio: c, plano: null })}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 flex items-center gap-1 shrink-0">
                    <Table2 size={13}/> Preços
                  </button>
                  <button onClick={() => salvarConvenio(c, { ativo: !c.ativo })}
                    className={'text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ' + (c.ativo ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
                    {c.ativo ? 'ativo' : 'inativo'}
                  </button>
                  <button onClick={() => excluirConvenio(c)} className="p-1.5 text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={14}/></button>
                </div>

                {expandido && (
                  <div className="border-t border-slate-50 px-3 py-3 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Registro ANS</label>
                      <input defaultValue={c.registro_ans ?? ''} placeholder="número que vai na guia"
                        onBlur={e => e.target.value !== (c.registro_ans ?? '') && salvarConvenio(c, { registro_ans: e.target.value.trim() || null })}
                        className={input + ' w-full'}/>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-1.5">Planos</p>
                      {meusPlanos.length === 0 && (
                        <p className="text-[11px] text-slate-400 mb-2">
                          Sem planos. O preço do convênio vale para todos os pacientes dele.
                        </p>
                      )}
                      <div className="space-y-1 mb-2">
                        {meusPlanos.map(p => (
                          <div key={p.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5">
                            <span className="flex-1 text-sm text-slate-700">{p.nome}</span>
                            <button onClick={() => setPrecosDe({ convenio: c, plano: p })}
                              className="text-[11px] font-semibold text-brand-600">preços deste plano</button>
                            <button onClick={() => excluirPlano(p)} className="p-1 text-slate-300 hover:text-red-500"><Trash2 size={13}/></button>
                          </div>
                        ))}
                      </div>
                      <NovoPlano onCriar={nome => criarPlano(c.id, nome)}/>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {precosDe && (
        <TabelaPrecos convenio={precosDe.convenio} plano={precosDe.plano} onFechar={() => setPrecosDe(null)}/>
      )}
    </div>
  )
}

function NovoPlano({ onCriar }: { onCriar: (nome: string) => void }) {
  const [nome, setNome] = useState('')
  return (
    <div className="flex gap-2">
      <input value={nome} onChange={e => setNome(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { onCriar(nome); setNome('') } }}
        placeholder="Nome do plano..."
        className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
      <button onClick={() => { onCriar(nome); setNome('') }} disabled={!nome.trim()}
        className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-40">
        Adicionar plano
      </button>
    </div>
  )
}

// A grade de preços. Tudo na tela, um salvar só.
function TabelaPrecos({ convenio, plano, onFechar }: { convenio: Convenio; plano: Plano | null; onFechar: () => void }) {
  const [procs, setProcs] = useState<Proc[]>([])
  const [valores, setValores] = useState<Record<string, { equipe: string; anest: string }>>({})
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    (async () => {
      setCarregando(true)
      const [p, pr] = await Promise.all([
        supabase.from('cirurgia_procedimentos').select('id, sigla, nome, valor_equipe, valor_anestesista').eq('ativo', true).order('ordem'),
        supabase.from('cirurgia_precos').select('procedimento_id, plano_id, valor_equipe, valor_anestesista')
          .eq('convenio_id', convenio.id),
      ])
      setProcs((p.data ?? []) as Proc[])
      const mapa: Record<string, { equipe: string; anest: string }> = {}
      for (const x of ((pr.data ?? []) as Preco[])) {
        const mesmo = plano ? x.plano_id === plano.id : !x.plano_id
        if (mesmo) mapa[x.procedimento_id] = { equipe: String(x.valor_equipe), anest: String(x.valor_anestesista) }
      }
      setValores(mapa)
      setCarregando(false)
    })()
  }, [convenio.id, plano])

  function alterar(procId: string, campo: 'equipe' | 'anest', v: string) {
    setValores(a => ({ ...a, [procId]: { equipe: a[procId]?.equipe ?? '', anest: a[procId]?.anest ?? '', [campo]: v } }))
    setSalvo(false)
  }

  async function salvar() {
    setSalvando(true)

    // Linha em branco quer dizer "não tem preço próprio": some da tabela, e o
    // cálculo volta a usar o valor particular. Guardar zero seria diferente —
    // zero é um preço, e um preço de zero cobraria nada do paciente.
    const paraGravar: any[] = []
    for (const p of procs) {
      const v = valores[p.id]
      const eq = Number(String(v?.equipe ?? '').replace(',', '.'))
      const an = Number(String(v?.anest ?? '').replace(',', '.'))
      const vazio = !v || (String(v.equipe).trim() === '' && String(v.anest).trim() === '')
      if (vazio) continue
      paraGravar.push({
        procedimento_id: p.id,
        convenio_id: convenio.id,
        plano_id: plano?.id ?? null,
        valor_equipe: Number.isFinite(eq) ? eq : 0,
        valor_anestesista: Number.isFinite(an) ? an : 0,
        updated_at: new Date().toISOString(),
      })
    }

    // Apaga o escopo inteiro e regrava o que tem valor.
    //
    // Poderia ser um upsert, mas a chave única desta tabela envolve o plano
    // nulo — e "nulo" não se compara com "nulo" em SQL. Apagar e regravar é
    // previsível e não depende de como o banco resolve esse detalhe.
    let del = supabase.from('cirurgia_precos').delete().eq('convenio_id', convenio.id)
    del = plano ? del.eq('plano_id', plano.id) : del.is('plano_id', null)
    const { error: erroDel } = await del
    if (erroDel) {
      setSalvando(false)
      alert('Não foi possível salvar os preços: ' + erroDel.message)
      return
    }

    if (paraGravar.length) {
      const { error } = await supabase.from('cirurgia_precos').insert(paraGravar)
      if (error) {
        setSalvando(false)
        alert('Não foi possível salvar os preços: ' + error.message)
        return
      }
    }

    setSalvando(false); setSalvo(true)
    setTimeout(() => setSalvo(false), 2500)
  }

  const inp = 'w-24 px-2 py-1 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFechar}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-800">
            Preços — {convenio.nome}{plano ? ` · ${plano.nome}` : ''}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {plano
              ? 'Vale só para este plano. Em branco, usa o preço do convênio.'
              : 'Vale para todos os planos deste convênio. Em branco, usa o preço particular.'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {carregando ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-8"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-slate-400 border-b border-slate-100">
                  <th className="pb-2 font-medium">Cirurgia</th>
                  <th className="pb-2 font-medium w-28">Equipe</th>
                  <th className="pb-2 font-medium w-28">Anestesista</th>
                </tr>
              </thead>
              <tbody>
                {procs.map(p => (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="py-1.5 pr-2">
                      <span className="font-semibold text-brand-600 text-xs">{p.sigla}</span>
                      <span className="block text-[11px] text-slate-400 truncate" title={p.nome}>
                        particular: {brl(Number(p.valor_equipe))}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input value={valores[p.id]?.equipe ?? ''} onChange={e => alterar(p.id, 'equipe', e.target.value)}
                        placeholder="—" inputMode="decimal" className={inp}/>
                    </td>
                    <td className="py-1.5">
                      <input value={valores[p.id]?.anest ?? ''} onChange={e => alterar(p.id, 'anest', e.target.value)}
                        placeholder="—" inputMode="decimal" className={inp}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
          <button onClick={onFechar} className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600">Fechar</button>
          <button onClick={salvar} disabled={salvando}
            className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {salvando ? <><Loader2 size={15} className="animate-spin"/> Salvando...</> : <><Save size={15}/> Salvar preços</>}
          </button>
          {salvo && <span className="text-xs text-emerald-600 font-semibold">Salvo!</span>}
        </div>
      </div>
    </div>
  )
}
