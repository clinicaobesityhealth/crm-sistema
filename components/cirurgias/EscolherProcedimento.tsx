'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Search, Loader2, Plus, Pencil, Check, X, Scissors } from 'lucide-react'
import { semAcento } from '@/lib/texto'
import { useVias } from '@/lib/viasCirurgia'
import BuscaNomeTuss from './BuscaNomeTuss'

// O campo de cirurgia do lançamento.
//
// Antes era uma lista fechada com as 18 cadastradas. O problema aparece na
// primeira cirurgia fora da lista: a pessoa tem que parar o lançamento, ir em
// Configurações, cadastrar, voltar e recomeçar — ou escolher qualquer uma
// parecida, que é o que acontece de verdade.
//
// Agora são três coisas no mesmo lugar:
//   buscar entre as cadastradas;
//   achar no catálogo TUSS inteiro e cadastrar na hora;
//   corrigir nome, abreviação, via e valores da que está escolhida — e o nome,
//   na correção, também busca na tabela TUSS (v48.25).

export type ProcEscolhido = {
  id: string
  sigla: string
  nome: string
  valor_equipe: number
  valor_anestesista: number
  via_padrao?: string | null
}

const CAMPOS = 'id, sigla, nome, valor_equipe, valor_anestesista, via_padrao'

type Sugestao =
  | { tipo: 'cadastrado'; proc: ProcEscolhido }
  | { tipo: 'tuss'; codigo: string; nome: string }

