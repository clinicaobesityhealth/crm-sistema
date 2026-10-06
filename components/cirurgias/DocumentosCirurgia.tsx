'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AlertCircle, CheckCircle2, FileText, Loader2, Pencil, Send, Trash2, X } from 'lucide-react'
import type { ItemRepetido } from '@/lib/materiaisCirurgia'

// v48.69 — Documentos da cirurgia, começando pelo orçamento de honorários.
//
// São três passos, e os três existem por um motivo:
//   1. o CRM monta o texto com os dados do cadastro
//   2. a secretária CONFERE e ajusta na tela — é o passo que a planilha não
//      tinha, e é onde se pega o diagnóstico faltando ou o valor combinado
//   3. só então o PDF é escrito na folha timbrada do cirurgião
// Com o PDF pronto, o botão de enviar ao paciente fica ali do lado.

type Doc = { id: string; titulo: string; texto?: string; url: string; nome_arquivo: string; criado_em: string; enviado_em: string | null; valor: number | null }
type Lista = { id: string; procedimento_id: string; nome: string; padrao: boolean }
// v48.119 — Sigla/nome de cada procedimento da cirurgia, só para agrupar as
// listas de materiais na tela ("qual material é de qual cirurgia" — pedido
// do Jorge quando há 2+ procedimentos, ex.: "BP" + "CCC").
type MaterialProcedimento = { id: string; label: string }

// v48.137 — Pedido do Jorge: as mensagens de envio de Orçamento, Internação e
// Reembolso devem cumprimentar o paciente e assinar em nome da clínica, com o
// documento e o nome da clínica em negrito (o WhatsApp usa *asterisco* para
// negrito). Suspensão de medicamentos e Solicitação (que nem vai ao paciente)
// ficam como estavam.
const ASSINATURA = 'Atenciosamente,\nEquipe *Obesity Health*'
const TIPOS = {
  orcamento: { rotulo: 'Orçamento', mensagem: `Olá, Sr(a)! Segue o *Orçamento de Honorários Médicos* da sua cirurgia. Qualquer dúvida, estamos à disposição.\n\n${ASSINATURA}` },
  solicitacao: { rotulo: 'Solicitação de cirurgia', mensagem: 'Segue a solicitação do procedimento cirúrgico.' },
  internacao: { rotulo: 'Internação', mensagem: `Olá, Sr(a)! Segue a *Solicitação de Internação*, com as orientações para o dia da cirurgia. Leia com atenção.\n\n${ASSINATURA}` },
  // v48.93 — Depois do pagamento: pede o reembolso ao convênio, com a mesma
  // divisão de honorários do orçamento e o comprovante + a descrição cirúrgica
  // anexados à parte.
  // v48.119 — Texto corrigido a pedido do Jorge: a mensagem antiga dava a
  // entender que o comprovante e a descrição cirúrgica iam junto neste envio;
  // esta carta é só o documento de solicitação em si, para a paciente juntar
  // aos outros documentos e encaminhar ao convênio.
  reembolso: { rotulo: 'Reembolso', mensagem: `Olá, Sr(a)! Segue a *Carta de Solicitação de Reembolso*, para anexar aos demais documentos e encaminhar ao convênio.\n\n${ASSINATURA}` },
  // v48.97 — A orientação de quais remédios suspender e quando, resolvida
  // pela base do PausaMed e revisada aqui antes de gerar (ver aba Medicações).
  suspensao_medicamentos: { rotulo: 'Suspensão de medicamentos', mensagem: 'Segue a orientação sobre os medicamentos a suspender antes da sua cirurgia, e quando.' },
} as const
type Tipo = keyof typeof TIPOS

