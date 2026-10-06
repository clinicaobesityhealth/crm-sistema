'use client'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { useAcessoCirurgias } from '@/lib/acessoCirurgias'
import CirurgiaModal, { CIRURGIA_VAZIA, type Cirurgia } from '@/components/cirurgias/CirurgiaModal'
import TrocarSituacao from '@/components/cirurgias/TrocarSituacao'
import { Plus, Search, Loader2, Calendar, Scissors, AlertTriangle, BellRing, Check, X, RefreshCw, SlidersHorizontal, Pill } from 'lucide-react'
import clsx from 'clsx'
import { semAcento, contemTermo } from '@/lib/texto'
import { viaCurta } from '@/lib/viasCirurgia'
import { alertasDaCirurgia } from '@/lib/alertasCirurgia'
import { comNomeAtualDoContato } from '@/lib/nomeAtualPaciente'

// v48.03 — Agenda de cirurgias.
//
// A lista substitui as abas CIRURGIAS / REALIZADAS / CANCELADAS da planilha.
// A cirurgia não muda de lugar quando é realizada ou cancelada: muda de
// categoria, e o filtro aqui decide o que aparece. Assim o histórico do
// paciente não se parte em três.

type Linha = Cirurgia & {
  id: string; cor?: string; created_at?: string; msg_preop_enviada_em?: string | null
  carimbo_origem?: string | null; updated_at?: string | null
  // v48.148 — O cirurgião aprovou o plano de suspensão pelo link dele, antes
  // mesmo de a secretaria gerar o PDF (ver alertaMedicacao, abaixo).
  suspensao_medicamentos_aprovada?: boolean | null; suspensao_medicamentos_aprovada_em?: string | null
}

// A legenda dos alertas, na mesma ordem em que a cirurgia caminha. Fica aqui
// para não haver duas listas — esta e a da cabeça de quem lê a tela.
const LEGENDA: [string, string][] = [
  ['😀', 'Em pré-operatório há menos de 1 mês'],
  ['⏰', 'Em pré-operatório há mais de 1 mês'],
  ['📅', 'Para agendar'],
  ['📞', 'Mais de 1 dia aguardando agendamento'],
  ['📜', 'Aguardando documentos'],
  ['⚠️', 'Faltam 5 dias úteis ou menos para o prazo de 21 dias úteis'],
  ['⌛', 'Ultrapassou os 21 dias úteis'],
  ['🚨', 'Pendência não resolvida'],
  ['🕵🏼', 'Relatório de pendência enviado'],
  ['📨', 'Mensagens automáticas já enviadas ao paciente (quantas e a última data)'],
  ['😶', 'Paciente indeciso'],
  ['✔️', 'Autorizada'],
  ['❌', 'Cancelada ou negada pelo convênio'],
  ['riscado', 'Cirurgia realizada'],
]

const TOM_CLASSE: Record<string, string> = {
  neutro:  'bg-slate-100 text-slate-600',
  ok:      'bg-emerald-50 text-emerald-700',
  atencao: 'bg-amber-50 text-amber-700',
  urgente: 'bg-red-50 text-red-700',
}
type Situacao = { nome: string; cor: string; categoria: string; ordem: number }

// Regra das pendências, herdada do script da planilha: cirurgia lançada há mais
// de 30 dias, ainda em andamento, sem ninguém ter registrado contato de
// pré-operatório. Na planilha isso era um botão que a secretária lembrava (ou
// não) de apertar, e o resultado saía num popup para copiar e colar.
const DIAS_PENDENCIA = 30

function ehPendencia(l: Linha) {
  if ((l.categoria || 'aberta') !== 'aberta') return false
  if (l.msg_preop_enviada_em) return false
  if (!l.created_at) return false
  const dias = (Date.now() - new Date(l.created_at).getTime()) / 86400000
  return dias >= DIAS_PENDENCIA
}

const FILTROS = [
  { id: 'aberta',    label: 'Em andamento' },
  { id: 'realizada', label: 'Realizadas' },
  { id: 'cancelada', label: 'Canceladas' },
  { id: 'pendencia', label: 'Pendências' },
  { id: 'todas',     label: 'Todas' },
]

const brl = (v: number | null) => v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function dataBr(d: string | null) {
  if (!d) return 'sem data'
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}

// v48.136 — useSearchParams (link direto de "Abrir cirurgias" no card de
// aviso, ver mais abaixo) exige um limite de Suspense em volta no App Router.
export default function CirurgiasPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-slate-400 text-sm">Carregando...</div>}>
      <CirurgiasPageInner/>
    </Suspense>
  )
}