export default function EscolherProcedimento({
  procedimentoId, sigla, nome, onEscolher, onAlterado, autoFocus,
}: {
  procedimentoId: string | null
  sigla: string
  nome: string
  onEscolher: (p: ProcEscolhido | null) => void
  onAlterado?: () => void
  autoFocus?: boolean
}) {
  const [busca, setBusca] = useState('')
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [buscando, setBuscando] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [novoDoTuss, setNovoDoTuss] = useState<{ codigo: string; nome: string } | null>(null)
  const [editando, setEditando] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) { setAberto(false) }
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  // v48.102 — O código TUSS junto do procedimento já escolhido, para a
  // secretária ver na hora de agendar sem precisar abrir Configurações.
  const [codigosTuss, setCodigosTuss] = useState<string[]>([])
  useEffect(() => {
    if (!procedimentoId) { setCodigosTuss([]); return }
    let vivo = true
    supabase.from('cirurgia_proc_tuss').select('codigo').eq('procedimento_id', procedimentoId).order('ordem')
      .then(({ data }) => { if (vivo) setCodigosTuss(((data ?? []) as any[]).map(t => t.codigo).filter(Boolean)) })
    return () => { vivo = false }
  }, [procedimentoId])

  const procurar = useCallback(async (q: string) => {
    setBuscando(true)
    const limpo = q.replace(/[,()*%]/g, ' ').trim()

    // Primeiro as cadastradas: são as que a clínica opera, e trazem valores,
    // materiais e CID prontos.
    const { data: cads } = await supabase
      .from('cirurgia_procedimentos')
      .select(CAMPOS)
      .eq('ativo', true).order('ordem')

    const alvo = semAcento(limpo)
    const cadastrados: Sugestao[] = ((cads ?? []) as ProcEscolhido[])
      .filter(p => semAcento(p.sigla).includes(alvo) || semAcento(p.nome).includes(alvo))
      .map(p => ({ tipo: 'cadastrado', proc: p }))

    // Depois o catálogo da ANS, para o que ainda não existe aqui dentro.
    const numeros = limpo.replace(/\D/g, '')
    const { data: tuss } = await supabase
      .from('tuss_catalog')
      .select('code, procedure_name')
      .or(numeros.length >= 4 ? `code.ilike.${numeros}%` : `procedure_name.ilike.%${limpo}%`)
      .eq('is_active', true)
      .limit(8)

    const jaTem = new Set(cadastrados.map(c => c.tipo === 'cadastrado' ? semAcento(c.proc.nome) : ''))
    const doCatalogo: Sugestao[] = ((tuss ?? []) as any[])
      .filter(t => !jaTem.has(semAcento(t.procedure_name)))
      .map(t => ({ tipo: 'tuss', codigo: t.code, nome: t.procedure_name }))

    setSugestoes([...cadastrados.slice(0, 8), ...doCatalogo])
    setBuscando(false)
  }, [])

  useEffect(() => {
    const q = busca.trim()
    if (q.length < 2) { setSugestoes([]); return }
    const t = setTimeout(() => procurar(q), 250)
    return () => clearTimeout(t)
  }, [busca, procurar])

  const input = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  // --- já escolhida --------------------------------------------------------
  if (procedimentoId && !editando) {
    return (
      <div className="flex items-start gap-2 px-3 py-2.5 bg-brand-50 border border-brand-100 rounded-lg">
        <Scissors size={15} className="text-brand-600 shrink-0 mt-0.5"/>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">{sigla}</p>
          <p className="text-xs text-slate-600 leading-snug">{nome}</p>
          {codigosTuss.length > 0 && (
            <p className="text-[11px] text-brand-700 mt-0.5">
              {codigosTuss.map(c => 'TUSS ' + c).join(' · ')}
            </p>
          )}
        </div>
        <button type="button" onClick={() => setEditando(true)} title="Corrigir nome, abreviação e valores"
          className="p-1 text-slate-400 hover:text-brand-600 shrink-0"><Pencil size={14}/></button>
        <button type="button" onClick={() => { onEscolher(null); setBusca(''); setAberto(true) }}
          title="Trocar de cirurgia" className="p-1 text-slate-400 hover:text-slate-700 shrink-0"><X size={15}/></button>
      </div>
    )
  }

  if (procedimentoId && editando) {
    return <EditarProcedimento id={procedimentoId} onPronto={async (p) => {
      setEditando(false)
      if (p) { onEscolher(p); await onAlterado?.() }
    }}/>
  }

  // --- cadastrando a partir do catálogo -------------------------------------
  if (novoDoTuss) {
    return <NovoProcedimento
      codigoTuss={novoDoTuss.codigo}
      nome={novoDoTuss.nome}
      onPronto={async (p) => {
        setNovoDoTuss(null)
        if (p) { onEscolher(p); setBusca(''); setAberto(false); await onAlterado?.() }
      }}/>
  }

  // --- buscando ------------------------------------------------------------
  return (
    <div ref={caixa} className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300"/>
      <input
        value={busca}
        autoFocus={autoFocus}
        onChange={e => { setBusca(e.target.value); setAberto(true) }}
        onFocus={() => setAberto(true)}
        placeholder="Digite a abreviação, o nome ou o código TUSS..."
        className={input + ' pl-9'}/>

      {aberto && busca.trim().length >= 2 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {buscando ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-400">
              <Loader2 size={13} className="animate-spin"/> Procurando...
            </div>
          ) : sugestoes.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-slate-400">Nada encontrado, nem nas cadastradas nem no catálogo TUSS.</p>
          ) : (
            sugestoes.map((s, i) => s.tipo === 'cadastrado' ? (
              <button key={'c' + s.proc.id} type="button"
                onClick={() => { onEscolher(s.proc); setBusca(''); setAberto(false) }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-brand-600 shrink-0">{s.proc.sigla}</span>
                  <span className="text-xs text-slate-600 truncate">{s.proc.nome}</span>
                </div>
              </button>
            ) : (
              <button key={'t' + s.codigo + i} type="button"
                onClick={() => setNovoDoTuss({ codigo: s.codigo, nome: s.nome })}
                className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-slate-50">
                <div className="flex items-start gap-2">
                  <Plus size={12} className="text-amber-600 shrink-0 mt-0.5"/>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-700 leading-snug">{s.nome}</p>
                    <p className="text-[11px] text-amber-700">TUSS {s.codigo} · cadastrar esta cirurgia</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// Cadastra uma cirurgia nova a partir do catálogo, pedindo só o indispensável:
// abreviação, via e valores. O resto (materiais, CID, orientações) fica para a
// tela de cadastro, quando houver calma.
function NovoProcedimento({ codigoTuss, nome, onPronto }: {
  codigoTuss: string; nome: string; onPronto: (p: ProcEscolhido | null) => void
}) {
  const vias = useVias()
  const [nomeFinal, setNomeFinal] = useState(nome)
  const [codigo, setCodigo] = useState(codigoTuss)
  const [sigla, setSigla] = useState(sugerirSigla(nome))
  const [via, setVia] = useState(viaDoNome(nome))
  const [equipe, setEquipe] = useState('')
  const [anest, setAnest] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    const s = sigla.trim()
    if (!s) { alert('A abreviação é obrigatória — é por ela que a equipe encontra a cirurgia.'); return }
    if (!nomeFinal.trim()) { alert('O nome é obrigatório — é ele que sai na guia.'); return }
    setSalvando(true)
    const { data, error } = await supabase.from('cirurgia_procedimentos').insert({
      sigla: s,
      nome: nomeFinal.trim(),
      valor_equipe: Number(String(equipe).replace(',', '.')) || 0,
      valor_anestesista: Number(String(anest).replace(',', '.')) || 0,
      via_padrao: via || null,
      ordem: 999,
    }).select(CAMPOS).single()

    if (error || !data) {
      setSalvando(false)
      alert('Não foi possível cadastrar: ' + (error?.message || ''))
      return
    }
    // O código TUSS vem junto: foi por ele que a cirurgia foi encontrada, e é
    // ele que a guia do convênio vai pedir.
    if (codigo) {
      await supabase.from('cirurgia_proc_tuss').insert({
        procedimento_id: data.id, codigo, ordem: 1,
      })
    }
    setSalvando(false)
    onPronto(data as ProcEscolhido)
  }

  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-900">Cadastrar cirurgia nova</p>

      <div>
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Nome (busca na tabela TUSS)</label>
        <BuscaNomeTuss
          valor={nomeFinal}
          onTexto={setNomeFinal}
          onEscolher={(n, c) => { setNomeFinal(n); setCodigo(c); if (!sigla.trim()) setSigla(sugerirSigla(n)) }}
          className={inp}/>
        <p className="text-[11px] text-amber-700 mt-1">{codigo ? `TUSS ${codigo}` : 'sem código TUSS'}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Abreviação</label>
          <input value={sigla} onChange={e => setSigla(e.target.value)} className={inp}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Via de acesso</label>
          <select value={via} onChange={e => setVia(e.target.value)} className={inp}>
            <option value="">—</option>
            {vias.map(v => <option key={v.id} value={v.nome}>{v.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Equipe</label>
          <input value={equipe} onChange={e => setEquipe(e.target.value)} inputMode="decimal" placeholder="0,00" className={inp}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Anestesista</label>
          <input value={anest} onChange={e => setAnest(e.target.value)} inputMode="decimal" placeholder="0,00" className={inp}/>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => onPronto(null)}
          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600">Cancelar</button>
        <button type="button" onClick={salvar} disabled={salvando}
          className="flex-1 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
          {salvando ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>} Cadastrar e usar
        </button>
      </div>
      <p className="text-[10px] text-amber-700">
        Materiais, CID e orientações podem ser preenchidos depois em Configurações → Cad. Cirurgias.
      </p>
    </div>
  )
}

// Corrige nome, abreviação, via e valores da cirurgia escolhida, direto daqui.
//
// v48.25 — O nome deixou de ser texto livre: digitar três letras já procura na
// tabela TUSS, e escolher de lá grava o código junto. Era o campo em que um
// "Gas" digitado com pressa virava o nome oficial da cirurgia na guia.
function EditarProcedimento({ id, onPronto }: { id: string; onPronto: (p: ProcEscolhido | null) => void }) {
  const vias = useVias()
  const [p, setP] = useState<ProcEscolhido | null>(null)
  const [tussAtual, setTussAtual] = useState<string[]>([])
  const [novoTuss, setNovoTuss] = useState<string>('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    supabase.from('cirurgia_procedimentos').select(CAMPOS).eq('id', id).single()
      .then(({ data }) => setP(data as ProcEscolhido))
    supabase.from('cirurgia_proc_tuss').select('codigo').eq('procedimento_id', id).order('ordem')
      .then(({ data }) => setTussAtual(((data ?? []) as any[]).map(t => t.codigo)))
  }, [id])

  async function salvar() {
    if (!p || !p.sigla.trim()) { alert('A abreviação é obrigatória.'); return }
    if (!p.nome.trim()) { alert('O nome é obrigatório.'); return }
    setSalvando(true)
    const { error } = await supabase.from('cirurgia_procedimentos').update({
      sigla: p.sigla.trim(),
      nome: p.nome.trim(),
      valor_equipe: Number(p.valor_equipe) || 0,
      valor_anestesista: Number(p.valor_anestesista) || 0,
      via_padrao: p.via_padrao || null,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id)

    // Código escolhido na busca entra na lista se ainda não estiver lá. Os que
    // já existem não são tocados: uma cirurgia pode ter mais de um TUSS, e
    // apagar os outros aqui seria destruir cadastro sem ninguém pedir.
    if (!error && novoTuss && !tussAtual.includes(novoTuss)) {
      await supabase.from('cirurgia_proc_tuss').insert({
        procedimento_id: p.id, codigo: novoTuss, ordem: tussAtual.length + 1,
      })
    }

    setSalvando(false)
    if (error) { alert('Não foi possível salvar: ' + error.message); return }
    onPronto(p)
  }

  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  if (!p) return <div className="flex items-center gap-2 text-xs text-slate-400 py-2"><Loader2 size={13} className="animate-spin"/> Carregando...</div>

  const codigos = [...tussAtual, ...(novoTuss && !tussAtual.includes(novoTuss) ? [novoTuss] : [])]

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-700">Corrigir a cirurgia cadastrada</p>
      <div>
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Nome (busca na tabela TUSS)</label>
        <BuscaNomeTuss
          valor={p.nome}
          onTexto={v => setP({ ...p, nome: v })}
          onEscolher={(n, c) => { setP({ ...p, nome: n }); setNovoTuss(c) }}
          className={inp}/>
        <p className="text-[11px] text-slate-500 mt-1">
          {codigos.length ? codigos.map(c => 'TUSS ' + c).join(' · ') : 'sem código TUSS cadastrado'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Abreviação</label>
          <input value={p.sigla} onChange={e => setP({ ...p, sigla: e.target.value })} className={inp}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Via de acesso</label>
          <select value={p.via_padrao ?? ''} onChange={e => setP({ ...p, via_padrao: e.target.value })} className={inp}>
            <option value="">—</option>
            {vias.map(v => <option key={v.id} value={v.nome}>{v.nome}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Equipe</label>
          <input value={p.valor_equipe} onChange={e => setP({ ...p, valor_equipe: Number(e.target.value) })} type="number" step="0.01" className={inp}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Anestesista</label>
          <input value={p.valor_anestesista} onChange={e => setP({ ...p, valor_anestesista: Number(e.target.value) })} type="number" step="0.01" className={inp}/>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onPronto(null)}
          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600">Cancelar</button>
        <button type="button" onClick={salvar} disabled={salvando}
          className="flex-1 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
          {salvando ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>} Salvar na tabela
        </button>
      </div>
      <p className="text-[10px] text-slate-500">
        Muda a tabela de cirurgias da clínica, não só este lançamento. Cirurgias já lançadas com valor
        digitado à mão não são afetadas.
      </p>
    </div>
  )
}

// Sugere uma abreviação a partir do nome: iniciais das palavras que importam.
// É chute, e por isso o campo continua editável — mas um chute razoável poupa
// digitação na maioria das vezes.
function sugerirSigla(nome: string) {
  const ignorar = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'por', 'a', 'o', 'em', 'para'])
  return nome
    .split(/[\s\-,()]+/)
    .map(p => p.trim())
    .filter(p => p.length > 1 && !ignorar.has(p.toLowerCase()))
    .slice(0, 3)
    .map(p => p[0].toUpperCase())
    .join('')
}

// A descrição da ANS quase sempre diz a via no fim do nome ("... por
// videolaparoscopia"). Quando diz, o campo já vem preenchido.
export function viaDoNome(nome: string) {
  const n = (nome || '').toLowerCase()
  if (/rob[óo]tic/.test(n)) return 'ROBÓTICA'
  if (/laparoscop|videolaparoscop/.test(n)) return 'VIDEOLAPAROSCOPIA'
  return ''
}