export default function DocumentosCirurgia({ cirurgiaId }: { cirurgiaId: string }) {
  const [tipo, setTipo] = useState<Tipo>('orcamento')
  const [listas, setListas] = useState<Lista[]>([])
  const [escolhidas, setEscolhidas] = useState<string[]>([])
  const [aberto, setAberto] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [temPaciente, setTemPaciente] = useState(false)
  const [anteriores, setAnteriores] = useState<Doc[]>([])
  const [gerado, setGerado] = useState<Doc | null>(null)
  const [mensagem, setMensagem] = useState('')
  // v48.97 — Quando falta prazo/explicação em algum medicamento, o "Gerar PDF"
  // fica travado: é a regra do PausaMed de nunca mandar orientação incompleta.
  const [medicamentosPendentes, setMedicamentosPendentes] = useState(0)
  const [medicamentosVazio, setMedicamentosVazio] = useState(false)
  // v48.100 — Aviso de que o material já veio marcado do link do cirurgião.
  const [materiaisDoCirurgiao, setMateriaisDoCirurgiao] = useState(false)
  // v48.119 — Para agrupar a lista de materiais por procedimento na tela, e
  // avisar quando um item se repete entre as listas escolhidas (ex.: BP e
  // CCC usando trocarte e agulha de Veress cada uma na sua lista).
  const [materiaisProcedimentos, setMateriaisProcedimentos] = useState<MaterialProcedimento[]>([])
  const [repetidos, setRepetidos] = useState<ItemRepetido[]>([])
  // Chaves (normalizadas) dos itens repetidos que a pessoa decidiu manter
  // duplicados mesmo assim — por padrão, tudo aqui fora dedupa para 1.
  const [manterDuplicados, setManterDuplicados] = useState<Set<string>>(new Set())
  // v48.118 — Quais tipos já têm pelo menos um documento enviado, pra colorir
  // o botão do tipo (fundo verde) assim que a tela abre, sem precisar clicar.
  const [enviados, setEnviados] = useState<Partial<Record<Tipo, boolean>>>({})
  // v48.137 — Modalidade da cirurgia (texto livre cadastrado em
  // Configurações → Cirurgias → Modalidades, ex. "PARTICULAR TOTAL",
  // "PARTICULAR COM CONVÊNIO"), só para decidir se o botão Reembolso fica
  // ativo — reembolso só faz sentido quando o paciente pagou particular E tem
  // convênio para pedir de volta.
  const [modalidade, setModalidade] = useState('')
  // v48.168 — Id do documento (ainda não enviado) sendo editado: ao gerar com
  // isto preenchido, o backend SUBSTITUI o mesmo registro em vez de empilhar
  // mais um na lista "Já gerados".
  const [substituirId, setSubstituirId] = useState('')

  async function chamar(metodo: 'GET' | 'POST', corpo?: any, busca = '') {
    let { data: { session } } = await supabase.auth.getSession()
    // v48.118 — "Não autorizado" ao clicar em Solicitação de cirurgia: o token
    // salvo no navegador tinha expirado (comum em aba aberta por muito tempo
    // ou rede instável — mesma causa-raiz do piscar online/offline da
    // Daniella, corrigido antes). getSession() já tenta renovar sozinho
    // quando o token venceu, mas só se o refresh token ainda for válido —
    // fazemos mais uma tentativa explícita de renovar antes de desistir, para
    // não devolver "Não autorizado" por causa de uma sessão só um pouco velha.
    if (!session?.access_token) {
      const { data } = await supabase.auth.refreshSession()
      session = data.session
    }
    const r = await fetch(`/api/cirurgias/${cirurgiaId}/documento${busca}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${session?.access_token || ''}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      if (r.status === 401) throw new Error('Sua sessão expirou. Atualize a página (F5) e entre novamente — depois disso tente de novo.')
      throw new Error(j.erro || `Erro ${r.status}`)
    }
    return j
  }

  async function carregarEnviados() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/cirurgias/${cirurgiaId}/documento?resumo=1`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok) { setEnviados(j.enviados || {}); setModalidade(String(j.modalidade || '')) }
    } catch { /* botão sem cor não trava a tela */ }
  }
  useEffect(() => { carregarEnviados() }, [cirurgiaId])

  // v48.137 — Mesmo jeito de reconhecer convênio pelo nome livre da
  // modalidade que o resto do CRM já usa (ver pedeCarteirinha em
  // CirurgiaModal.tsx e ehParticularTotal em app/api/cirurgias/[id]/documento).
  const particularComConvenio = /particular/i.test(modalidade) && /conv[êe]nio/i.test(modalidade)

  async function abrir(qual: Tipo, listasIds?: string[]) {
    setOcupado('abrir'); setErro(''); setAviso(''); setGerado(null)
    try {
      const qs = `?tipo=${qual}` + (listasIds?.length ? `&listas=${listasIds.join(',')}` : '')
      const j = await chamar('GET', undefined, qs)
      setTipo(qual)
      setTitulo(j.titulo); setTexto(j.texto); setTemPaciente(!!j.temPaciente)
      setAnteriores(j.anteriores || [])
      setListas(j.listas || []); setEscolhidas(j.listasUsadas || [])
      setMateriaisProcedimentos(j.materiaisProcedimentos || [])
      setRepetidos(j.materiaisRepetidos || [])
      setManterDuplicados(new Set())
      setMateriaisDoCirurgiao(!!j.materiaisDoCirurgiao)
      setMensagem(TIPOS[qual].mensagem)
      setMedicamentosPendentes(Number(j.medicamentosPendentes) || 0)
      setMedicamentosVazio(!!j.medicamentosVazio)
      setSubstituirId('')
      setAberto(true)
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  // v48.119 — Marcar/desmarcar a lista de materiais refaz o texto do zero, no
  // servidor. Remendar o texto na tela deixaria a edição manual e a troca de
  // lista brigando.
  //
  // Antes (v48.73) era um botão por procedimento, tipo rádio: escolher uma
  // trocava a anterior. Jorge pediu para virar caixa de marcar independente —
  // um procedimento pode ficar com 0, 1 ou mais listas marcadas (ex.:
  // desmarcar a "Padrão" da vesícula e manter só a "Panther" da BP, porque o
  // kit da Panther já cobre o que a Padrão traria). "listas=" vai sempre no
  // pedido, mesmo vazio — é o que diz ao servidor que a pessoa escolheu isso
  // de propósito, e não que a tela ainda não perguntou nada (ver route.ts).
  async function aplicarSelecao(novasEscolhidas: string[], manter: Set<string>) {
    setEscolhidas(novasEscolhidas)
    setOcupado('abrir'); setErro('')
    try {
      const qs = `?tipo=${tipo}&listas=${novasEscolhidas.join(',')}`
        + (manter.size ? `&manter=${Array.from(manter).map(encodeURIComponent).join(',')}` : '')
      const j = await chamar('GET', undefined, qs)
      setTexto(j.texto); setEscolhidas(j.listasUsadas ?? novasEscolhidas)
      setRepetidos(j.materiaisRepetidos || [])
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  function alternarLista(l: Lista) {
    const novas = escolhidas.includes(l.id) ? escolhidas.filter(id => id !== l.id) : [...escolhidas, l.id]
    aplicarSelecao(novas, manterDuplicados)
  }

  // "Manter duplicado" é por item (chave normalizada), não por lista: um
  // trocarte repetido pode ficar mantido enquanto a agulha de Veress, também
  // repetida, continua dedupada — cada um se resolve por si.
  function alternarManterDuplicado(chave: string) {
    const novo = new Set(manterDuplicados)
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave)
    setManterDuplicados(novo)
    aplicarSelecao(escolhidas, novo)
  }

  async function gerar() {
    setOcupado('gerar'); setErro('')
    try {
      const j = await chamar('POST', {
        acao: 'gerar', tipo, titulo, texto, listas: escolhidas,
        // v48.119 — Mesma decisão de manter/dedupar aplicada na hora de gerar,
        // não só na prévia — defesa extra caso o texto enviado não seja mais
        // o do último GET (ex.: campo editado à mão por cima).
        manterDuplicados: Array.from(manterDuplicados),
        // v48.168 — Presente só quando veio do botão "Editar" de um documento
        // ainda não enviado: substitui o registro em vez de criar um novo.
        substituirId: substituirId || undefined,
      })
      setGerado(j.documento)
      setAviso(substituirId ? 'Documento atualizado.' : 'PDF pronto.')
      setAnteriores(a => substituirId
        ? a.map(x => x.id === j.documento.id
            ? { ...x, titulo, texto, url: j.documento.url, nome_arquivo: j.documento.nome_arquivo, criado_em: j.documento.criado_em }
            : x)
        : a)
      setSubstituirId('')
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  // v48.168 — As três ações que faltavam num documento já gerado:
  //   editar  — carrega o título/texto SALVOS daquele documento para o editor
  //             de novo; "Gerar PDF" vira "Salvar alteração" e substitui o
  //             mesmo registro (ver gerar(), acima).
  //   apagar  — só funciona em quem ainda não foi enviado (regra do backend).
  //   reenviar — recarrega o documento já pronto no painel de envio, sem
  //             precisar gerar de novo.
  function editarAnterior(d: Doc) {
    setErro(''); setAviso(''); setGerado(null)
    setTitulo(d.titulo); setTexto(d.texto || '')
    setSubstituirId(d.id)
  }

  async function apagarAnterior(d: Doc) {
    if (!window.confirm(`Apagar "${d.nome_arquivo}"? Essa ação não pode ser desfeita.`)) return
    setOcupado('apagar'); setErro('')
    try {
      await chamar('POST', { acao: 'apagar', id: d.id })
      setAnteriores(a => a.filter(x => x.id !== d.id))
      if (gerado?.id === d.id) setGerado(null)
      if (substituirId === d.id) setSubstituirId('')
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  function reenviarAnterior(d: Doc) {
    setErro(''); setAviso(''); setSubstituirId('')
    setGerado({ id: d.id, titulo: d.titulo, url: d.url, nome_arquivo: d.nome_arquivo, criado_em: d.criado_em, enviado_em: d.enviado_em, valor: d.valor })
    setMensagem(TIPOS[tipo].mensagem)
  }

  async function enviar() {
    if (!gerado) return
    if (!window.confirm(`Enviar ${TIPOS[tipo].rotulo.toLowerCase()} ao paciente pelo WhatsApp?`)) return
    setOcupado('enviar'); setErro('')
    try {
      await chamar('POST', { acao: 'enviar', id: gerado.id, mensagem })
      setAviso('Enviado ao paciente.')
      setGerado(g => g ? { ...g, enviado_em: new Date().toISOString() } : g)
      setEnviados(e => ({ ...e, [tipo]: true }))
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  // v48.118 — A solicitação vai pro hospital por fora do CRM (não tem envio
  // por WhatsApp aqui) — este é o "carimbo manual" pra ela também poder
  // ficar com o botão verde depois que a secretária/médico já mandou.
  async function marcarEnviado() {
    if (!gerado) return
    setOcupado('marcar'); setErro('')
    try {
      await chamar('POST', { acao: 'marcar_enviado', id: gerado.id })
      setAviso('Marcado como enviado.')
      setGerado(g => g ? { ...g, enviado_em: new Date().toISOString() } : g)
      setEnviados(e => ({ ...e, [tipo]: true }))
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  // v48.137 — Pedido do Jorge: para a Solicitação (que vai pro hospital "por
  // fora"), um único botão "Gravar" que já baixa o PDF E marca como enviado —
  // sem precisar de um segundo clique em "marcar como enviado".
  async function gravar() {
    if (!gerado) return
    const a = document.createElement('a')
    a.href = gerado.url
    a.download = gerado.nome_arquivo
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    await marcarEnviado()
  }

  const campo = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <>
      {(Object.keys(TIPOS) as Tipo[]).map(t => {
        // v48.137 — Reembolso só se aplica a particular COM convênio (pagou e
        // vai pedir de volta) — nos outros casos (particular total, convênio
        // direto, via hospital) fica visivelmente inativo, sem abrir nada.
        const travadoPorModalidade = t === 'reembolso' && !particularComConvenio
        return (
          <button key={t} onClick={() => !travadoPorModalidade && abrir(t)} disabled={!!ocupado || travadoPorModalidade}
            title={travadoPorModalidade ? 'Reembolso só se aplica a paciente particular com convênio' : (enviados[t] ? 'Já enviado' : '')}
            className={'flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold shadow-sm disabled:opacity-50 '
              + (travadoPorModalidade
                ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                : enviados[t]
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100'
                  : 'border-brand-200 bg-white text-brand-700 hover:border-brand-400 hover:bg-brand-50')}>
            {ocupado === 'abrir' ? <Loader2 size={13} className="animate-spin"/>
              : enviados[t] ? <CheckCircle2 size={13}/> : <FileText size={13}/>} {TIPOS[t].rotulo}
          </button>
        )
      })}
      {erro && !aberto && <p className="text-[11px] text-red-600 mt-1">{erro}</p>}

      {aberto && (
        <div className="fixed inset-0 z-[60] bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-800">{titulo || TIPOS[tipo].rotulo}</p>
              <button onClick={() => setAberto(false)} className="p-1 text-slate-400"><X size={16}/></button>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto">
              {/* v48.168 — Vindo do botão "Editar" de um documento ainda não
                  enviado: ao gerar, substitui o mesmo registro em vez de
                  empilhar mais um na lista "Já gerados". */}
              {substituirId && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                  <span>Editando o documento já gerado — ao salvar, ele é substituído (não cria um novo).</span>
                  <button type="button" onClick={() => setSubstituirId('')} className="underline shrink-0">cancelar</button>
                </p>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Título</label>
                <input value={titulo} onChange={e => setTitulo(e.target.value)} className={campo}/>
              </div>
              {tipo === 'solicitacao' && materiaisDoCirurgiao && (
                <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0"/>
                  Material já definido pelo cirurgião ao agendar — confira abaixo antes de gerar.
                </p>
              )}
              {/* v48.73 — Lista de materiais.
                  v48.119 — Antes era um botão por procedimento, tipo rádio
                  (escolher uma trocava a anterior). Jorge pediu caixa de
                  marcar independente — um procedimento pode ficar com 0, 1
                  ou mais listas marcadas (ex.: desmarcar a "Padrão" da
                  vesícula e manter só a "Panther" da BP) — e, com 2+
                  procedimentos na cirurgia, deixar claro qual lista é de
                  qual, agrupando por procedimento. */}
              {tipo === 'solicitacao' && listas.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Lista de materiais</label>
                  <div className="space-y-2">
                    {(materiaisProcedimentos.length > 1
                      ? materiaisProcedimentos
                        .map(p => ({ proc: p, itens: listas.filter(l => l.procedimento_id === p.id) }))
                        .filter(g => g.itens.length)
                      : [{ proc: null as MaterialProcedimento | null, itens: listas }]
                    ).map((g, gi) => (
                      <div key={g.proc?.id ?? gi} className={g.proc ? 'bg-slate-50 rounded-lg px-2.5 py-1.5' : ''}>
                        {g.proc && <p className="text-[11px] font-semibold text-slate-500 mb-1">{g.proc.label}</p>}
                        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                          {g.itens.map(l => (
                            <label key={l.id} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                              <input type="checkbox" checked={escolhidas.includes(l.id)} disabled={!!ocupado}
                                onChange={() => alternarLista(l)} className="rounded"/>
                              {l.nome}{l.padrao ? ' ·' : ''}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Cadastre os padrões em Cad. Cirurgias → Cirurgias. Marcar ou desmarcar reescreve o texto abaixo.
                  </p>
                </div>
              )}

              {/* v48.119 — Item que aparece em mais de uma lista marcada (ex.:
                  trocarte e agulha de Veress repetidos entre BP e CCC) não
                  soma no texto — por padrão entra uma vez só. Aqui dá para
                  decidir manter as duas quando for mesmo o caso. */}
              {tipo === 'solicitacao' && repetidos.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1.5">
                  <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                    <AlertCircle size={13} className="shrink-0"/> Item repetido entre as listas marcadas
                  </p>
                  {repetidos.map(r => (
                    <label key={r.chave} className="flex items-start gap-1.5 text-[11px] text-amber-800 cursor-pointer">
                      <input type="checkbox" checked={manterDuplicados.has(r.chave)} disabled={!!ocupado}
                        onChange={() => alternarManterDuplicado(r.chave)} className="rounded mt-0.5 shrink-0"/>
                      <span>
                        <b>{r.linha}</b> está em {r.listas.map(x => x.nome).join(' e ')} —{' '}
                        {manterDuplicados.has(r.chave) ? 'mantendo as duas.' : 'entrando só uma vez no texto.'}{' '}
                        Marque para manter as duas.
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Texto — confira antes de gerar
                </label>
                <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={18}
                  className={campo + ' leading-5 font-mono text-[12px]'}/>
                <p className="text-[11px] text-slate-400 mt-1">
                  O PDF sai na folha timbrada do cirurgião do caso. O que estiver escrito aqui é o que vai impresso.
                </p>
              </div>

              {gerado && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5 space-y-2">
                  <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 size={13}/> {gerado.nome_arquivo}
                  </p>
                  {/* v48.137 — Pedido do Jorge: visualizar o PDF gerado ali mesmo
                      (janela sobreposta), não só um link que abre aba nova. */}
                  <div className="rounded-lg overflow-hidden border border-emerald-200 bg-white">
                    <iframe src={gerado.url} title={`Pré-visualização — ${TIPOS[tipo].rotulo}`} className="w-full h-72"/>
                  </div>
                  <a href={gerado.url} target="_blank" rel="noopener noreferrer"
                    className="inline-block text-xs font-semibold text-emerald-700 underline">abrir em nova aba</a>
                  {/* v48.96 — A solicitação de procedimento vai para o hospital,
                      não para o paciente: sem opção de enviar por WhatsApp aqui.
                      v48.137 — "Gravar" já baixa o PDF e marca como enviado num
                      clique só (antes eram dois passos separados). */}
                  {tipo === 'solicitacao' && !gerado.enviado_em && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[11px] text-slate-500">Este documento é para o hospital — grave e envie por fora do CRM.</p>
                      <button onClick={gravar} disabled={!!ocupado}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">
                        {ocupado === 'marcar' ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>} Gravar
                      </button>
                    </div>
                  )}
                  {tipo === 'solicitacao' && gerado.enviado_em && <p className="text-[11px] text-emerald-700">Gravado e marcado como enviado.</p>}
                  {/* v48.168 — "Reenviar" (abaixo, na lista "Já gerados") recarrega
                      um documento qualquer aqui, mesmo já enviado antes — por
                      isso o formulário de envio não trava mais só porque
                      enviado_em está preenchido; o aviso muda de texto, e o
                      botão vira "Enviar novamente". */}
                  {tipo !== 'solicitacao' && (
                    <div className="space-y-2 pt-1">
                      {gerado.enviado_em && (
                        <p className="text-[11px] text-emerald-700">
                          Enviado ao paciente em {new Date(gerado.enviado_em).toLocaleString('pt-BR')}.
                        </p>
                      )}
                      <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={2}
                        placeholder="Mensagem que vai antes do arquivo (deixe vazio para mandar só o PDF)"
                        className={campo + ' text-xs'}/>
                      <button onClick={enviar} disabled={!!ocupado || !temPaciente}
                        title={!temPaciente ? 'Cirurgia sem paciente vinculado ao CRM' : ''}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">
                        {ocupado === 'enviar' ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
                        {gerado.enviado_em ? 'Enviar novamente' : 'Enviar ao paciente'}
                      </button>
                      {!temPaciente && (
                        <p className="text-[11px] text-amber-700">
                          Vincule o paciente a um contato do CRM para poder enviar.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {anteriores.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Já gerados</p>
                  <ul className="space-y-1">
                    {anteriores.map(d => (
                      <li key={d.id} className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5">
                        <FileText size={12} className="text-slate-400 shrink-0"/>
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="truncate flex-1 underline">{d.nome_arquivo}</a>
                        <span className="text-slate-400 shrink-0">{new Date(d.criado_em).toLocaleDateString('pt-BR')}</span>
                        {d.enviado_em && <CheckCircle2 size={12} className="text-emerald-500 shrink-0"/>}
                        {/* v48.168 — Reenviar: recarrega este documento no painel de
                            envio acima, sem precisar gerar de novo. Editar/Apagar só
                            fazem sentido em quem ainda não foi enviado — depois de
                            enviado, o documento é o registro do que o paciente
                            recebeu e não pode mais mudar. */}
                        {tipo !== 'solicitacao' && (
                          <button type="button" onClick={() => reenviarAnterior(d)} disabled={!!ocupado}
                            title="Reenviar ao paciente" className="text-brand-600 hover:text-brand-800 shrink-0">
                            <Send size={12}/>
                          </button>
                        )}
                        {!d.enviado_em && (
                          <>
                            <button type="button" onClick={() => editarAnterior(d)} disabled={!!ocupado}
                              title="Editar" className="text-slate-500 hover:text-slate-800 shrink-0">
                              <Pencil size={12}/>
                            </button>
                            <button type="button" onClick={() => apagarAnterior(d)} disabled={!!ocupado}
                              title="Apagar" className="text-red-500 hover:text-red-700 shrink-0">
                              <Trash2 size={12}/>
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {tipo === 'suspensao_medicamentos' && (medicamentosVazio || medicamentosPendentes > 0) && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <AlertCircle size={13} className="mt-0.5 shrink-0"/>
                  {medicamentosVazio
                    ? 'Nenhuma medicação cadastrada ainda. Cadastre na aba Medicações desta cirurgia antes de gerar.'
                    : `${medicamentosPendentes} medicação(ões) sem prazo ou orientação definidos. Complete na aba Medicações antes de gerar.`}
                </p>
              )}

              {erro && <p className="text-xs text-red-600 flex items-start gap-1"><AlertCircle size={13} className="mt-0.5"/>{erro}</p>}
              {aviso && !erro && <p className="text-xs text-emerald-700">{aviso}</p>}
            </div>

            <div className="px-5 py-3 border-t border-slate-100">
              <button onClick={gerar}
                disabled={!!ocupado || !texto.trim() || (tipo === 'suspensao_medicamentos' && (medicamentosVazio || medicamentosPendentes > 0))}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-semibold disabled:opacity-50">
                {ocupado === 'gerar' ? <Loader2 size={15} className="animate-spin"/> : <FileText size={15}/>}
                {substituirId ? 'Salvar alteração' : gerado ? 'Gerar de novo' : 'Gerar PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