function CirurgiasPageInner() {
  // Esconder o item do menu não basta: quem souber o endereço entraria assim
  // mesmo. A tela também recusa.
  const veCirurgias = useAcessoCirurgias()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [linhas, setLinhas] = useState<Linha[]>([])
  const [cores, setCores] = useState<Record<string, string>>({})
  const [enviadas, setEnviadas] = useState<Record<string, { n: number; ultima: string }>>({})
  const [situacoes, setSituacoes] = useState<Situacao[]>([])
  // v48.106 — Alergia dos pacientes, por contact_id. Traz só quem está
  // marcado como alérgico (lista curta) em vez de casar um por um com as
  // cirurgias carregadas — mais simples e cobre a lista inteira de uma vez.
  const [alergias, setAlergias] = useState<Record<string, { alergico: boolean; alergia_obs: string | null }>>({})
  const [verAlergiaId, setVerAlergiaId] = useState<string | null>(null)
  // v48.122 — Medicamentos estruturados de cada cirurgia (aba Medicações), só
  // o id e o status: é o que decide o alerta "revisar remédio" no cartão —
  // ver medsPorCirurgia mais abaixo.
  const [medicamentos, setMedicamentos] = useState<{ cirurgia_id: string; status: string }[]>([])
  // v48.122 — Igual a "aberta", mas junto de UM flag: veio do alerta de
  // medicação? Se veio, o modal já abre rolado na seção de Medicações — ver
  // focarMedicamentos em CirurgiaModal.tsx.
  const [focarMedicamentos, setFocarMedicamentos] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [filtro, setFiltro] = useState('aberta')
  const [busca, setBusca] = useState('')
  const [fHospital, setFHospital] = useState('')
  const [fCirurgiao, setFCirurgiao] = useState('')
  const [fProcedimento, setFProcedimento] = useState('')
  const [fSituacao, setFSituacao] = useState('')
  const [aberta, setAberta] = useState<Cirurgia | null>(null)
  const [trocando, setTrocando] = useState<Linha | null>(null)
  const [desfazerPago, setDesfazerPago] = useState<Linha | null>(null)
  const [verLegenda, setVerLegenda] = useState(false)
  // v48.48 — No celular, os quatro filtros ocupavam meia tela antes de
  // aparecer a primeira cirurgia. Eles continuam ali, mas fechados: quem
  // precisa filtrar abre; quem só quer ver a lista, vê a lista.
  const [verFiltros, setVerFiltros] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [avisoSync, setAvisoSync] = useState('')

  useEffect(() => { carregar() }, [])

  // v48.136 — Link direto "?abrir=<id>" (do card de aviso "Revisar medicações
  // da cirurgia" — ver AvisoCirurgiaNotification.tsx). linhas já traz TODAS as
  // cirurgias (o filtro de aba é só client-side, ver carregar() logo abaixo),
  // então basta achar o id aqui, sem precisar de outra consulta. Limpa o
  // parâmetro da URL depois de abrir, para um refresh não reabrir sozinho.
  useEffect(() => {
    const alvo = searchParams.get('abrir')
    if (!alvo || carregando) return
    const l = linhas.find(x => x.id === alvo)
    if (l) abrir(l, true)
    router.replace('/cirurgias')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, carregando, linhas])

  async function carregar() {
    setCarregando(true)
    const [c, s, av, ag, al, med] = await Promise.all([
      supabase.from('cirurgias').select('*').order('data_cirurgia', { ascending: true, nullsFirst: false }),
      supabase.from('cirurgia_status').select('nome, cor, categoria, ordem').order('ordem'),
      // v48.83 — O que já foi enviado a cada paciente, para o cartão avisar e
      // ninguém cobrar duas vezes a mesma coisa.
      supabase.from('cirurgia_avisos').select('cirurgia_id, decidido_em').eq('status', 'enviado'),
      supabase.from('scheduled_messages').select('cirurgia_id, scheduled_for').eq('status', 'sent').not('cirurgia_id', 'is', null),
      // v48.106 — Alergia, por contact_id, só de quem está marcado.
      supabase.from('contacts').select('id, alergico, alergia_obs').eq('alergico', true),
      // v48.122 — Medicamentos estruturados (aba Medicações), para o alerta
      // "revisar remédio"/"revisado pelo médico" no cartão.
      supabase.from('cirurgia_medicamentos').select('cirurgia_id, status'),
    ])
    setMedicamentos((med.data ?? []) as { cirurgia_id: string; status: string }[])
    const mapaAlergia: Record<string, { alergico: boolean; alergia_obs: string | null }> = {}
    for (const x of (al.data ?? []) as any[]) mapaAlergia[x.id] = { alergico: !!x.alergico, alergia_obs: x.alergia_obs }
    setAlergias(mapaAlergia)
    const env: Record<string, { n: number; ultima: string }> = {}
    const soma = (id: string, quando: string | null) => {
      if (!id) return
      const atual = env[id] || { n: 0, ultima: '' }
      atual.n += 1
      if (quando && quando > atual.ultima) atual.ultima = quando
      env[id] = atual
    }
    for (const x of (av.data ?? []) as any[]) soma(x.cirurgia_id, x.decidido_em)
    for (const x of (ag.data ?? []) as any[]) soma(x.cirurgia_id, x.scheduled_for)
    setEnviadas(env)
    setLinhas(await comNomeAtualDoContato((c.data ?? []) as Linha[]))
    const mapa: Record<string, string> = {}
    for (const x of (s.data ?? []) as any[]) mapa[x.nome] = x.cor
    setCores(mapa)
    setSituacoes((s.data ?? []) as Situacao[])
    setCarregando(false)
  }

  // Os filtros são aplicados em duas etapas de propósito.
  //
  // Primeiro tudo menos a situação — busca, hospital, cirurgião, cirurgia.
  // Sobre ESSE resultado é que os números das abas são contados: assim,
  // filtrando pelo Blanc, cada aba mostra quantas cirurgias do Blanc estão em
  // cada estado. Contar sobre a lista inteira daria números que não têm nada a
  // ver com o que está na tela.
  const baseFiltrada = useMemo(() => {
    // Mesma regra da tela de Contatos: ignora acento e caixa.
    const q = semAcento(busca)
    return linhas.filter(l => {
      if (fHospital && (l.hospital || '') !== fHospital) return false
      if (fCirurgiao && (l.cirurgiao || '') !== fCirurgiao) return false
      if (fProcedimento && (l.procedimento_sigla || '') !== fProcedimento) return false
      return contemTermo(q, l.paciente_nome, l.procedimento_sigla, l.procedimento_nome, l.hospital, l.cirurgiao)
    })
  }, [linhas, busca, fHospital, fCirurgiao, fProcedimento])

  const preFiltradas = useMemo(
    () => fSituacao ? baseFiltrada.filter(l => (l.status || '') === fSituacao) : baseFiltrada,
    [baseFiltrada, fSituacao])

  const contagens = useMemo(() => ({
    aberta:    preFiltradas.filter(l => (l.categoria || 'aberta') === 'aberta').length,
    realizada: preFiltradas.filter(l => l.categoria === 'realizada').length,
    cancelada: preFiltradas.filter(l => l.categoria === 'cancelada').length,
    pendencia: preFiltradas.filter(ehPendencia).length,
    todas:     preFiltradas.length,
  }), [preFiltradas])

  const visiveis = useMemo(() => {
    const lista = preFiltradas.filter(l => {
      if (filtro === 'pendencia') return ehPendencia(l)
      if (filtro === 'todas') return true
      return (l.categoria || 'aberta') === filtro
    })

    // A ordem muda conforme o que a lista é.
    //
    // Em andamento é uma AGENDA: o que interessa é a próxima cirurgia, então vai
    // da mais próxima para a mais distante, e as sem data ficam no fim — elas
    // não competem por atenção, estão esperando marcação.
    //
    // Realizadas e canceladas são HISTÓRICO: olha-se o que houve por último,
    // então a mais recente vem primeiro.
    const historico = filtro === 'realizada' || filtro === 'cancelada'

    return lista.slice().sort((a, b) => {
      const da = a.data_cirurgia || ''
      const db = b.data_cirurgia || ''
      // Sem data sempre por último, nos dois sentidos: uma cirurgia sem data
      // no topo do histórico seria tão fora de lugar quanto no topo da agenda.
      if (!da && !db) return (a.paciente_nome || '').localeCompare(b.paciente_nome || '')
      if (!da) return 1
      if (!db) return -1
      if (da === db) return (a.hora || '').localeCompare(b.hora || '')
      return historico ? db.localeCompare(da) : da.localeCompare(db)
    })
  }, [preFiltradas, filtro])

  // As opções vêm do que existe nas cirurgias, não do cadastro inteiro: não
  // adianta oferecer um hospital onde nunca se operou.
  const opcoes = useMemo(() => {
    const unicos = (campo: (l: Linha) => string) =>
      Array.from(new Set(linhas.map(campo).filter(Boolean))).sort((a, b) => a.localeCompare(b))
    return {
      hospitais: unicos(l => l.hospital || ''),
      cirurgioes: unicos(l => l.cirurgiao || ''),
      procedimentos: unicos(l => l.procedimento_sigla || ''),
    }
  }, [linhas])

  // As situações vêm na ordem cadastrada, não em ordem alfabética: PRÉ-OPERATÓRIO,
  // AGENDAR, SOLICITADO, AUTORIZADA... é a ordem em que a cirurgia caminha, e
  // procurar nela é mais rápido do que procurar num alfabeto.
  const opcoesSituacao = useMemo(() => {
    const conta: Record<string, number> = {}
    for (const l of baseFiltrada) conta[l.status || ''] = (conta[l.status || ''] || 0) + 1
    const cadastradas = situacoes.map(x => x.nome)
    // Situação que existe em alguma cirurgia mas não está mais no cadastro
    // continua aparecendo — senão essas cirurgias ficariam inalcançáveis.
    const orfas = Object.keys(conta).filter(n => n && !cadastradas.includes(n))
    return [...cadastradas, ...orfas]
      .map(nome => ({ nome, n: conta[nome] || 0 }))
      .filter(x => x.n > 0)
  }, [situacoes, baseFiltrada])

  // Escolher uma situação leva junto para a aba certa. Sem isso, escolher
  // CIRURGIA REALIZADA estando em "Em andamento" daria uma lista vazia, e a
  // conclusão natural seria que o filtro não funciona.
  function escolherSituacao(nome: string) {
    setFSituacao(nome)
    if (!nome) return
    const cat = situacoes.find(x => x.nome === nome)?.categoria
    if (cat && filtro !== 'todas' && filtro !== cat) setFiltro(cat)
  }

  const temFiltro = !!(fHospital || fCirurgiao || fProcedimento || fSituacao || busca.trim())
  function limparFiltros() {
    setFHospital(''); setFCirurgiao(''); setFProcedimento(''); setFSituacao(''); setBusca('')
  }

  const pendencias = useMemo(() => linhas.filter(ehPendencia).length, [linhas])

  // v48.122 — Agrupa os medicamentos por cirurgia uma vez só, para o cartão
  // não filtrar a lista inteira a cada linha renderizada.
  const medsPorCirurgia = useMemo(() => {
    const mapa: Record<string, string[]> = {}
    for (const m of medicamentos) (mapa[m.cirurgia_id] ??= []).push(m.status)
    return mapa
  }, [medicamentos])

  // O alerta de medicação do cartão: null quando o paciente não usa remédio
  // (nem texto livre, nem lista estruturada); 'pendente' quando ainda falta
  // trabalho — texto livre não importado, ou algum remédio sem prazo/
  // explicação definidos; 'revisado' quando TODOS já têm prazo e explicação
  // (o médico já revisou — via PausaMed/base/IA ou digitando à mão, status
  // 'resolvido'/'manual' em MedicamentosCirurgia.tsx), mas o documento de
  // suspensão ainda não foi gerado; 'enviado' quando todos estão 'aprovado'
  // (documento gerado — é isso que aprova e agenda o lembrete, v48.132).
  //
  // v48.136 — Antes só existia 'revisado' (=aprovado) e 'pendente' pra tudo
  // mais, então um remédio já revisado pelo médico (prazo e explicação
  // prontos, só faltando gerar o PDF) aparecia com o mesmo aviso amarelo de
  // "ainda nem foi olhado" — pedido do Jorge pra separar os dois casos.
  //
  // v48.148 — Novo estado intermediário 'aprovado_medico': o CIRURGIÃO já
  // apertou "Aprovar suspensão de medicamentos" no link dele
  // (suspensao_medicamentos_aprovada), mas a secretaria ainda não gerou o
  // PDF (que é o que trava cada remédio em status='aprovado' e dispara o
  // lembrete de véspera). Fica entre 'revisado' e 'enviado' na ordem de
  // "quão pronto está": 'enviado' continua tendo prioridade — se o PDF já
  // foi gerado, o trabalho terminou, mesmo que a aprovação do médico (que já
  // cumpriu seu papel) tenha ficado registrada antes.
  function alertaMedicacao(l: Linha): 'enviado' | 'aprovado_medico' | 'revisado' | 'pendente' | null {
    const statuses = medsPorCirurgia[l.id]
    const temTextoLivre = !!(l.medicacoes || '').trim()
    if (!statuses?.length && !temTextoLivre) return null
    if (!statuses?.length) return 'pendente'
    if (statuses.every(s => s === 'aprovado')) return 'enviado'
    if (l.suspensao_medicamentos_aprovada) return 'aprovado_medico'
    if (statuses.every(s => s === 'aprovado' || s === 'resolvido' || s === 'manual')) return 'revisado'
    return 'pendente'
  }

  // Registra que alguém já falou com o paciente. Equivale ao ✔ que a secretária
  // põe na coluna da planilha, com a diferença de guardar QUANDO foi.
  async function marcarContato(l: Linha, e: React.MouseEvent) {
    e.stopPropagation()
    const { error } = await supabase.from('cirurgias')
      .update({ msg_preop_enviada_em: new Date().toISOString() }).eq('id', l.id)
    if (error) { alert('Não foi possível marcar: ' + error.message); return }
    carregar()
  }

  // v48.111 — "Pago" direto no card, sem abrir a edição. Marcar não tem risco
  // (clicou errado, desmarca na hora); desmarcar um pagamento já confirmado
  // exige a senha administrativa — abre o mesmo prompt usado em Configurações
  // → Sofia (ver DesfazerPagoModal, no fim do arquivo).
  async function marcarPago(l: Linha, e: React.MouseEvent) {
    e.stopPropagation()
    if (l.pago) { setDesfazerPago(l); return }
    const { error } = await supabase.from('cirurgias').update({ pago: true }).eq('id', l.id)
    if (error) { alert('Não foi possível marcar como pago: ' + error.message); return }
    carregar()
  }

  // Sincroniza com a planilha na hora, em vez de esperar a rodada de 15 minutos.
  // Útil depois de mexer na planilha, ou antes de conferir alguma coisa.
  async function sincronizarAgora() {
    setSincronizando(true); setAvisoSync('')
    try {
      const r = await fetch('/api/cirurgias/sync/disparar', { method: 'POST' })
      const texto = await r.text()
      let j: any = null
      try { j = texto ? JSON.parse(texto) : null } catch {}

      if (!j) { setAvisoSync(`Não consegui sincronizar agora (erro ${r.status}).`); return }
      if (!r.ok) { setAvisoSync(j.erro || 'Não consegui sincronizar agora.'); return }

      const x = j.resumo || {}
      const partes: string[] = []
      if (x.cirurgias_criadas_no_crm) partes.push(`${x.cirurgias_criadas_no_crm} trazida(s) da planilha`)
      if (x.linhas_a_atualizar) partes.push(`${x.linhas_a_atualizar} linha(s) ${x.ESCREVEU_NA_PLANILHA ? 'atualizada(s)' : 'a atualizar'}`)
      if (x.linhas_a_incluir) partes.push(`${x.linhas_a_incluir} linha(s) ${x.ESCREVEU_NA_PLANILHA ? 'incluída(s)' : 'a incluir'}`)
      if (x.ESCREVEU_NA_PLANILHA === false) partes.push('escrita na planilha ainda desligada')

      setAvisoSync(partes.length ? 'Pronto — ' + partes.join(', ') + '.' : 'Pronto. Nada mudou desde a última vez.')
      carregar()
    } catch (e: any) {
      setAvisoSync('Não consegui sincronizar agora: ' + (e?.message || e))
    } finally {
      setSincronizando(false)
    }
  }

  function abrir(l?: Linha, focarMeds = false) {
    setAberta(l ? { ...CIRURGIA_VAZIA, ...l } : { ...CIRURGIA_VAZIA })
    setFocarMedicamentos(focarMeds)
  }

  if (veCirurgias === false) {
    return (
      <div className="flex h-screen bg-surface overflow-hidden">
        <Sidebar/>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <p className="text-sm font-semibold text-slate-700">Agenda cirúrgica</p>
            <p className="text-xs text-slate-400 mt-1">
              Seu cargo não tem acesso a esta área. Se precisar entrar, peça a um administrador
              para liberar em Configurações → Cargos.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Cirurgias</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {visiveis.length} na lista
              {pendencias > 0 && filtro !== 'pendencia' && (
                <button onClick={() => setFiltro('pendencia')} className="ml-2 text-amber-600 font-semibold">
                  · {pendencias} sem contato há mais de {DIAS_PENDENCIA} dias
                </button>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={sincronizarAgora} disabled={sincronizando}
              title="Sincronizar com a planilha agora, sem esperar os 15 minutos"
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw size={15} className={sincronizando ? 'animate-spin' : ''}/>
              <span className="hidden sm:inline">{sincronizando ? 'Sincronizando...' : 'Atualizar planilha'}</span>
            </button>
            <button onClick={() => abrir()}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold flex items-center gap-1.5">
              <Plus size={15}/> <span className="hidden sm:inline">Nova cirurgia</span>
            </button>
          </div>
        </div>

        <div className="px-6 py-4">
          {avisoSync && (
            <div className="mb-3 flex items-start gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="flex-1 text-xs text-slate-600">{avisoSync}</p>
              <button onClick={() => setAvisoSync('')} className="text-slate-400"><X size={13}/></button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300"/>
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por paciente, cirurgia, hospital ou cirurgião..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
            </div>
            {/* A faixa rola de ponta a ponta no celular: sem as margens
                negativas ela era cortada pelo respiro da página, e a última
                aba parecia quebrada em vez de "tem mais para o lado". */}
            <div className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-0.5">
              {FILTROS.map(x => {
                const n = contagens[x.id as keyof typeof contagens] ?? 0
                const ativo = filtro === x.id
                return (
                  <button key={x.id} onClick={() => setFiltro(x.id)}
                    className={clsx('px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5',
                      ativo ? 'bg-brand-500 text-white' : 'bg-white border border-slate-200 text-slate-500',
                      !ativo && n === 0 && 'opacity-50')}>
                    {x.label}
                    {/* O número em cada aba evita a pergunta "cadê as cirurgias?"
                        quando elas estão ali do lado, em outra situação. */}
                    <span className={clsx('px-1.5 rounded-full text-[10px]',
                      ativo ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>{n}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Barra compacta, só no celular: abre os filtros, a legenda e limpa. */}
          <div className="flex sm:hidden items-center gap-2 mb-3">
            <button onClick={() => setVerFiltros(v => !v)}
              className={clsx('flex-1 px-3 py-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5',
                temFiltro ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-500')}>
              <SlidersHorizontal size={13}/>
              {verFiltros ? 'Fechar filtros' : temFiltro ? 'Filtros aplicados' : 'Filtrar'}
            </button>
            <button onClick={() => setVerLegenda(v => !v)}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 shrink-0">
              Legenda
            </button>
            {temFiltro && (
              <button onClick={limparFiltros}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 shrink-0 flex items-center gap-1">
                <X size={13}/> Limpar
              </button>
            )}
          </div>

          <div className={clsx('grid grid-cols-2 gap-2 mb-4 sm:flex sm:flex-row sm:flex-wrap',
            verFiltros ? 'grid' : 'hidden sm:flex')}>
            <select value={fHospital} onChange={e => setFHospital(e.target.value)}
              className="flex-1 sm:min-w-[170px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Todos os hospitais</option>
              {opcoes.hospitais.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <select value={fCirurgiao} onChange={e => setFCirurgiao(e.target.value)}
              className="flex-1 sm:min-w-[170px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Todos os cirurgiões</option>
              {opcoes.cirurgioes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={fProcedimento} onChange={e => setFProcedimento(e.target.value)}
              className="flex-1 sm:min-w-[170px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Todas as cirurgias</option>
              {opcoes.procedimentos.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={fSituacao} onChange={e => escolherSituacao(e.target.value)}
              className="flex-1 sm:min-w-[170px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Todas as situações</option>
              {opcoesSituacao.map(x => <option key={x.nome} value={x.nome}>{x.nome} ({x.n})</option>)}
            </select>
            <button onClick={() => setVerLegenda(v => !v)}
              className="hidden sm:block px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 shrink-0">
              Legenda
            </button>
            {temFiltro && (
              <button onClick={limparFiltros}
                className="hidden sm:flex px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-500 items-center justify-center gap-1 shrink-0">
                <X size={13}/> Limpar
              </button>
            )}
          </div>

          {verLegenda && (
            <div className="bg-white border border-slate-100 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs font-semibold text-slate-600 mb-2">O que cada marca quer dizer</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {LEGENDA.map(([e, t]) => (
                  <div key={t} className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="w-6 shrink-0 text-center">
                      {e === 'riscado' ? <span className="line-through text-slate-400">abc</span> : e}
                    </span>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          )}

          {carregando ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-10"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
          ) : visiveis.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-xl px-5 py-10 text-center">
              <Scissors size={26} className="text-slate-200 mx-auto mb-3"/>
              <p className="text-sm text-slate-500">Nenhuma cirurgia nesta lista.</p>
              <p className="text-xs text-slate-400 mt-1">Use "Nova cirurgia" para lançar a primeira.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visiveis.map(l => (
                <button key={l.id} onClick={() => abrir(l)}
                  className="w-full text-left bg-white border border-slate-100 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 hover:border-slate-200 transition-colors">
                  {/* v48.71 — No celular a data e a situação saem da linha do
                      nome e vão para uma faixa em cima.
                      A caixa de data (58px) mais o selo da situação ("PRÉ-
                      OPERATÓRIO" tem 14 letras) comiam metade da largura da
                      tela, e o nome do paciente descia em três linhas de duas
                      palavras. Em cima, cada um fica com a linha inteira. */}
                  <div className="flex items-center justify-between gap-2 mb-1.5 sm:hidden">
                    <span className="inline-flex items-center gap-1.5 bg-slate-50 rounded-md px-2 py-1 shrink-0">
                      <Calendar size={11} className="text-slate-300"/>
                      <span className="text-[11px] font-bold text-slate-600 tabular-nums">{dataBr(l.data_cirurgia)}</span>
                      {l.hora && <span className="text-[11px] text-slate-400 tabular-nums">{l.hora.slice(0, 5)}</span>}
                    </span>
                    <span
                      onClick={e => { e.stopPropagation(); setTrocando(l) }}
                      className="text-[10px] font-bold px-2 py-1 rounded-full text-white cursor-pointer truncate max-w-[55%]"
                      style={{ background: cores[l.status] || '#64748b' }}>
                      {l.status}
                    </span>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="hidden sm:flex flex-col items-center justify-center bg-slate-50 rounded-lg px-2.5 py-1.5 shrink-0 min-w-[58px]">
                      <Calendar size={12} className="text-slate-300 mb-0.5"/>
                      <span className="text-xs font-bold text-slate-600 leading-none">{dataBr(l.data_cirurgia)}</span>
                      {l.hora && <span className="text-[10px] text-slate-400 mt-0.5">{l.hora.slice(0, 5)}</span>}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* v48.20 — Os mesmos alertas da coluna ALERTAS da planilha.
                            Aqui podem aparecer mais de um: a situação e o relógio
                            dos 21 dias úteis são coisas diferentes, e esconder uma
                            atrás da outra é o que faz um prazo passar batido. */}
                        {(() => {
                          const { alertas, tachado } = alertasDaCirurgia(l)
                          return (
                            <>
                              {alertas.map((a, i) => (
                                <span key={i} title={a.texto}
                                  className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ' + (TOM_CLASSE[a.tom] || TOM_CLASSE.neutro)}>
                                  <span className="text-xs leading-none">{a.emoji}</span>
                                </span>
                              ))}
                              <span className={'text-sm font-semibold leading-snug break-words ' + (tachado ? 'text-slate-400 line-through' : 'text-slate-800')}>
                                {l.paciente_nome}
                              </span>
                              {l.contact_id && alergias[l.contact_id]?.alergico && (
                                // span, não button: este cartão inteiro já é um
                                // <button>, e button dentro de button quebra o HTML.
                                <span
                                  onClick={e => { e.stopPropagation(); setVerAlergiaId(id => id === l.id ? null : l.id) }}
                                  title="Clique para ver onde a alergia está anotada"
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold cursor-pointer">
                                  <AlertTriangle size={10}/> ALÉRGICO(A)
                                </span>
                              )}
                            </>
                          )
                        })()}
                        {/* v48.59 — descrição cirúrgica chegou e ainda não foi ao paciente */}
                        {Array.isArray((l as any).rgo_arquivos) && (l as any).rgo_arquivos.length > 0 && !(l as any).rgo_enviada_paciente_em && (
                          <span title="Descrição cirúrgica recebida — enviar ao paciente para o reembolso"
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-700">
                            📄 RGO a enviar
                          </span>
                        )}
                        {/* v48.83 — Quantas mensagens este paciente já recebeu, e
                            quando foi a última. Abrindo a cirurgia dá para ver
                            quais foram. Sem a marca, a equipe repete a cobrança. */}
                        {enviadas[l.id] && (
                          <span title={`${enviadas[l.id].n} mensagem(ns) automática(s) já enviada(s) — abra a cirurgia para ver quais`}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-sky-100 text-sky-700">
                            📨 {enviadas[l.id].n}
                            {enviadas[l.id].ultima
                              ? ' · ' + new Date(enviadas[l.id].ultima).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                              : ''}
                          </span>
                        )}
                        {!l.contact_id && (
                          <span title="Sem vínculo com o cadastro do CRM" className="flex items-center gap-1 text-[11px] text-amber-600">
                            <AlertTriangle size={11}/> sem cadastro
                          </span>
                        )}
                        {/* v48.122 — Paciente em uso de medicamento: verde e
                            "revisado pelo médico" quando a lista já está 100%
                            aprovada (ver MedicamentosCirurgia.tsx); âmbar
                            pedindo revisão/busca (PausaMed/base da clínica/IA)
                            nos outros casos. Clicar abre a cirurgia já rolada
                            na aba Medicações, sem abrir o resto do cadastro. */}
                        {(() => {
                          const alerta = alertaMedicacao(l)
                          if (!alerta) return null
                          if (alerta === 'enviado') return (
                            <span onClick={e => { e.stopPropagation(); abrir(l, true) }}
                              title="Medicação revisada e aprovada — suspensão programada/enviada ao paciente"
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-700 cursor-pointer">
                              <Pill size={11}/> Suspensão de Remédio enviada
                            </span>
                          )
                          if (alerta === 'aprovado_medico') return (
                            // v48.148 — O cirurgião já apertou "Aprovar" no link
                            // dele; falta só a secretaria gerar o PDF (que
                            // trava cada remédio e dispara o lembrete).
                            <span onClick={e => { e.stopPropagation(); abrir(l, true) }}
                              title="O médico já aprovou a suspensão pelo link dele — falta gerar e enviar o documento"
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 cursor-pointer">
                              <Pill size={11}/> médico aprovou suspensão
                            </span>
                          )
                          if (alerta === 'revisado') return (
                            <span onClick={e => { e.stopPropagation(); abrir(l, true) }}
                              title="Médico já revisou (prazo e explicação prontos) — falta gerar e enviar o documento de suspensão"
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-sky-100 text-sky-700 cursor-pointer">
                              <Pill size={11}/> revisado pelo médico
                            </span>
                          )
                          return (
                            <span onClick={e => { e.stopPropagation(); abrir(l, true) }}
                              title="Paciente em uso de medicamento — buscar prazo de suspensão (PausaMed/base da clínica/IA)"
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-700 cursor-pointer">
                              <Pill size={11}/> revisar remédio
                            </span>
                          )
                        })()}
                        {ehPendencia(l) && (
                          <span
                            onClick={e => marcarContato(l, e)}
                            title="Marcar que já houve contato com o paciente"
                            className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 font-semibold cursor-pointer hover:bg-amber-100">
                            <BellRing size={10}/> sem contato há +{DIAS_PENDENCIA} dias
                            <Check size={10} className="opacity-60"/>
                          </span>
                        )}
                      </div>
                      {l.contact_id && alergias[l.contact_id]?.alergico && verAlergiaId === l.id && (
                        <p className="text-[11px] text-red-800 bg-red-50 border border-red-100 rounded-md px-2 py-1 mt-1">
                          <span className="font-semibold">Alergia anotada no cadastro do paciente: </span>
                          {alergias[l.contact_id]?.alergia_obs?.trim() || 'nada escrito — só marcado como alérgico(a), sem detalhe.'}
                        </p>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                        {l.procedimento_sigla ? (
                          // Sigla sem procedimento vinculado: o texto veio da planilha
                          // mas não casou com nenhum cadastro, então valores e materiais
                          // ficaram sem base. Melhor gritar do que fingir que está certo.
                          <span className={l.procedimento_id ? 'font-semibold text-brand-600' : 'font-semibold text-amber-600'}
                            title={l.procedimento_id ? '' : 'Esta sigla não corresponde a nenhuma cirurgia cadastrada — abra e escolha a correta'}>
                            {l.procedimento_sigla}{!l.procedimento_id && ' ⚠'}
                          </span>
                        ) : null}
                        {/* v48.25 — A via não é detalhe: robótica, vídeo e
                            convencional mudam material, tempo de sala e valor.
                            Estava escondida dentro da abreviação. */}
                        {(l as any).via_acesso && (
                          <span className="text-slate-400"> · {viaCurta((l as any).via_acesso)}</span>
                        )}
                        {l.procedimento_sigla && ' · '}
                        {l.hospital || 'sem hospital'}
                        {l.cirurgiao && ` · ${l.cirurgiao}`}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 leading-snug flex items-center flex-wrap gap-1.5">
                        <span>{l.modalidade || '—'} · cobrado {brl(l.valor_cobrado)}</span>
                        {/* v48.111 — Botão direto no card: marcar não abre nada, e
                            desmarcar pede senha (ver marcarPago/DesfazerPagoModal). */}
                        <span
                          onClick={e => marcarPago(l, e)}
                          title={l.pago ? 'Pago — clique para desfazer (pede senha)' : 'Clique para marcar como pago'}
                          className={clsx(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold cursor-pointer transition-colors',
                            l.pago ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                          )}>
                          {l.pago ? <><Check size={11}/> Pago</> : 'Marcar pago'}
                        </span>
                      </p>
                      {/* v48.15 — Numa cirurgia cancelada, o motivo é a informação
                          mais importante do cartão. Deixá-lo só dentro do cadastro
                          obrigaria a abrir uma por uma para entender a lista. */}
                      {l.categoria === 'cancelada' && l.motivo_cancelamento && (
                        <p className="text-xs text-red-700 mt-1 bg-red-50 border border-red-100 rounded-md px-2 py-1">
                          {l.motivo_cancelamento}
                        </p>
                      )}
                    </div>

                    {/* Clicar na marca troca a situação sem abrir o cadastro
                        inteiro: é o que mais acontece no dia, e obrigar a abrir
                        o formulário é o caminho para a lista ficar desatualizada. */}
                    <span
                      onClick={e => { e.stopPropagation(); setTrocando(l) }}
                      title="Clique para trocar a situação"
                      className="hidden sm:block text-[11px] font-semibold px-2 py-1 rounded-full text-white shrink-0 cursor-pointer hover:opacity-80"
                      style={{ background: cores[l.status] || '#64748b' }}>
                      {l.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {aberta && (
        // v48.133 — Antes só "Salvar" recarregava a lista (onSalvo). Mas
        // gerar/enviar o PDF de suspensão de medicamentos (aba Medicações,
        // atalho ou Emissão de documentos) grava direto no banco por fora do
        // formulário — quem fechava no X sem clicar Salvar via o cartão ainda
        // com "revisar remédio" (âmbar) até dar F5 (relato do Jorge). Fechar
        // por qualquer caminho agora também recarrega — reconsultar é barato,
        // e cobre isso e qualquer outra mudança feita dentro do modal por
        // fora do botão Salvar.
        <CirurgiaModal cirurgia={aberta} focarMedicamentos={focarMedicamentos}
          onFechar={() => { setAberta(null); carregar() }} onSalvo={() => { setAberta(null); carregar() }}/>
      )}

      {trocando && (
        <TrocarSituacao
          cirurgia={trocando as any}
          onFechar={() => setTrocando(null)}
          onTrocou={() => { setTrocando(null); carregar() }}/>
      )}

      {desfazerPago && (
        <DesfazerPagoModal
          cirurgia={desfazerPago}
          onFechar={() => setDesfazerPago(null)}
          onConfirmado={() => { setDesfazerPago(null); carregar() }}/>
      )}
    </div>
  )
}

// v48.111 — Mesma senha administrativa de Configurações → Sofia
// (verify_sofia_admin_password), pra não criar uma segunda senha pra
// decorar. Só desmarcar pede isto — marcar como pago é reversível sem custo.
function DesfazerPagoModal({ cirurgia, onFechar, onConfirmado }: { cirurgia: Linha; onFechar: () => void; onConfirmado: () => void }) {
  const [senha, setSenha] = useState('')
  const [checando, setChecando] = useState(false)
  const [erro, setErro] = useState('')

  async function confirmar() {
    if (!senha) { setErro('Digite a senha.'); return }
    setChecando(true); setErro('')
    const { data, error } = await supabase.rpc('verify_sofia_admin_password', { candidate: senha })
    if (error || data !== true) { setChecando(false); setErro('Senha incorreta.'); return }
    const { error: errUpdate } = await supabase.from('cirurgias').update({ pago: false }).eq('id', cirurgia.id)
    setChecando(false)
    if (errUpdate) { setErro('Não foi possível desfazer: ' + errUpdate.message); return }
    onConfirmado()
  }

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onFechar}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Desmarcar como pago</h2>
          <p className="text-xs text-slate-400 mt-0.5">{cirurgia.paciente_nome} — cobrado {brl(cirurgia.valor_cobrado)}</p>
        </div>
        <div className="px-5 py-4 space-y-2">
          <p className="text-xs text-slate-500">Exige a senha administrativa — a mesma de Configurações → Sofia.</p>
          {erro && <p className="text-xs text-red-600">{erro}</p>}
          <input type="password" value={senha} onChange={e => setSenha(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmar()}
            placeholder="Senha administrativa" autoFocus
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          <button onClick={onFechar} className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button onClick={confirmar} disabled={checando}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
            {checando ? <Loader2 size={13} className="animate-spin"/> : null}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
