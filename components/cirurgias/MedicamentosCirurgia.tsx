'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Pill, Plus, Trash2, Loader2, Sparkles, Check, Download, AlertCircle, Clock } from 'lucide-react'
import SuspensaoMedicamentosAtalho from './SuspensaoMedicamentosAtalho'

// v48.97 — Medicações da cirurgia, base para a orientação de suspensão
// (PausaMed). Cada linha pode vir resolvida pela base clínica do PausaMed
// (botão "Consultar") ou preenchida à mão. Só sai no PDF (aba Documentos →
// Suspensão de medicamentos) quando TODAS tiverem prazo e orientação — e, uma
// vez aprovada (o PDF foi gerado), a linha trava: edite gerando um novo
// documento, não voltando aqui.
//
// v48.122 — Duas coisas a mais, pedidas pelo Jorge: um atalho para emitir o
// PDF de suspensão sem sair desta aba (ver SuspensaoMedicamentosAtalho.tsx) e
// um tique ao lado do remédio já aprovado avisando que o lembrete de
// suspensão (um dia antes da data de cada um) já foi enviado ao paciente,
// para controle. Enquanto o lembrete só está programado (ainda não chegou a
// véspera), mostra um relógio em vez do tique.
//
// v48.132 — O lembrete em si (agendar_lembrete_medicamento, na migração
// v48.132) roda sozinho assim que o remédio é aprovado, e se recalcula
// sozinho se a cirurgia mudar de data — não depende mais de ninguém abrir o
// CRM. Só a LEITURA do tique aqui mudou de tabela (scheduled_messages).
//
// v48.125 — Pedido do Jorge: ao digitar o nome de um medicamento novo,
// mostrar as opções já conhecidas na base da própria clínica
// (cirurgia_medicamentos_clinica), pra ele escolher uma entrada já vetada em
// vez de digitar um nome parecido mas ligeiramente diferente (typo, nome
// comercial vs. abreviação...) que a busca de resolverMedicamento() não
// reconhece como o mesmo remédio. Não substitui a digitação livre — quem
// continua digitando e clica Adicionar sem escolher nada funciona igual a
// antes.

type Medicamento = {
  id: string; nome_informado: string; principio_ativo: string | null
  prazo_suspensao_dias: number | null; explicacao_paciente: string | null
  fonte: string | null; fonte_detalhe: string | null; fonte_referencia: string | null; status: string
}

const FONTE_LABEL: Record<string, string> = {
  hospital: 'Regra do hospital', clinica: 'Personalização da clínica',
  hospital_importada: 'Regra hospitalar importada', geral: 'Base padrão PausaMed',
  // v48.101 — Quando o PausaMed não tem: base própria da clínica (o que já
  // foi pesquisado por IA antes) ou uma pesquisa por IA feita agora mesmo.
  clinica_ia: 'Base própria da clínica (IA)', ia: 'Pesquisado agora por IA — revise com atenção',
  manual: 'Preenchido manualmente',
}

