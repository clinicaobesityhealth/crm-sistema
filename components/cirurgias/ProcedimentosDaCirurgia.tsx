'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import EscolherProcedimento from './EscolherProcedimento'
import { buscarPreco } from '@/lib/precoCirurgia'
import {
  ITEM_VAZIO, type ItemCirurgia, calcularConjugadas, PERCENTUAL_PROCEDIMENTO_ADICIONAL,
} from '@/lib/itensCirurgia'

// A lista de procedimentos de um lançamento.
//
// Um lançamento tem pelo menos um procedimento e, quando a cirurgia é
// conjugada, mais. Cada linha guarda o próprio valor de equipe: o segundo
// procedimento quase sempre é cobrado por menos, e essa é a primeira coisa que
// a secretária precisa poder mexer.
//
// O valor de cada linha vem da tabela do convênio, do plano ou da particular,
// e volta a vir de lá se a pessoa apagar o que digitou.

const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// v48.117 — "itens" a mais: é o texto do material em si, para a secretária
// poder VER o que está escolhido, não só o nome da lista.
type MaterialLista = { id: string; procedimento_id: string; nome: string; padrao: boolean; itens: string }

export default function ProcedimentosDaCirurgia({
  itens, onItens, convenioId, planoId, temAnestesista, anestesistaCobraDireto, onAlterado,
  materiaisListas, materiais, onMateriais, onListaCriada,
}: {
  itens: ItemCirurgia[]
  onItens: (v: ItemCirurgia[]) => void
  convenioId: string | null
  planoId: string | null
  temAnestesista: boolean
  anestesistaCobraDireto: boolean
  onAlterado?: () => void
  // v48.102 — A lista de materiais de cada procedimento, igual ao link do
  // cirurgião: a secretária vê e escolhe aqui, sem precisar adivinhar mais
  // tarde na hora de gerar a solicitação. Opcionais: uma tela que ainda não
  // carrega isso continua funcionando, só sem o seletor.
  materiaisListas?: MaterialLista[]
  materiais?: Record<string, string>
  onMateriais?: (v: Record<string, string>) => void
  // v48.117 — Avisa o pai quando uma lista nova é criada aqui mesmo (gravar
  // um novo padrão, sem ir em Configurações → Cirurgias), para ela entrar na
  // materiaisListas do pai na hora, sem esperar um recarregamento.
  onListaCriada?: (l: MaterialLista) => void
}) {
  const lista = itens.length ? itens : [{ ...ITEM_VAZIO }]

  // Duas etapas separadas de propósito.
  //
  //   1. buscar o preço de tabela de cada linha — vai à rede, então só roda
  //      quando muda o procedimento, o convênio ou o plano;
  //   2. aplicar a regra das conjugadas sobre esses preços — é conta pura, e
  //      roda sempre que qualquer valor da lista muda.
  //
  // Juntas num efeito só, digitar um valor à mão dispararia uma consulta por
  // tecla; separadas, cada uma acontece quando faz sentido.
  const chave = lista.map(i => i.procedimento_id ?? '-').join('|') + '#' + (convenioId ?? '') + '#' + (planoId ?? '')
  const ultimaChave = useRef('')

  useEffect(() => {
    if (ultimaChave.current === chave) return
    ultimaChave.current = chave
    let vivo = true

    ;(async () => {
      const precos = await Promise.all(lista.map(i => buscarPreco(i.procedimento_id, convenioId, planoId)))
      if (!vivo) return
      let mudou = false
      const novos = lista.map((i, k) => {
        const p = precos[k]
        if (!p || i.valor_manual) return i
        if (Number(i.valor_equipe) === p.valorEquipe && Number(i.valor_anestesista) === p.valorAnestesista) return i
        mudou = true
        return { ...i, valor_equipe: p.valorEquipe, valor_anestesista: p.valorAnestesista }
      })
      if (mudou) onItens(novos)
    })()

    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  // A regra das conjugadas é só conta: o valor cheio continua guardado em cada
  // linha, e o que ela contribui é calculado na hora. Assim o rateio de
  // honorários e a carta continuam sabendo quanto vale cada procedimento.
  const conta = calcularConjugadas(lista, { temAnestesista, anestesistaCobraDireto })

  function alterar(k: number, campo: Partial<ItemCirurgia>) {
    onItens(lista.map((i, j) => j === k ? { ...i, ...campo } : i))
  }

  function remover(k: number) {
    const restante = lista.filter((_, j) => j !== k)
    onItens(restante.length ? restante : [{ ...ITEM_VAZIO }])
  }

  const input = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="space-y-2">
      {lista.map((item, k) => (
        <div key={k} className={k > 0 ? 'bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2' : 'space-y-2'}>
          {k > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-500">
                {k === 1 ? '2º procedimento' : `${k + 1}º procedimento`}
              </p>
              <button type="button" onClick={() => remover(k)}
                title="Tirar este procedimento do lançamento"
                className="p-1 text-slate-300 hover:text-red-500"><Trash2 size={14}/></button>
            </div>
          )}

          <EscolherProcedimento
            procedimentoId={item.procedimento_id}
            sigla={item.sigla}
            nome={item.nome}
            onAlterado={onAlterado}
            autoFocus={k > 0 && !item.procedimento_id}
            onEscolher={p => alterar(k, {
              procedimento_id: p?.id ?? null,
              sigla: p?.sigla ?? '',
              nome: p?.nome ?? '',
              via_acesso: p?.via_padrao || item.via_acesso || '',
              // Trocar de cirurgia desfaz o valor digitado à mão: ele era daquele
              // procedimento, não deste.
              valor_manual: false,
              valor_equipe: p ? Number(p.valor_equipe) : 0,
              valor_anestesista: p ? Number(p.valor_anestesista) : 0,
            })}/>

          {item.procedimento_id && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Equipe</label>
                <input type="number" step="0.01" value={item.valor_equipe}
                  onChange={e => alterar(k, {
                    valor_equipe: e.target.value === '' ? 0 : Number(e.target.value),
                    valor_manual: true,
                  })}
                  className={input}/>
              </div>
              {temAnestesista && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Anestesista</label>
                  <input type="number" step="0.01" value={item.valor_anestesista}
                    onChange={e => alterar(k, {
                      valor_anestesista: e.target.value === '' ? 0 : Number(e.target.value),
                      valor_manual: true,
                    })}
                    className={input}/>
                </div>
              )}
            </div>
          )}

          {item.procedimento_id && lista.length > 1 && (
            conta.entram[k] !== conta.bases[k] ? (
              <p className="text-[11px] text-slate-500">
                Entra por {brl(conta.entram[k])} — {PERCENTUAL_PROCEDIMENTO_ADICIONAL}% de {brl(conta.bases[k])},
                porque o procedimento de maior valor é que entra inteiro.
              </p>
            ) : (
              <p className="text-[11px] text-brand-600 font-semibold">
                Entra inteiro por {brl(conta.entram[k])} — é o de maior valor.
              </p>
            )
          )}

          {item.valor_manual && (
            <p className="text-[11px] text-amber-700">
              Valor combinado à mão nesta linha ({brl(Number(item.valor_equipe))}) — a tabela não mexe mais nele.{' '}
              <button type="button" className="font-semibold underline"
                onClick={() => { ultimaChave.current = ''; alterar(k, { valor_manual: false }) }}>
                voltar para a tabela
              </button>
            </p>
          )}

          {/* v48.102 — Igual ao link do cirurgião: qual material usar, por
              procedimento.
              v48.117 — Antes só aparecia com 2+ opções cadastradas e não
              dava para ver o conteúdo nem gravar um novo daqui: Jorge pediu
              os três (ver o escolhido, escolher entre os prontos ou gravar
              um novo), então agora aparece sempre que há um procedimento —
              mesmo sem nenhuma lista ainda, para poder criar a primeira. */}
          {item.procedimento_id && (
            <MaterialDoProcedimento
              procedimentoId={item.procedimento_id}
              opcoes={(materiaisListas || []).filter(l => l.procedimento_id === item.procedimento_id)}
              selecionadoId={(materiais || {})[item.procedimento_id] || null}
              onEscolher={id => onMateriais?.({ ...(materiais || {}), [item.procedimento_id!]: id })}
              onCriada={l => {
                onListaCriada?.(l)
                onMateriais?.({ ...(materiais || {}), [item.procedimento_id!]: l.id })
              }}/>
          )}
        </div>
      ))}

      {/* O "+" só aparece depois que a primeira cirurgia foi escolhida: um
          segundo campo vazio antes do primeiro estar resolvido só confunde. */}
      {lista[0]?.procedimento_id && (
        <button type="button"
          onClick={() => onItens([...lista, { ...ITEM_VAZIO }])}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-brand-300 text-brand-600 text-xs font-semibold hover:bg-brand-50">
          <Plus size={14}/> Adicionar procedimento
        </button>
      )}
    </div>
  )
}