export default function MedicamentosCirurgia({ cirurgiaId }: { cirurgiaId: string }) {
  const [lista, setLista] = useState<Medicamento[]>([])
  const [textoLivre, setTextoLivre] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [novoNome, setNovoNome] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  // v48.112 — A IA não grava mais sozinha na base da clínica (workflow "CRM -
  // Pesquisar Remédio (IA)"): agora pergunta aqui antes.
  //
  // v48.115 — Isto era um único valor (Medicamento | null), então pesquisar o
  // remédio seguinte ANTES de responder ao anterior simplesmente sobrescrevia
  // o pendente — quem consultava vários remédios em sequência só via a
  // pergunta do último, e perdia a chance de guardar os anteriores na base da
  // clínica sem perceber. Agora é uma fila: cada remédio resolvido por IA
  // entra no fim, a pergunta mostra sempre o primeiro, e só sai da fila
  // quando respondida — nada se perde, e fica de fato "um por um".
  const [filaConfirmarBase, setFilaConfirmarBase] = useState<Medicamento[]>([])
  const confirmarBase = filaConfirmarBase[0] ?? null
  const [salvandoBase, setSalvandoBase] = useState(false)

  // v48.122 — Por medicamento: 'enviado' (lembrete de suspensão já foi ao
  // paciente — tique de controle) ou 'pendente' (programado, esperando a
  // véspera da data de suspensão dele). Sem entrada aqui: ainda não aprovado,
  // ou aprovado mas a véspera está longe.
  const [lembretes, setLembretes] = useState<Record<string, 'enviado' | 'pendente'>>({})

  // v48.125 — Autocomplete da base própria da clínica ao digitar o nome do
  // medicamento (ver comentário no topo do arquivo). Mesmo padrão de
  // BuscaCodigo.tsx: consulta direto pelo cliente Supabase (a tabela já tem
  // RLS liberando leitura para usuário autenticado), debounce de ~280ms, e
  // fecha ao clicar fora.
  const [sugestoesNome, setSugestoesNome] = useState<{ nome: string; principioAtivo: string | null; origem?: string }[]>([])
  const [buscandoSugestao, setBuscandoSugestao] = useState(false)
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false)
  const caixaNovoNome = useRef<HTMLDivElement>(null)
  const inputNovoNome = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixaNovoNome.current && !caixaNovoNome.current.contains(e.target as Node)) setSugestoesAbertas(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  useEffect(() => {
    const termo = novoNome.trim()
    if (termo.length < 2) { setSugestoesNome([]); return }
    const t = setTimeout(() => buscarSugestoesNome(termo), 280)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novoNome])

  // v48.144 — Antes consultava direto cirurgia_medicamentos_clinica pelo
  // navegador (só o que a própria clínica já tinha pesquisado antes). Pedido
  // do Jorge depois do caso "MOUJARO" (typo que a IA não pegou): passou a
  // buscar pela API (/api/cirurgias/medicamentos-clinica), que agora também
  // olha o catálogo do PRÓPRIO PausaMed — ver sugerirMedicamentos() em
  // lib/pausamed.ts.
  async function buscarSugestoesNome(termo: string) {
    setBuscandoSugestao(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/cirurgias/medicamentos-clinica?q=${encodeURIComponent(termo)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      const j = await r.json().catch(() => ({}))
      setSugestoesNome(r.ok ? (j.medicamentos || []) : [])
    } catch { setSugestoesNome([]) }
    setBuscandoSugestao(false)
  }

  // v48.144 — Escolher da lista já inclui direto (sem precisar clicar em
  // "Adicionar" depois) e limpa/refoca o campo para o próximo remédio —
  // pedido explícito do Jorge ("escolher na lista... seguir para a próxima").
  async function escolherSugestaoNome(s: { nome: string; principioAtivo: string | null }) {
    setSugestoesNome([]); setSugestoesAbertas(false)
    await adicionar(s.nome)
    inputNovoNome.current?.focus()
  }

  // v48.132 — O lembrete de suspensão deixou de ser um "aviso" que espera
  // alguém mandar (cirurgia_avisos): agora é uma mensagem programada como
  // qualquer outra (scheduled_messages, ver agendar_lembrete_medicamento na
  // migração v48.132) — sai sozinha, no motor que já roda a cada minuto.
  const carregarLembretes = useCallback(async () => {
    const { data } = await supabase.from('scheduled_messages')
      .select('medicamento_id, status')
      .eq('cirurgia_id', cirurgiaId).eq('reminder_type', 'medicacao_suspender')
      .not('medicamento_id', 'is', null)
      .in('status', ['scheduled', 'pending', 'sent'])
      .order('scheduled_for')
    const mapa: Record<string, 'enviado' | 'pendente'> = {}
    for (const r of (data ?? []) as any[]) {
      if (!r.medicamento_id) continue
      if (r.status === 'sent') mapa[r.medicamento_id] = 'enviado'
      else if (mapa[r.medicamento_id] !== 'enviado') mapa[r.medicamento_id] = 'pendente'
    }
    setLembretes(mapa)
  }, [cirurgiaId])

  useEffect(() => { carregarLembretes() }, [carregarLembretes])

  async function chamar(metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', corpo?: any, busca = '') {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch(`/api/cirurgias/${cirurgiaId}/medicamentos${busca}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${session?.access_token || ''}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
    return j
  }

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const j = await chamar('GET')
      setLista(j.medicamentos || []); setTextoLivre(j.medicacoesTextoLivre || '')
    } catch (e: any) { setErro(e.message) }
    setCarregando(false)
  }, [cirurgiaId])

  useEffect(() => { carregar() }, [carregar])

  async function importar() {
    setOcupado('importar'); setErro('')
    try { await chamar('POST', { acao: 'importar_texto' }); await carregar() }
    catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  async function adicionar(nomeForcado?: string) {
    const nome = (nomeForcado ?? novoNome).trim()
    if (!nome) return
    setOcupado('adicionar'); setErro('')
    try {
      const j = await chamar('POST', { nome })
      setNovoNome(''); await carregar()
      // v48.124 — Pedido do Jorge: não precisar clicar no ícone da IA depois
      // de cada medicamento — busca sozinho assim que adiciona (PausaMed/base
      // da clínica/IA, na mesma ordem de sempre), e o médico só revisa.
      if (j?.medicamento?.id) await consultarPausaMed(j.medicamento.id)
    }
    catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  async function remover(id: string) {
    setOcupado('remover:' + id); setErro('')
    try { await chamar('DELETE', undefined, `?id=${id}`); await carregar() }
    catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  async function consultarPausaMed(id: string) {
    setOcupado('consultar:' + id); setErro('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/cirurgias/${cirurgiaId}/medicamentos/resolver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
      await carregar()
      if (!j.encontrado) setErro('Não achei regra para este medicamento — nem no PausaMed, nem na base da clínica, nem pesquisando agora com IA. Preencha prazo e orientação manualmente abaixo.')
      // v48.112 — Achou agora mesmo pesquisando com IA (fonte 'ia'): pergunta
      // se quer guardar na base da própria clínica, para a próxima pessoa que
      // digitar o mesmo remédio não pagar IA de novo. Só pergunta nesse caso —
      // regra do PausaMed ou da base da clínica não precisa confirmar nada.
      // v48.115 — Entra no FIM da fila (nunca substitui o que já está
      // esperando resposta), para não perder a pergunta de um remédio
      // anterior quando a secretária já emenda a consulta do próximo.
      if (j.medicamento?.fonte === 'ia') {
        setFilaConfirmarBase(f => f.some(x => x.id === j.medicamento.id) ? f : [...f, j.medicamento])
      }
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  async function confirmarSalvarNaBase(salvar: boolean) {
    if (!confirmarBase) return
    // v48.115 — Só tira o PRIMEIRO da fila (o que está sendo respondido
    // agora); se outro remédio entrou na fila enquanto essa pergunta estava
    // na tela, ele continua esperando a vez dele.
    if (!salvar) { setFilaConfirmarBase(f => f.slice(1)); return }
    setSalvandoBase(true); setErro('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/cirurgias/medicamentos-clinica', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ medicamentoId: confirmarBase.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
      setFilaConfirmarBase(f => f.slice(1))
    } catch (e: any) { setErro(e.message) }
    setSalvandoBase(false)
  }

  async function salvarCampo(id: string, campo: 'prazo_suspensao_dias' | 'explicacao_paciente' | 'nome_informado', valor: any) {
    setErro('')
    try { const j = await chamar('PATCH', { id, [campo]: valor }); setLista(l => l.map(m => m.id === id ? j.medicamento : m)) }
    catch (e: any) { setErro(e.message) }
  }

  const input = 'w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <Pill size={15} className="text-brand-500"/> Medicações e suspensão
        </p>
      </div>
      <p className="text-[11px] text-slate-400 -mt-2">
        Consulte cada remédio para trazer o prazo de suspensão pronto — primeiro no PausaMed, depois na base da própria clínica e, se nenhum tiver, pesquisando com IA na hora — ou preencha na mão. Todas precisam de prazo e orientação antes de gerar o documento em Emissão de documentos.
      </p>

      {confirmarBase && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 space-y-2">
          <p className="text-xs font-semibold text-violet-800 flex items-center gap-1.5">
            <Sparkles size={13}/> Pesquisado agora por IA: {confirmarBase.principio_ativo}
            {/* v48.115 — Quando há mais de um remédio esperando resposta,
                mostra quantos faltam, pra ficar claro que é "um por um" e não
                "só este" — sem isso parecia que os outros tinham sumido. */}
            {filaConfirmarBase.length > 1 && (
              <span className="ml-auto font-normal text-violet-500 normal-case">
                {filaConfirmarBase.length - 1} {filaConfirmarBase.length - 1 === 1 ? 'remédio depois deste' : 'remédios depois deste'}
              </span>
            )}
          </p>
          {/* v48.144 — De onde a IA tirou a informação (bula, diretriz...),
              para conferir ANTES de decidir salvar na base da clínica — vem
              do conhecimento treinado da IA, não de uma busca ao vivo. */}
          {confirmarBase.fonte_referencia && (
            <p className="text-[11px] text-violet-700/80">Referência: {confirmarBase.fonte_referencia}</p>
          )}
          <p className="text-[11px] text-violet-700/80">
            Quer salvar na base da própria clínica? Assim a próxima cirurgia com este remédio já vem pronta,
            sem precisar pesquisar de novo.
          </p>
          <div className="flex gap-2">
            <button onClick={() => confirmarSalvarNaBase(false)} disabled={salvandoBase}
              className="px-3 py-1.5 rounded-lg border border-violet-200 text-violet-700 text-xs font-semibold disabled:opacity-50">
              Não, só esta cirurgia
            </button>
            <button onClick={() => confirmarSalvarNaBase(true)} disabled={salvandoBase}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold disabled:opacity-50">
              {salvandoBase ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>} Salvar na base da clínica
            </button>
          </div>
        </div>
      )}

      {carregando ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-4"><Loader2 size={14} className="animate-spin"/> Carregando...</div>
      ) : (
        <>
          {!lista.length && textoLivre.trim() && (
            <button onClick={importar} disabled={!!ocupado}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-brand-300 text-brand-700 text-xs font-semibold disabled:opacity-50">
              {ocupado === 'importar' ? <Loader2 size={13} className="animate-spin"/> : <Download size={13}/>}
              Importar da lista atual: "{textoLivre.slice(0, 60)}{textoLivre.length > 60 ? '…' : ''}"
            </button>
          )}

          <div className="space-y-2">
            {lista.map(m => {
              const completo = m.prazo_suspensao_dias != null && !!m.explicacao_paciente?.trim()
              const travado = m.status === 'aprovado'
              const expandido = aberto === m.id
              return (
                <div key={m.id} className={'rounded-xl border px-3 py-2.5 ' + (travado ? 'border-emerald-200 bg-emerald-50/50' : completo ? 'border-slate-200' : 'border-amber-200 bg-amber-50/40')}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setAberto(expandido ? null : m.id)} className="flex-1 text-left min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{m.nome_informado}</p>
                      <p className="text-[11px] text-slate-400 flex items-center gap-1 flex-wrap">
                        {m.principio_ativo && <span>{m.principio_ativo} · </span>}
                        {m.fonte && <span>{FONTE_LABEL[m.fonte] || m.fonte} · </span>}
                        {travado ? <span className="text-emerald-600 font-semibold flex items-center gap-0.5"><Check size={11}/> aprovado</span>
                          : completo ? <span className="text-slate-500">pronto</span>
                          : <span className="text-amber-700 font-semibold flex items-center gap-0.5"><AlertCircle size={11}/> falta prazo/orientação</span>}
                        {/* v48.122 — Tique de controle: o lembrete de suspender
                            ESTE remédio (véspera da data dele) já foi enviado
                            ao paciente. Relógio = programado, esperando a
                            véspera chegar. */}
                        {lembretes[m.id] === 'enviado' && (
                          <span title="Lembrete de suspensão já enviado ao paciente" className="text-emerald-600 font-semibold flex items-center gap-0.5">
                            <Check size={11}/> lembrete enviado
                          </span>
                        )}
                        {lembretes[m.id] === 'pendente' && (
                          <span title="Lembrete de suspensão programado para a véspera da data deste remédio" className="text-sky-600 font-semibold flex items-center gap-0.5">
                            <Clock size={11}/> lembrete programado
                          </span>
                        )}
                      </p>
                    </button>
                    {!travado && (
                      // v48.115 — Era uma lupa (Search): parecia "procurar na
                      // lista", não "PausaMed + base da clínica + IA se
                      // preciso" — o que de fato acontece. Sparkles é o mesmo
                      // ícone já usado no aviso "Pesquisado agora por IA"
                      // abaixo, então a ação e o resultado ficam visualmente
                      // ligados.
                      <button onClick={() => consultarPausaMed(m.id)} disabled={!!ocupado}
                        title="Consultar PausaMed, a base da clínica e, se preciso, IA" className="p-1.5 text-brand-600 disabled:opacity-40 shrink-0">
                        {ocupado === 'consultar:' + m.id ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
                      </button>
                    )}
                    {!travado && (
                      <button onClick={() => remover(m.id)} disabled={!!ocupado} className="p-1.5 text-slate-300 hover:text-red-500 disabled:opacity-40 shrink-0">
                        {ocupado === 'remover:' + m.id ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>}
                      </button>
                    )}
                  </div>

                  {expandido && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-2">
                      <div className="grid grid-cols-[7rem_1fr] gap-2 items-center">
                        <label className="text-[11px] font-semibold text-slate-500">Prazo (dias antes)</label>
                        <input type="number" min={0} disabled={travado} defaultValue={m.prazo_suspensao_dias ?? ''}
                          onBlur={e => salvarCampo(m.id, 'prazo_suspensao_dias', e.target.value)} className={input}/>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-500 block mb-1">Orientação ao paciente</label>
                        <textarea disabled={travado} rows={2} defaultValue={m.explicacao_paciente ?? ''}
                          onBlur={e => salvarCampo(m.id, 'explicacao_paciente', e.target.value)}
                          placeholder="Explicação simples, em linguagem de paciente" className={input}/>
                      </div>
                      {m.fonte_detalhe && <p className="text-[11px] text-slate-400">Fonte: {m.fonte_detalhe}</p>}
                      {m.fonte_referencia && <p className="text-[11px] text-slate-400">Referência: {m.fonte_referencia}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex gap-2 pt-1">
            <div ref={caixaNovoNome} className="relative flex-1 min-w-0">
              <input ref={inputNovoNome} value={novoNome}
                onChange={e => { setNovoNome(e.target.value); setSugestoesAbertas(true) }}
                onFocus={() => setSugestoesAbertas(true)}
                onKeyDown={e => { if (e.key === 'Enter') { adicionar(); setSugestoesAbertas(false) } }}
                placeholder="Nome do medicamento" className={input}/>
              {/* v48.125 — Sugestões já conhecidas na base da clínica, pra
                  favorecer consistência (mesmo nome de sempre) em vez de um
                  nome digitado ligeiramente diferente. Clicar preenche o
                  campo; digitar e mandar Adicionar sem escolher nada
                  continua funcionando como texto livre, igual antes. */}
              {sugestoesAbertas && novoNome.trim().length >= 2 && (buscandoSugestao || sugestoesNome.length > 0) && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {buscandoSugestao ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-slate-400">
                      <Loader2 size={12} className="animate-spin"/> Buscando na base da clínica...
                    </div>
                  ) : (
                    sugestoesNome.map(s => (
                      <button key={s.nome} type="button" onClick={() => escolherSugestaoNome(s)}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                        <p className="text-xs font-semibold text-slate-700">{s.nome}</p>
                        {s.principioAtivo && s.principioAtivo.toLowerCase() !== s.nome.toLowerCase() && (
                          <p className="text-[10px] text-slate-400">{s.principioAtivo}</p>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button onClick={() => adicionar()} disabled={!!ocupado || !novoNome.trim()}
              className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1">
              {ocupado === 'adicionar' ? <Loader2 size={13} className="animate-spin"/> : <Plus size={13}/>} Adicionar
            </button>
          </div>

          {erro && <p className="text-[11px] text-red-600">{erro}</p>}

          {/* v48.122 — Atalho: gerar/enviar o PDF de suspensão sem sair desta
              aba (mesmo motor de DocumentosCirurgia.tsx → Suspensão de
              medicamentos). Gerar aprova as linhas (trava) e é o que liga o
              lembrete de véspera de cada uma — por isso recarrega a lista e
              os lembretes ao fechar o atalho. */}
          {lista.length > 0 && (
            <SuspensaoMedicamentosAtalho cirurgiaId={cirurgiaId} temMedicamentos={lista.length > 0}
              onFechar={() => { carregar(); carregarLembretes() }}/>
          )}
        </>
      )}
    </div>
  )
}