// v48.117 — Ver, escolher entre os prontos ou gravar um novo, direto na
// edição da cirurgia — sem precisar abrir "Solicitação de cirurgia" (onde
// isso já existia, mas só depois de a cirurgia estar lançada) nem ir em
// Configurações → Cirurgias só para cadastrar uma variação nova de material.
function MaterialDoProcedimento({
  procedimentoId, opcoes, selecionadoId, onEscolher, onCriada,
}: {
  procedimentoId: string
  opcoes: MaterialLista[]
  selecionadoId: string | null
  onEscolher: (id: string) => void
  onCriada: (l: MaterialLista) => void
}) {
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [itens, setItens] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const selecionada = opcoes.find(l => l.id === selecionadoId) || null

  async function salvar() {
    if (!nome.trim()) { setErro('Dê um nome para a lista.'); return }
    setSalvando(true); setErro('')
    const { data, error } = await supabase.from('cirurgia_material_listas').insert({
      procedimento_id: procedimentoId, nome: nome.trim(), itens,
      padrao: opcoes.length === 0, ativo: true, ordem: opcoes.length,
    }).select('id, procedimento_id, nome, padrao, itens').single()
    setSalvando(false)
    if (error) { setErro('Não foi possível salvar: ' + error.message); return }
    onCriada(data as MaterialLista)
    setCriando(false); setNome(''); setItens('')
  }

  const campo = 'w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="border-t border-slate-100 pt-1.5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] text-slate-400">Material a usar</p>
        {!criando && (
          <button type="button" onClick={() => { setCriando(true); setErro('') }}
            className="flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:text-brand-700">
            <Plus size={11}/> nova lista
          </button>
        )}
      </div>

      {opcoes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {opcoes.map(l => (
            <button key={l.id} type="button" onClick={() => onEscolher(l.id)}
              className={'px-2 py-1 rounded-lg border text-[11px] font-medium ' +
                (l.id === selecionadoId ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-200 text-slate-600')}>
              {l.nome}{l.padrao ? ' ·' : ''}
            </button>
          ))}
        </div>
      )}
      {!opcoes.length && !criando && (
        <p className="text-[11px] text-slate-400">Nenhuma lista cadastrada para este procedimento ainda.</p>
      )}

      {/* v48.117 — Ver o que está escolhido, não só o nome da lista. */}
      {selecionada && !criando && (
        <pre className="mt-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 whitespace-pre-wrap max-h-28 overflow-y-auto font-mono">
          {selecionada.itens?.trim() || '(lista sem itens cadastrados)'}
        </pre>
      )}

      {criando && (
        <div className="mt-1.5 bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5">
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome da lista (ex.: Tela Bard)"
            className={campo}/>
          <textarea value={itens} onChange={e => setItens(e.target.value)} rows={4}
            placeholder={'* 1 UNIDADE - AGULHA DE VERES\n* 1 UNIDADE - TROCARTE 12/5MM DESCARTÁVEL'}
            className={campo + ' font-mono'}/>
          {erro && <p className="text-[11px] text-red-600">{erro}</p>}
          <div className="flex gap-1.5">
            <button type="button" disabled={salvando}
              onClick={() => { setCriando(false); setErro(''); setNome(''); setItens('') }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={salvando || !nome.trim()}
              className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand-500 text-white text-[11px] font-semibold disabled:opacity-50">
              {salvando ? <Loader2 size={12} className="animate-spin"/> : <Check size={12}/>} Salvar e usar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
