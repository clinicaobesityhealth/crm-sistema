'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { X, Save, Loader2, Scissors, History, Trash2, FileText, MessageCircle } from 'lucide-react'
import BuscaPaciente from './BuscaPaciente'
import DescricaoCirurgica from './DescricaoCirurgica'
import DocumentosCirurgia from './DocumentosCirurgia'
import MedicamentosCirurgia from './MedicamentosCirurgia'
import DiagnosticosDaCirurgia from './DiagnosticosDaCirurgia'
import MensagemAoPaciente from './MensagemAoPaciente'
import SelectComCriar from './SelectComCriar'
import ProcedimentosDaCirurgia from './ProcedimentosDaCirurgia'
import HospitalPausaMed, { HOSPITAL_VAZIO, ultimoHospitalUsado, type HospitalValor } from '../HospitalPausaMed'
import { datasDaSituacao } from '@/lib/situacaoData'
import { calcularCobrado, textoEquipe } from '@/lib/valoresCirurgia'
import { buscarPreco, type Preco } from '@/lib/precoCirurgia'
import { acharRepetidos } from '@/lib/materiaisCirurgia'
import { useVias } from '@/lib/viasCirurgia'
import {
  ITEM_VAZIO, type ItemCirurgia,
  siglasCombinadas, nomesCombinados, calcularConjugadas, viaPrincipal,
} from '@/lib/itensCirurgia'

// Lançamento e edição de uma cirurgia.
//
// A tela segue a ordem em que a informação chega na prática: quem, quando, o
// quê, onde, com quem, quanto. As listas vêm de Configurações → Cirurgias;
// nada aqui é digitado livre quando já existe cadastro.

export type Cirurgia = {
  id: string
  contact_id: string | null
  paciente_nome: string
  paciente_telefone: string
  data_cirurgia: string
  hora: string
  procedimento_id: string | null
  procedimento_sigla: string
  procedimento_nome: string
  via_acesso: string
  hospital_id: string | null
  hospital: string
  // v48.110 — cidade/estado/id do hospital na base do PausaMed. hospital_id
  // (acima) é o legado da lista própria do CRM e continua existindo só para
  // não quebrar cirurgia antiga; o formulário novo não usa mais.
  hospital_estado: string | null
  hospital_cidade: string | null
  hospital_pausamed_id: string | null
  cirurgiao_id: string | null
  cirurgiao: string
  composicao_equipe: string
  equipe_auxiliares: number
  equipe_instrumentadores: number
  tem_anestesista: boolean
  anestesista_cobra_direto: boolean
  valor_cobrado_manual: boolean
  valor_previa_manual: boolean
  modalidade: string
  convenio_id: string | null
  plano_id: string | null
  convenio: string
  plano: string
  carteirinha: string
  carteirinha_nome: string
  carteirinha_validade: string
  status_id: string | null
  status: string
  categoria: string
  motivo_cancelamento: string
  // v48.112 — Motivo escolhido da lista fixa (Configurações → Cirurgias →
  // Motivos de cancelamento). motivo_cancelamento (texto) continua existindo
  // — é o que aparece no cartão e no histórico — mas quem alimenta a
  // estatística do Dashboard de Cirurgias é este id.
  motivo_cancelamento_id: string | null
  valor_previa: number | null
  valor_cobrado: number | null
  ajuste_valor: number
  forma_pagamento: string
  parcelas: number | null
  pago: boolean
  observacao: string
  medicacoes: string
  hora_internacao: string
  data_pre_operatorio: string
  data_solicitado_hospital: string
  data_autorizacao: string
  // v48.102 — A lista de materiais que a equipe já escolheu, uma por
  // procedimento (mesmo campo que o cirurgião preenche no link dele — ver
  // agendar-cirurgia/[token]/page.tsx). Mostrar e deixar mexer aqui também: a
  // cirurgia é lançada direto pela secretária na maioria das vezes, e ela
  // precisa do mesmo atalho que o cirurgião tem.
  material_listas_ids: string[]
}

export const CIRURGIA_VAZIA: Cirurgia = {
  id: '', contact_id: null, paciente_nome: '', paciente_telefone: '',
  data_cirurgia: '', hora: '', procedimento_id: null, procedimento_sigla: '', procedimento_nome: '',
  via_acesso: '',
  hospital_id: null, hospital: '', hospital_estado: null, hospital_cidade: null, hospital_pausamed_id: null,
  cirurgiao_id: null, cirurgiao: '', composicao_equipe: '',
  // v48.142 — Pedido do Jorge: pré-preencher com 2 auxiliares e 1
  // instrumentador (o mais comum), podendo alterar se a cirurgia for
  // diferente. Só vale para cirurgia NOVA — abrir uma já cadastrada continua
  // trazendo o que foi salvo (ver app/cirurgias/page.tsx: {...CIRURGIA_VAZIA, ...l}).
  equipe_auxiliares: 2, equipe_instrumentadores: 1, tem_anestesista: false,
  anestesista_cobra_direto: false, valor_cobrado_manual: false, valor_previa_manual: false,
  modalidade: '', convenio_id: null, plano_id: null, convenio: '', plano: '', carteirinha: '', carteirinha_nome: '', carteirinha_validade: '',
  status_id: null, status: '', categoria: 'aberta', motivo_cancelamento: '', motivo_cancelamento_id: null,
  valor_previa: null, valor_cobrado: null, ajuste_valor: 0,
  forma_pagamento: '', parcelas: null, pago: false, observacao: '', medicacoes: '', hora_internacao: '',
  data_pre_operatorio: '', data_solicitado_hospital: '', data_autorizacao: '',
  material_listas_ids: [],
}

type Opcao = { id: string; nome: string; percentual_previa?: number }
type Status = { id: string; nome: string; categoria: string; cor: string }
type Historico = { id: string; status_anterior: string | null; status_novo: string; agente_nome: string | null; created_at: string }

const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Identidade da composição: quais procedimentos, nesta ordem.
const chaveComposicao = (itens: ItemCirurgia[]) =>
  itens.map(i => i.procedimento_id ?? (i.sigla || '').trim()).filter(Boolean).join('|')

export default function CirurgiaModal({ cirurgia, onFechar, onSalvo, focarMedicamentos }: {
  cirurgia: Cirurgia; onFechar: () => void; onSalvo: () => void
  // v48.122 — Veio do alerta de medicação no cartão da lista (Cirurgias →
  // cartão → "revisar remédio"/"revisado pelo médico"): abre já rolado e
  // realçado na seção de Medicações, em vez de a pessoa ter de procurar.
  focarMedicamentos?: boolean
}) {
  const [excluindo, setExcluindo] = useState(false)
  const medicamentosRef = useRef<HTMLDivElement | null>(null)
  const [realcarMedicamentos, setRealcarMedicamentos] = useState(false)
  useEffect(() => {
    if (!focarMedicamentos) return
    // v48.124 — "clicar em revisar remédio não rolava até Medicações": um
    // único scrollIntoView em 150ms não é confiável aqui — a modal inteira
    // ainda está de pé (primeiro paint) e outras seções acima (equipe,
    // procedimentos, mensagens) ainda estão carregando/medindo sua altura,
    // então o alvo calculado naquele instante fica errado. Repete a chamada
    // mais duas vezes, mais espaçadas, para pegar o layout já assentado —
    // scrollIntoView é barato de chamar de novo, e a última tentativa é a
    // que fica valendo visualmente.
    const t1 = setTimeout(() => medicamentosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    const t2 = setTimeout(() => medicamentosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 500)
    const t3 = setTimeout(() => {
      medicamentosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setRealcarMedicamentos(true)
    }, 900)
    // O realce é só para o olho pousar no lugar certo — some sozinho.
    const t4 = setTimeout(() => setRealcarMedicamentos(false), 3200)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [focarMedicamentos])
  const { agent } = useAuth()
  const vias = useVias()
  const router = useRouter()
  const [f, setF] = useState<Cirurgia>({
    ...cirurgia,
    // v48.110 — Cirurgia nova, sem hospital ainda escolhido: já abre com o
    // último hospital usado (facilita quando é o mesmo hospital de sempre).
    ...(!cirurgia.id && !cirurgia.hospital ? (() => {
      const u = ultimoHospitalUsado()
      return u ? { hospital: u.nome, hospital_cidade: u.cidade, hospital_estado: u.estado, hospital_pausamed_id: u.pausamedId } : {}
    })() : {}),
    // O banco devolve "05:00:00"; o campo de hora quer "05:00".
    hora_internacao: String((cirurgia as any).hora_internacao || '').slice(0, 5),
  })
  const [salvando, setSalvando] = useState(false)

  // v48.111 — Desmarcar "Pago" (aqui ou no card da lista) exige a mesma senha
  // administrativa de Configurações → Sofia — marcar é reversível sem custo,
  // desfazer um pagamento já confirmado, não.
  const [pedirSenhaPago, setPedirSenhaPago] = useState(false)
  const [senhaPago, setSenhaPago] = useState('')
  const [senhaPagoErro, setSenhaPagoErro] = useState('')
  const [verificandoSenhaPago, setVerificandoSenhaPago] = useState(false)

  // v48.25 — Os procedimentos do lançamento. É uma lista porque cirurgia
  // conjugada é a regra em bariátrica, não a exceção: a mesma anestesia resolve
  // a hérnia de hiato e tira a vesícula.
  const [itens, setItens] = useState<ItemCirurgia[]>([{ ...ITEM_VAZIO }])

  // Com que procedimentos esta cirurgia foi aberta. Serve para saber se a
  // composição mudou AGORA, na mão de alguém, ou se é só a tela carregando.
  const composicaoAberta = useRef<string | null>(null)

  const [equipe, setEquipe] = useState<Opcao[]>([])
  const [status, setStatus] = useState<Status[]>([])
  const [modalidades, setModalidades] = useState<Opcao[]>([])
  const [formas, setFormas] = useState<Opcao[]>([])
  const [convenios, setConvenios] = useState<Opcao[]>([])
  const [planos, setPlanos] = useState<{ id: string; convenio_id: string; nome: string }[]>([])
  // v48.112 — Lista fixa de motivos de cancelamento (Configurações → Cirurgias
  // → Motivos de cancelamento), para virar estatística no Dashboard de
  // Cirurgias. O texto livre continua existindo (motivo_cancelamento), mas
  // quem alimenta o gráfico é o id escolhido aqui.
  const [motivos, setMotivos] = useState<Opcao[]>([])
  // Cirurgia existente, já cancelada com essa lista: motivo_cancelamento vem
  // salvo como "Nome — detalhe". Recupera só o detalhe para não perder o que
  // já foi escrito ao reabrir a tela.
  const [motivoDetalhe, setMotivoDetalhe] = useState(() => {
    if (!cirurgia.motivo_cancelamento_id || !cirurgia.motivo_cancelamento) return ''
    const partes = cirurgia.motivo_cancelamento.split(' — ')
    return partes.length > 1 ? partes.slice(1).join(' — ') : ''
  })
  const [preco, setPreco] = useState<Preco | null>(null)
  const [historico, setHistorico] = useState<Historico[]>([])
  const [verHistorico, setVerHistorico] = useState(false)

  // v48.102 — As listas de materiais de cada procedimento (a mesma tabela do
  // link do cirurgião) e qual está escolhida aqui, por procedimento_id.
  // v48.117 — "itens" veio junto: Jorge pediu para dar para VER o material
  // escolhido aqui, não só o nome da lista (ver ProcedimentosDaCirurgia.tsx).
  const [materiaisListas, setMateriaisListas] = useState<{ id: string; procedimento_id: string; nome: string; padrao: boolean; itens: string }[]>([])
  const [materiais, setMateriais] = useState<Record<string, string>>({})

  const novo = !cirurgia.id
  const set = (c: keyof Cirurgia, v: any) => setF(a => ({ ...a, [c]: v }))

  const recarregarListas = useCallback(async () => {
      const [e, s, m, fp] = await Promise.all([
        // v48.110 — Este select vira só o dropdown "Cirurgião" (ver linha
        // ~640) — "Composição da equipe" ao lado é só contagem (auxiliares,
        // instrumentadores) e checkbox de anestesista, não escolhe nome. Sem
        // o filtro por função, aparecia GREICE/GISELE (instrumentadora/
        // anestesista) junto dos médicos na lista de cirurgião.
        supabase.from('cirurgia_equipe').select('id, nome_curto').eq('ativo', true).eq('funcao', 'CIRURGIÃO').order('ordem'),
        supabase.from('cirurgia_status').select('id, nome, categoria, cor').eq('ativo', true).order('ordem'),
        supabase.from('cirurgia_modalidades').select('id, nome, percentual_previa').eq('ativo', true).order('ordem'),
        supabase.from('cirurgia_formas_pagamento').select('id, nome').eq('ativo', true).order('ordem'),
      ])
      const [cv, pl, ml, mc] = await Promise.all([
        supabase.from('cirurgia_convenios').select('id, nome').eq('ativo', true).order('ordem'),
        supabase.from('cirurgia_planos').select('id, convenio_id, nome').eq('ativo', true).order('ordem'),
        // v48.117 — "itens" a mais aqui: é o texto do material que a tela
        // agora mostra junto do nome, para dar para ver o que foi escolhido.
        supabase.from('cirurgia_material_listas').select('id, procedimento_id, nome, padrao, itens').eq('ativo', true).order('ordem'),
        supabase.from('cirurgia_motivos_cancelamento').select('id, nome').eq('ativo', true).order('ordem'),
      ])
      setConvenios((cv.data ?? []) as Opcao[])
      setPlanos((pl.data ?? []) as any[])
      setEquipe(((e.data ?? []) as any[]).map(x => ({ id: x.id, nome: x.nome_curto })))
      setStatus((s.data ?? []) as Status[])
      setModalidades((m.data ?? []) as Opcao[])
      setFormas((fp.data ?? []) as Opcao[])
      setMateriaisListas((ml.data ?? []) as any[])
      // Migração ainda não rodada: a tabela não existe, o select vem com erro
      // e data vazio. A tela não pode quebrar por isso — só o dropdown fica
      // vazio e o texto livre (motivo_cancelamento) continua funcionando.
      setMotivos((mc.data ?? []) as Opcao[])
  }, [])

  useEffect(() => { recarregarListas() }, [recarregarListas])

  // Os itens salvos. Cirurgia antiga, lançada antes desta versão, entra com o
  // procedimento que estava no cabeçalho — assim a tela tem sempre uma lista
  // para mostrar, e não dois caminhos diferentes.
  useEffect(() => {
    if (!cirurgia.id) {
      const inicial = [{
        ...ITEM_VAZIO,
        procedimento_id: cirurgia.procedimento_id,
        sigla: cirurgia.procedimento_sigla || '',
        nome: cirurgia.procedimento_nome || '',
      }]
      setItens(inicial)
      composicaoAberta.current = chaveComposicao(inicial)
      return
    }
    supabase.from('cirurgia_itens').select('*').eq('cirurgia_id', cirurgia.id).order('ordem')
      .then(({ data }) => {
        const lidos: ItemCirurgia[] = ((data ?? []) as any[]).map(i => ({
          id: i.id,
          procedimento_id: i.procedimento_id,
          sigla: i.sigla || '',
          nome: i.nome || '',
          valor_equipe: Number(i.valor_equipe) || 0,
          valor_anestesista: Number(i.valor_anestesista) || 0,
          valor_manual: !!i.valor_manual,
          via_acesso: i.via_acesso || '',
        }))
        const inicial = lidos.length ? lidos : [{
          ...ITEM_VAZIO,
          procedimento_id: cirurgia.procedimento_id,
          sigla: cirurgia.procedimento_sigla || '',
          nome: cirurgia.procedimento_nome || '',
        }]
        setItens(inicial)
        composicaoAberta.current = chaveComposicao(inicial)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cirurgia.id])

  useEffect(() => {
    if (!cirurgia.id) return
    supabase.from('cirurgia_historico').select('*').eq('cirurgia_id', cirurgia.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setHistorico((data ?? []) as Historico[]))
  }, [cirurgia.id])

  // v48.102 — Os ids salvos (cirurgia.material_listas_ids) viram, de volta, um
  // mapa por procedimento — assim que a lista de opções chega, uma vez só.
  useEffect(() => {
    if (!materiaisListas.length) return
    const ids = cirurgia.material_listas_ids || []
    if (!ids.length) return
    const mapa: Record<string, string> = {}
    for (const lid of ids) {
      const l = materiaisListas.find(x => x.id === lid)
      if (l) mapa[l.procedimento_id] = l.id
    }
    if (Object.keys(mapa).length) setMateriais(a => ({ ...mapa, ...a }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiaisListas])

  // Procedimento sem material escolhido ainda: já marca a lista padrão — a
  // secretária troca se não for a certa, em vez de partir do zero toda vez.
  useEffect(() => {
    if (!materiaisListas.length || !itens.length) return
    setMateriais(a => {
      let mudou = false
      const mapa = { ...a }
      for (const it of itens) {
        if (!it.procedimento_id || mapa[it.procedimento_id]) continue
        const opcoes = materiaisListas.filter(l => l.procedimento_id === it.procedimento_id)
        const escolhida = opcoes.find(l => l.padrao) || opcoes[0]
        if (escolhida) { mapa[it.procedimento_id] = escolhida.id; mudou = true }
      }
      return mudou ? mapa : a
    })
  }, [materiaisListas, itens])

  // O procedimento principal é o primeiro da lista: é ele que dá nome ao ato e
  // que a planilha mostra na frente.
  const itensValidos = itens.filter(i => i.procedimento_id || (i.sigla || '').trim())

  // v48.119 — Cirurgia com 2+ procedimentos (ex.: BP + CCC) pode ter o mesmo
  // item em listas de materiais diferentes — trocarte e agulha de Veress são
  // os exemplos do Jorge. Aqui é só o aviso, informativo: quem resolve de
  // verdade qual entra uma vez ou duas é a tela de "Solicitação de cirurgia"
  // (DocumentosCirurgia.tsx), que já dedupa por padrão na hora de gerar.
  const materiaisSelecionados = itensValidos
    .map(i => i.procedimento_id && materiais[i.procedimento_id])
    .filter((id): id is string => !!id)
    .map(id => materiaisListas.find(l => l.id === id))
    .filter((l): l is typeof materiaisListas[number] => !!l)
  const materiaisRepetidos = materiaisSelecionados.length > 1 ? acharRepetidos(materiaisSelecionados) : []
  const modalidade = modalidades.find(m => m.nome === f.modalidade) || null
  // "Particular com convênio" (reembolso) não tem convênio contratado pela
  // clínica, mas precisa da carteirinha do mesmo jeito — é com ela que o
  // paciente pede o reembolso depois.
  const pedeCarteirinha = /conv[êe]nio|reembolso/i.test(f.modalidade || '')

  // O valor não vem mais direto do procedimento: vem da tabela do convênio,
  // do plano, ou da particular — nessa ordem. Ver lib/precoCirurgia.ts.
  const idPrincipal = itensValidos[0]?.procedimento_id ?? null
  useEffect(() => {
    let cancelado = false
    buscarPreco(idPrincipal, f.convenio_id, f.plano_id).then(p => {
      if (!cancelado) setPreco(p)
    })
    return () => { cancelado = true }
  }, [idPrincipal, f.convenio_id, f.plano_id])

  // v48.32 — A conta da planilha, na mesma ordem: o anestesista de cada
  // procedimento entra na base daquele procedimento, e só então o maior entra
  // inteiro e os outros pela metade. Ver lib/itensCirurgia.ts.
  const conta = calcularConjugadas(itensValidos, {
    temAnestesista: f.tem_anestesista,
    anestesistaCobraDireto: f.anestesista_cobra_direto,
  })

  // A conta só existe quando pelo menos um procedimento está ligado ao
  // cadastro. Sigla que veio da planilha e não casou com nada não tem preço de
  // tabela — e calcular zero ali apagaria o valor combinado com o paciente.
  const temBaseDeCalculo = itensValidos.some(i => !!i.procedimento_id)
  const cobradoCalculado = temBaseDeCalculo
    ? calcularCobrado({
        valorEquipe: conta.total,
        valorAnestesista: 0,
        temAnestesista: false,
        anestesistaCobraDireto: false,
        ajuste: Number(f.ajuste_valor) || 0,
      })
    : null

  // v48.28 — Mexeu nos procedimentos, o valor volta a seguir o orçamento.
  //
  // O valor digitado à mão era de um acordo sobre OUTRA cirurgia: acrescentar um
  // segundo procedimento e manter o preço do primeiro é cobrar de menos sem
  // ninguém perceber. Era o que acontecia com as cirurgias trazidas da planilha,
  // que entram com o valor travado.
  //
  // Desconto e abatimento continuam existindo — mas pelo campo Ajuste, que entra
  // na conta e fica visível, em vez de sumirem dentro de um número digitado.
  const composicaoAtual = chaveComposicao(itens)
  useEffect(() => {
    if (composicaoAberta.current === null) return          // ainda carregando
    if (composicaoAberta.current === composicaoAtual) return
    composicaoAberta.current = composicaoAtual
    setF(a => a.valor_cobrado_manual ? { ...a, valor_cobrado_manual: false } : a)
  }, [composicaoAtual])

  // Categoria da situação escolhida agora na tela — que pode ainda não ter sido
  // salva. Usar f.categoria aqui mostraria o estado antigo.
  const categoriaEscolhida = status.find(x => x.id === f.status_id)?.categoria ?? f.categoria


  // Enquanto a secretária não digita por cima, os campos seguem a conta. Assim
  // trocar o procedimento, marcar o anestesista ou mudar a condição já mexe no
  // valor, sem ninguém precisar lembrar de recalcular.
  //
  // No instante em que ela digita, aquele campo vira "manual" e para de ser
  // recalculado: às vezes o valor é fruto de acordo, e um cálculo que
  // sobrescreve o acordo é pior do que cálculo nenhum.
  useEffect(() => {
    setF(a => {
      const mudou: Partial<Cirurgia> = {}
      if (!a.valor_cobrado_manual && cobradoCalculado !== null && a.valor_cobrado !== cobradoCalculado) {
        mudou.valor_cobrado = cobradoCalculado
      }
      return Object.keys(mudou).length ? { ...a, ...mudou } : a
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobradoCalculado])

  // Excluir uma cirurgia.
  //
  // Faltava, e a falta doía: sem isso não havia como limpar um lançamento
  // duplicado ou errado — e reimportar da planilha não resolvia, porque o CRM
  // reconhece o que já conhece e ignora.
  //
  // v48.25 — Apagar aqui apaga a linha da planilha também.
  //
  // Antes não apagava, e o efeito era o contrário do pedido: a linha continuava
  // lá, o CRM não a reconhecia mais e adotava de novo na sincronização
  // seguinte. A cirurgia voltava sozinha.
  //
  // Agora a exclusão fica registrada (tabela cirurgia_exclusoes) e a próxima
  // sincronização manda o n8n apagar a linha correspondente.
  async function excluir() {
    const nome = f.paciente_nome || 'esta cirurgia'
    if (!confirm(
      `Excluir a cirurgia de ${nome}?\n\n` +
      `Somem junto o histórico de situações e as mensagens ainda não enviadas.\n` +
      `A linha da planilha CIRURGIAS OBESITY é apagada na próxima sincronização.\n` +
      `Isto não pode ser desfeito.`
    )) return
    if (!confirm(`Confirma a exclusão de ${nome}?`)) return

    setExcluindo(true)
    const { error } = await supabase.from('cirurgias').delete().eq('id', f.id)
    setExcluindo(false)
    if (error) { alert('Não foi possível excluir: ' + error.message); return }
    onSalvo()
  }

  async function confirmarDesfazerPago() {
    if (!senhaPago) { setSenhaPagoErro('Digite a senha.'); return }
    setVerificandoSenhaPago(true); setSenhaPagoErro('')
    const { data, error } = await supabase.rpc('verify_sofia_admin_password', { candidate: senhaPago })
    setVerificandoSenhaPago(false)
    if (error || data !== true) { setSenhaPagoErro('Senha incorreta.'); return }
    set('pago', false)
    setPedirSenhaPago(false); setSenhaPago(''); setSenhaPagoErro('')
  }

  async function salvar() {
    if (!f.paciente_nome.trim()) { alert('O nome do paciente é obrigatório.'); return }
    if (!f.status) { alert('Escolha a situação da cirurgia.'); return }
    if (itens.length > 1 && itens.some(i => !i.procedimento_id && !(i.sigla || '').trim())) {
      alert('Um dos procedimentos ficou em branco. Escolha a cirurgia ou tire a linha com a lixeira.')
      return
    }
    if (categoriaEscolhida === 'cancelada' && !f.motivo_cancelamento_id) {
      alert('Escolha o motivo do cancelamento antes de salvar.')
      return
    }
    setSalvando(true)

    const st = status.find(s => s.id === f.status_id)
    const dados: any = {
      contact_id: f.contact_id,
      paciente_nome: f.paciente_nome.trim(),
      paciente_telefone: f.paciente_telefone?.trim() || null,
      data_cirurgia: f.data_cirurgia || null,
      hora: f.hora || null,
      // O cabeçalho da cirurgia guarda o principal e o texto combinado. A
      // planilha e a lista leem daqui, exatamente como antes — o que mudou é
      // que agora "BP, HH" é um lançamento com dois itens, e não um texto solto.
      procedimento_id: itensValidos[0]?.procedimento_id ?? null,
      procedimento_sigla: siglasCombinadas(itensValidos) || null,
      procedimento_nome: nomesCombinados(itensValidos) || null,
      via_acesso: f.via_acesso || viaPrincipal(itensValidos) || null,
      hospital_id: f.hospital_id,
      hospital: f.hospital || null,
      hospital_estado: f.hospital_estado || null,
      hospital_cidade: f.hospital_cidade || null,
      hospital_pausamed_id: f.hospital_pausamed_id || null,
      cirurgiao_id: f.cirurgiao_id,
      cirurgiao: f.cirurgiao || null,
      // O texto é gerado a partir dos números, no formato que a planilha e as
      // cartas usam. Só cai no texto digitado quando não há contagem nenhuma —
      // caso das cirurgias trazidas da planilha antes desta versão.
      composicao_equipe: textoEquipe(f.equipe_auxiliares, f.equipe_instrumentadores, f.tem_anestesista)
        || f.composicao_equipe?.trim() || null,
      equipe_auxiliares: Number(f.equipe_auxiliares) || 0,
      equipe_instrumentadores: Number(f.equipe_instrumentadores) || 0,
      tem_anestesista: !!f.tem_anestesista,
      anestesista_cobra_direto: !!f.anestesista_cobra_direto,
      valor_cobrado_manual: !!f.valor_cobrado_manual,
      valor_previa_manual: !!f.valor_previa_manual,
      modalidade: f.modalidade || null,
      convenio_id: f.convenio_id,
      plano_id: f.plano_id,
      // Nome copiado junto: o paciente pode trocar de convênio depois, e a
      // guia daquela cirurgia não muda por isso.
      convenio: f.convenio || null,
      plano: f.plano || null,
      carteirinha: f.carteirinha?.trim() || null,
      carteirinha_nome: f.carteirinha_nome?.trim() || null,
      carteirinha_validade: f.carteirinha_validade || null,
      status_id: f.status_id,
      status: f.status,
      // O motivo é preservado mesmo se a cirurgia voltar a ser ativa: faz parte
      // do que aconteceu com aquele paciente.
      motivo_cancelamento: f.motivo_cancelamento?.trim() || null,
      motivo_cancelamento_id: f.motivo_cancelamento_id || null,
      categoria: st?.categoria ?? f.categoria ?? 'aberta',
      valor_previa: f.valor_previa === null || f.valor_previa === undefined ? null : Number(f.valor_previa),
      valor_cobrado: f.valor_cobrado === null || f.valor_cobrado === undefined ? null : Number(f.valor_cobrado),
      ajuste_valor: Number(f.ajuste_valor) || 0,
      forma_pagamento: f.forma_pagamento || null,
      parcelas: f.parcelas ? Number(f.parcelas) : null,
      pago: !!f.pago,
      observacao: f.observacao?.trim() || null,
      medicacoes: f.medicacoes?.trim() || null,
      hora_internacao: f.hora_internacao || null,
      data_pre_operatorio: f.data_pre_operatorio || null,
      data_solicitado_hospital: f.data_solicitado_hospital || null,
      data_autorizacao: f.data_autorizacao || null,
      // v48.102 — Só os das cirurgias que continuam no lançamento — se um
      // procedimento foi tirado, a lista escolhida para ele some junto.
      material_listas_ids: Array.from(new Set(
        itensValidos.map(i => i.procedimento_id && materiais[i.procedimento_id]).filter(Boolean)
      )),
      // Guardado a cada gravação: é o que o histórico usa para dizer quem mudou.
      criado_por: agent?.id ?? null,
      criado_por_nome: agent?.name ?? null,
      updated_at: new Date().toISOString(),
    }

    let id = f.id
    if (novo) {
      const { data, error } = await supabase.from('cirurgias').insert(dados).select('id').single()
      if (error || !data) { setSalvando(false); alert('Não foi possível salvar: ' + (error?.message || '')); return }
      id = data.id
    } else {
      const { error } = await supabase.from('cirurgias').update(dados).eq('id', f.id)
      if (error) { setSalvando(false); alert('Não foi possível salvar: ' + error.message); return }
    }

    // Os itens são regravados por inteiro, como os códigos do cadastro: são
    // poucas linhas, e assim um procedimento tirado na tela some de verdade,
    // sem depender de comparar o que mudou.
    await supabase.from('cirurgia_itens').delete().eq('cirurgia_id', id)
    if (itensValidos.length > 0) {
      const { error: erroItens } = await supabase.from('cirurgia_itens').insert(
        itensValidos.map((i, k) => ({
          cirurgia_id: id,
          procedimento_id: i.procedimento_id,
          sigla: i.sigla || null,
          nome: i.nome || null,
          valor_equipe: Number(i.valor_equipe) || 0,
          valor_anestesista: Number(i.valor_anestesista) || 0,
          valor_manual: !!i.valor_manual,
          via_acesso: i.via_acesso || f.via_acesso || null,
          ordem: k + 1,
        })))
      if (erroItens) {
        setSalvando(false)
        alert('A cirurgia foi salva, mas os procedimentos falharam: ' + erroItens.message)
        return
      }
    }

    setSalvando(false)
    onSalvo()
  }

  const input = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'
  const label = 'block text-xs font-semibold text-slate-600 mb-1'

  return (
    <>
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFechar}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[94vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Scissors size={16} className="text-brand-500"/>
            <h2 className="text-sm font-semibold text-slate-800">{novo ? 'Nova cirurgia' : 'Editar cirurgia'}</h2>
          </div>
          <div className="flex items-center gap-1">
            {/* v48.124 — Pedido do Jorge: abrir a conversa do paciente direto
                daqui, sem precisar sair da edição da cirurgia e procurar o
                contato em Contatos/Atendimentos. Só aparece com paciente
                vinculado ao CRM (f.contact_id) — sem isso não existe conversa
                pra abrir. Mesmo destino (/inbox?contact=) que Contatos usa. */}
            {f.contact_id && (
              <button onClick={() => router.push(`/inbox?contact=${f.contact_id}`)}
                className="p-1.5 rounded-md text-slate-400 hover:text-brand-600 hover:bg-brand-50"
                title="Iniciar conversa com o paciente"><MessageCircle size={16}/></button>
            )}
            {!novo && (
              <button onClick={() => setVerHistorico(v => !v)}
                className={'p-1.5 rounded-md ' + (verHistorico ? 'bg-slate-100 text-slate-600' : 'text-slate-400')}
                title="Histórico de situações"><History size={16}/></button>
            )}
            <button onClick={onFechar} className="p-1 text-slate-400"><X size={18}/></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {verHistorico ? (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">Histórico de situações</p>
              {historico.length === 0 ? (
                <p className="text-sm text-slate-400">Nada registrado ainda.</p>
              ) : (
                <div className="space-y-1.5">
                  {historico.map(h => (
                    <div key={h.id} className="flex items-start gap-2 px-3 py-2 bg-slate-50 rounded-lg">
                      <div className="flex-1">
                        <p className="text-sm text-slate-700">
                          {h.status_anterior ? <span className="text-slate-400">{h.status_anterior} → </span> : null}
                          <span className="font-semibold">{h.status_novo}</span>
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {new Date(h.created_at).toLocaleString('pt-BR')}
                          {h.agente_nome && ` · ${h.agente_nome}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className={label}>Paciente</label>
                <BuscaPaciente
                  contactId={f.contact_id} nome={f.paciente_nome} telefone={f.paciente_telefone}
                  onNome={v => set('paciente_nome', v)}
                  onTelefone={v => set('paciente_telefone', v)}
                  onEscolher={c => setF(a => {
                    const convId = a.convenio_id || (c as any)?.convenio_id || null
                    const planoDo = planos.find(p => p.id === (a.plano_id || (c as any)?.plano_id))
                    return {
                    ...a,
                    contact_id: c?.id ?? null,
                    paciente_nome: c?.full_name ?? '',
                    paciente_telefone: c?.phone ?? '',
                    // v48.65 — Convênio e carteirinha já estão no cadastro do
                    // paciente. Redigitar é onde nasce a divergência que faz o
                    // convênio recusar a guia. Só preenche o que está vazio,
                    // para nunca sobrescrever o que alguém já ajustou aqui.
                    convenio_id: convId,
                    convenio: convenios.find(x => x.id === convId)?.nome || a.convenio || '',
                    plano_id: planoDo?.id ?? null,
                    plano: planoDo?.nome ?? a.plano,
                    carteirinha: a.carteirinha || (c as any)?.carteirinha || '',
                    carteirinha_nome: a.carteirinha_nome || (c as any)?.carteirinha_nome || '',
                    carteirinha_validade: a.carteirinha_validade || (c as any)?.carteirinha_validade || '',
                    }
                  })}/>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={label}>Data da cirurgia</label>
                  <input type="date" value={f.data_cirurgia} onChange={e => set('data_cirurgia', e.target.value)} className={input}/>
                </div>
                <div>
                  <label className={label}>Hora</label>
                  <input type="time" value={f.hora} onChange={e => set('hora', e.target.value)} className={input}/>
                </div>
                <div>
                  {/* v48.75 — A internação tem hora própria na carta ao hospital.
                      Duas horas antes é o costume, mas hospital, anestesia e
                      exame pré mudam isso — por isso é campo, e não conta. */}
                  <label className={label}>Internação</label>
                  <input type="time" value={f.hora_internacao} onChange={e => set('hora_internacao', e.target.value)} className={input}/>
                  {!f.hora_internacao && f.hora && (
                    <p className="text-[11px] text-slate-400 mt-1">vazio = 2h antes</p>
                  )}
                </div>
              </div>

              <div>
                <label className={label}>
                  Cirurgia
                  {itensValidos.length > 1 && (
                    <span className="ml-1.5 font-normal text-slate-400">
                      · {itensValidos.length} procedimentos
                    </span>
                  )}
                </label>
                <ProcedimentosDaCirurgia
                  itens={itens}
                  onItens={setItens}
                  convenioId={f.convenio_id}
                  planoId={f.plano_id}
                  temAnestesista={f.tem_anestesista}
                  anestesistaCobraDireto={f.anestesista_cobra_direto}
                  onAlterado={recarregarListas}
                  materiaisListas={materiaisListas}
                  materiais={materiais}
                  onMateriais={setMateriais}
                  // v48.117 — Lista de material gravada na hora, direto na
                  // edição: entra no estado já, sem esperar um recarregamento.
                  onListaCriada={l => setMateriaisListas(a => [...a, l])}/>
                {/* v48.119 — Aviso de item repetido entre os materiais dos
                    procedimentos escolhidos (ex.: trocarte da BP e da CCC).
                    A resolução de verdade (manter 1 ou os 2) é em
                    "Solicitação de cirurgia" — ver DocumentosCirurgia.tsx. */}
                {materiaisRepetidos.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                    Item repetido entre os materiais escolhidos: {materiaisRepetidos.map(r => r.linha).join('; ')}.
                    Ao gerar a solicitação, entra uma vez só — dá para mudar isso lá.
                  </p>
                )}
              </div>

              {/* v48.25 — A via estava escondida dentro da abreviação: HIEr é a
                  robótica, HIE é a de vídeo. Quem não cresceu com essa tabela na
                  cabeça não tinha como saber, e é informação que o hospital, o
                  convênio e o próprio paciente perguntam. Vem preenchida pela
                  cirurgia escolhida e continua editável. */}
              <div>
                <label className={label}>Via de acesso</label>
                <select
                  value={f.via_acesso || viaPrincipal(itensValidos) || ''}
                  onChange={e => set('via_acesso', e.target.value)}
                  className={input}>
                  <option value="">Selecione...</option>
                  {vias.map(v => <option key={v.id} value={v.nome}>{v.nome}</option>)}
                  {/* Cirurgia antiga pode ter uma via que saiu da lista. Some
                      da tela seria pior do que mostrar: o dado existe. */}
                  {f.via_acesso && !vias.some(v => v.nome === f.via_acesso) && (
                    <option value={f.via_acesso}>{f.via_acesso}</option>
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label}>Hospital</label>
                  <HospitalPausaMed
                    valor={{ nome: f.hospital, cidade: f.hospital_cidade, estado: f.hospital_estado, pausamedId: f.hospital_pausamed_id }}
                    className={input}
                    onEscolher={(h: HospitalValor) => setF(a => ({
                      ...a, hospital: h.nome, hospital_cidade: h.cidade, hospital_estado: h.estado, hospital_pausamed_id: h.pausamedId,
                    }))}/>
                </div>
                <div>
                  <label className={label}>Cirurgião</label>
                  <select value={f.cirurgiao_id ?? ''} className={input}
                    onChange={e => {
                      const o = equipe.find(x => x.id === e.target.value)
                      setF(a => ({ ...a, cirurgiao_id: e.target.value || null, cirurgiao: o?.nome ?? '' }))
                    }}>
                    <option value="">Selecione...</option>
                    {equipe.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={label}>Condição</label>
                  <select value={f.modalidade} onChange={e => set('modalidade', e.target.value)} className={input}>
                    <option value="">Selecione...</option>
                    {modalidades.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
                  </select>
                </div>
                <div>
                  {/* v48.65 — Dá para cadastrar o convênio na hora: quem está
                      lançando a cirurgia não pode ser obrigado a sair da tela e
                      recomeçar só porque o convênio ainda não está na lista. */}
                  <label className={label}>Convênio</label>
                  <SelectComCriar
                    valor={f.convenio_id}
                    opcoes={convenios.map(c => ({ id: c.id, nome: c.nome }))}
                    tabela="cirurgia_convenios"
                    rotuloNovo="Nome do convênio"
                    className={input}
                    vazio="Particular (sem convênio)"
                    // Trocar de convênio zera o plano: plano é filho do
                    // convênio, e manter o antigo daria um par impossível.
                    onEscolher={(id, nome) => setF(a => ({ ...a, convenio_id: id, convenio: nome, plano_id: null, plano: '' }))}
                    onCriou={recarregarListas}/>
                </div>
              </div>

              {(f.convenio_id || pedeCarteirinha) && (
                <div className="bg-slate-50 rounded-xl p-3 space-y-3">
                  <p className="text-xs font-semibold text-slate-600">Dados do convênio</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={label}>Plano</label>
                      <select value={f.plano_id ?? ''} className={input}
                        onChange={e => {
                          const p = planos.find(x => x.id === e.target.value)
                          setF(a => ({ ...a, plano_id: e.target.value || null, plano: p?.nome ?? '' }))
                        }}>
                        <option value="">Sem plano específico</option>
                        {planos.filter(p => p.convenio_id === f.convenio_id).map(p => (
                          <option key={p.id} value={p.id}>{p.nome}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={label}>Carteirinha</label>
                      <input value={f.carteirinha} onChange={e => set('carteirinha', e.target.value)}
                        placeholder="número do beneficiário" className={input}/>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      {/* O nome na carteirinha nem sempre é o do cadastro —
                          nome de solteira, nome social, titular diferente do
                          paciente. O convênio recusa a guia quando diverge. */}
                      <label className={label}>Nome na carteirinha</label>
                      <input value={f.carteirinha_nome} onChange={e => set('carteirinha_nome', e.target.value)}
                        placeholder={f.paciente_nome || 'como está impresso'} className={input}/>
                    </div>
                    <div>
                      <label className={label}>Validade</label>
                      <input type="date" value={f.carteirinha_validade}
                        onChange={e => set('carteirinha_validade', e.target.value)} className={input}/>
                      {f.carteirinha_validade && f.data_cirurgia && f.carteirinha_validade < f.data_cirurgia && (
                        <p className="text-[11px] text-red-600 mt-1 font-semibold">
                          A carteirinha vence antes da data da cirurgia.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className={label}>Situação</label>
                <SelectComCriar
                  valor={f.status_id}
                  opcoes={status.map(x => ({ id: x.id, nome: x.nome }))}
                  tabela="cirurgia_status"
                  rotuloNovo="Nome da situação nova"
                  camposExtras={{ categoria: 'aberta', cor: '#64748b' }}
                  className={input}
                  onCriou={recarregarListas}
                  onEscolher={(id, nome) => {
                    const st = status.find(x => x.id === id)
                    // Carimba a data do passo, se ainda estiver vazia — a mesma
                    // regra da troca rápida pelo cartão.
                    setF(a => ({
                      ...a,
                      status_id: id,
                      status: nome,
                      categoria: st?.categoria ?? 'aberta',
                      ...datasDaSituacao(nome, a),
                    }))
                  }}/>
              </div>

              {/* v48.15 — O motivo aparece no instante em que a situação passa a
                  ser de cancelamento, e não numa tela seguinte. É agora que a
                  pessoa sabe o que houve; perguntar depois é receber "não
                  lembro". Vale também para NEGADA PELO CONVÊNIO, que é
                  cancelamento com uma causa já conhecida. */}
              {categoriaEscolhida === 'cancelada' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <label className="block text-xs font-semibold text-red-800 mb-1">
                    Motivo do cancelamento <span className="font-normal">(obrigatório)</span>
                  </label>
                  {/* v48.112 — Virou lista fixa (Configurações → Cirurgias →
                      Motivos de cancelamento) para dar estatística confiável no
                      Dashboard de Cirurgias — texto livre não soma. O detalhe
                      continua livre, é só complemento, não entra na conta. */}
                  <select
                    autoFocus={!f.motivo_cancelamento_id}
                    value={f.motivo_cancelamento_id || ''}
                    onChange={e => {
                      const id = e.target.value || null
                      const nome = motivos.find(m => m.id === id)?.nome || ''
                      setF(a => ({
                        ...a,
                        motivo_cancelamento_id: id,
                        motivo_cancelamento: [nome, motivoDetalhe.trim()].filter(Boolean).join(' — '),
                      }))
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300">
                    <option value="">Escolha um motivo...</option>
                    {motivos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                  {motivos.length === 0 && (
                    <p className="mt-1 text-[11px] text-red-700/70">
                      Nenhum motivo cadastrado ainda. Cadastre em Configurações → Cirurgias → Motivos de
                      cancelamento.
                    </p>
                  )}
                  {/* Cirurgia antiga, cancelada antes desta versão: só tinha texto
                      livre, sem id. Mostra o que já foi escrito como referência e
                      pede a categoria antes de salvar de novo. */}
                  {!f.motivo_cancelamento_id && f.motivo_cancelamento && (
                    <p className="mt-1 text-[11px] text-red-700/70">
                      Motivo registrado antes desta lista existir: "{f.motivo_cancelamento}". Escolha a
                      categoria mais próxima acima para poder salvar.
                    </p>
                  )}
                  <textarea
                    value={motivoDetalhe}
                    onChange={e => {
                      const detalhe = e.target.value
                      setMotivoDetalhe(detalhe)
                      const nome = motivos.find(m => m.id === f.motivo_cancelamento_id)?.nome || ''
                      set('motivo_cancelamento', [nome, detalhe.trim()].filter(Boolean).join(' — '))
                    }}
                    rows={2}
                    placeholder="Detalhe (opcional): o que mais ajuda a entender, além da categoria acima."
                    className="mt-2 w-full px-3 py-2 text-sm bg-white border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300"/>
                  <p className="mt-1 text-[11px] text-red-700/70">
                    Fica no cartão da cirurgia e no histórico. É o que responde a pergunta que aparece
                    meses depois, quando o paciente volta.
                  </p>
                </div>
              )}

              {/* v48.161 — Pedido do Jorge: "Mensagens ao paciente" (cartas) e
                  "Mensagens de pré e pós-operatório" (agenda automática) eram
                  dois cartões separados, com a descrição cirúrgica no meio —
                  difícil ver o que foi enviado e o que ainda está pendente num
                  olhar só. Agora é um campo único. Só faz sentido depois que a
                  cirurgia existe: antes de salvar não há o que mostrar nem
                  programar. */}
              {!novo && (
                <MensagemAoPaciente
                  cirurgiaId={f.id}
                  contactId={f.contact_id}
                  dataCirurgia={f.data_cirurgia}
                  status={f.status}/>
              )}

              {/* v48.59 — descrição cirúrgica (RGO) + situação no Google Agenda.
                  Anexar/enviar marca como realizada no banco; o formulário
                  acompanha, para o "Salvar" não desfazer. */}
              {!novo && (
                <DescricaoCirurgica cirurgiaId={f.id}
                  onRealizada={s => setF(a => ({ ...a, status: s.status, status_id: s.status_id, categoria: s.categoria }))}/>
              )}

              {/* v48.74 — Os diagnósticos deste paciente, que vão nas cartas. */}
              {!novo && (
                <DiagnosticosDaCirurgia cirurgiaId={f.id}
                  procedimentoIds={itens.map(i => i.procedimento_id).filter(Boolean) as string[]}/>
              )}

              {/* v48.69 — Documentos da cirurgia. Começa pelo orçamento; as
                  outras cartas entram aqui, no mesmo lugar.
                  v48.95 — Destacado: era um cartão cinza igual a todos os
                  outros, fácil de passar batido no meio da tela — e é daqui
                  que sai orçamento, solicitação, internação e reembolso. */}
              {/* v48.97 — Medicações antes de Documentos, de propósito: a
                  Suspensão de medicamentos (abaixo) só gera com todas
                  completas, então revisar aqui primeiro evita ir e voltar. */}
              {!novo && (
                <div ref={medicamentosRef}
                  className={'rounded-2xl transition-shadow ' + (realcarMedicamentos ? 'ring-2 ring-brand-400 ring-offset-2' : '')}>
                  <MedicamentosCirurgia cirurgiaId={f.id}/>
                </div>
              )}

              {!novo && (
                <div className="bg-brand-50/70 border-2 border-brand-200 rounded-2xl p-4 space-y-2.5">
                  <p className="text-sm font-bold text-brand-800 flex items-center gap-1.5">
                    <FileText size={15}/> Emissão de documentos
                  </p>
                  <p className="text-[11px] text-brand-700/70 -mt-1.5">
                    Orçamento, solicitação de cirurgia, internação, reembolso e suspensão de medicamentos.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <DocumentosCirurgia cirurgiaId={f.id}/>
                  </div>
                </div>
              )}

              <div className="bg-slate-50 rounded-xl p-3 space-y-3">
                <p className="text-xs font-semibold text-slate-600">Composição da equipe</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Auxiliares</label>
                    <input type="number" min={0} value={f.equipe_auxiliares}
                      onChange={e => set('equipe_auxiliares', Number(e.target.value) || 0)} className={input}/>
                  </div>
                  <div>
                    <label className={label}>Instrumentadores</label>
                    <input type="number" min={0} value={f.equipe_instrumentadores}
                      onChange={e => set('equipe_instrumentadores', Number(e.target.value) || 0)} className={input}/>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={f.tem_anestesista}
                    onChange={e => set('tem_anestesista', e.target.checked)} className="rounded"/>
                  Tem anestesista na equipe
                </label>
                {f.tem_anestesista && (
                  <label className="flex items-center gap-2 text-sm text-slate-600 pl-6">
                    <input type="checkbox" checked={f.anestesista_cobra_direto}
                      onChange={e => set('anestesista_cobra_direto', e.target.checked)} className="rounded"/>
                    O anestesista cobra direto do paciente
                  </label>
                )}
                {textoEquipe(f.equipe_auxiliares, f.equipe_instrumentadores, f.tem_anestesista) && (
                  <p className="text-[11px] text-slate-400">
                    Na carta: {textoEquipe(f.equipe_auxiliares, f.equipe_instrumentadores, f.tem_anestesista)}
                  </p>
                )}
              </div>

              <div className="bg-slate-50 rounded-xl p-3 space-y-3">
                <p className="text-xs font-semibold text-slate-600">Valores</p>

                {itensValidos.length === 0 && (
                  // v48.85 — Antes o quadro simplesmente não aparecia, e a
                  // conta parecia ter sumido. Dizer por que não há cálculo é
                  // melhor do que não mostrar nada.
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    Sem cálculo: nenhum procedimento desta cirurgia está ligado ao cadastro.
                    Escolha a cirurgia na lista acima para o orçamento ser calculado.
                  </p>
                )}
                {itensValidos.length > 0 && (
                  <div className="text-[11px] text-slate-500 bg-white rounded-lg px-3 py-2 space-y-0.5">
                    {/* De qual tabela o valor veio. Sem isso, um preço de
                        convênio e um particular são indistinguíveis na tela — e
                        a diferença costuma ser grande. */}
                    {preco && (
                      <p className="text-[10px] text-slate-400 pb-0.5">Valores da {preco.rotulo}</p>
                    )}
                    {/* Uma linha por procedimento, com a base e o que entra:
                        numa cirurgia conjugada, o total sozinho não deixa
                        conferir nada. */}
                    {itensValidos.map((i, k) => (
                      <div key={k} className="flex justify-between">
                        <span>
                          {i.sigla || '—'}
                          {f.tem_anestesista && !f.anestesista_cobra_direto && Number(i.valor_anestesista) > 0
                            && ` (${brl(Number(i.valor_equipe))} + ${brl(Number(i.valor_anestesista))} anest.)`}
                          {i.valor_manual && ' · à mão'}
                          {itensValidos.length > 1 && conta.entram[k] !== conta.bases[k] && ' · 50%'}
                        </span>
                        <span>{brl(conta.entram[k])}</span>
                      </div>
                    ))}
                    {itensValidos.length > 1 && (
                      <p className="text-[10px] text-slate-400">
                        Cirurgia conjugada: o de maior valor entra inteiro, os outros por 50% —
                        a mesma conta da planilha.
                      </p>
                    )}
                    {f.tem_anestesista && f.anestesista_cobra_direto && (
                      <div className="flex justify-between text-slate-300">
                        <span>Anestesista</span><span>cobra direto do paciente</span>
                      </div>
                    )}
                    {Number(f.ajuste_valor) !== 0 && (
                      <div className="flex justify-between"><span>{Number(f.ajuste_valor) < 0 ? 'Desconto' : 'Ajuste'}</span><span>{brl(Number(f.ajuste_valor))}</span></div>
                    )}
                    <div className="flex justify-between font-semibold text-slate-700 border-t border-slate-100 pt-0.5 mt-0.5">
                      <span>Orçamento calculado</span><span>{cobradoCalculado === null ? '—' : brl(cobradoCalculado)}</span>
                    </div>
                  </div>
                )}

                <div>
                  <div>
                    <label className={label}>Valor cobrado</label>
                    <input type="number" step="0.01" value={f.valor_cobrado ?? ''} className={input}
                      onChange={e => setF(a => ({
                        ...a,
                        valor_cobrado: e.target.value === '' ? null : Number(e.target.value),
                        valor_cobrado_manual: true,
                      }))}/>
                    {/* v48.85 — A conta escrita por extenso, ao lado do campo.
                        O quadro de cima detalha procedimento por procedimento;
                        aqui fica a linha que responde "de onde veio este
                        número" sem precisar somar de cabeça. */}
                    {cobradoCalculado !== null && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        {brl(conta.total)}
                        {Number(f.ajuste_valor) !== 0 && (
                          <> {Number(f.ajuste_valor) < 0 ? '−' : '+'} {brl(Math.abs(Number(f.ajuste_valor)))}
                            {' '}({Number(f.ajuste_valor) < 0 ? 'desconto' : 'ajuste'})</>
                        )}
                        {' = '}<span className="font-semibold text-slate-700">{brl(cobradoCalculado)}</span>
                      </p>
                    )}
                    {f.valor_cobrado_manual && cobradoCalculado !== null ? (
                      <button type="button"
                        onClick={() => setF(a => ({ ...a, valor_cobrado_manual: false, valor_cobrado: cobradoCalculado }))}
                        className="text-[11px] text-brand-600 font-semibold mt-1">
                        digitado à mão — usar o calculado ({brl(cobradoCalculado)})
                      </button>
                    ) : cobradoCalculado !== null ? (
                      // Dizer que o campo se cuida sozinho evita a dúvida de
                      // sempre: "mudei o procedimento, preciso corrigir o valor?"
                      <p className="text-[11px] text-slate-400 mt-1">Segue o orçamento calculado.</p>
                    ) : null}
                  </div>
                  {/* v48.69 — A prévia saiu.
                      Não existe mais documento de prévia: o mesmo orçamento é o
                      que o paciente manda ao convênio para análise, e o próprio
                      documento diz isso. Manter um segundo valor "cobrado + 30%"
                      só criava a dúvida de qual dos dois é o preço. O campo
                      antigo continua no banco, intocado, para não apagar o
                      histórico de quem já tinha valor gravado. */}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={label}>Desconto / ajuste</label>
                    <input type="number" step="0.01" value={f.ajuste_valor} onChange={e => set('ajuste_valor', e.target.value)} className={input}/>
                    <p className="text-[11px] text-slate-400 mt-1">Negativo para desconto.</p>
                  </div>
                  <div>
                    <label className={label}>Forma</label>
                    <select value={f.forma_pagamento} onChange={e => set('forma_pagamento', e.target.value)} className={input}>
                      <option value="">—</option>
                      {formas.map(x => <option key={x.id} value={x.nome}>{x.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>Parcelas</label>
                    <input type="number" min={1} value={f.parcelas ?? ''} onChange={e => set('parcelas', e.target.value === '' ? null : Number(e.target.value))} className={input}/>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={f.pago} onChange={e => {
                    // Marcar não tem risco — quem clicou errado desmarca na hora.
                    // Desmarcar um pagamento já confirmado é o que exige a senha.
                    if (!e.target.checked && f.pago) { setSenhaPago(''); setSenhaPagoErro(''); setPedirSenhaPago(true); return }
                    set('pago', e.target.checked)
                  }} className="rounded"/>
                  Pago
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={label}>Data pré-operatório</label>
                  <input type="date" value={f.data_pre_operatorio} onChange={e => set('data_pre_operatorio', e.target.value)} className={input}/>
                </div>
                <div>
                  <label className={label}>Solicitado ao hospital</label>
                  <input type="date" value={f.data_solicitado_hospital} onChange={e => set('data_solicitado_hospital', e.target.value)} className={input}/>
                </div>
                <div>
                  <label className={label}>Autorização</label>
                  <input type="date" value={f.data_autorizacao} onChange={e => set('data_autorizacao', e.target.value)} className={input}/>
                </div>
              </div>

              {/* v48.154 — Pedido do Jorge: "não precisamos de Medicações em
                  uso porque temos Medicações e suspensão" — tirado daqui, a
                  lista estruturada (mais abaixo, MedicamentosCirurgia) é a
                  única entrada de medicação agora. cirurgias.medicacoes
                  continua existindo (a Google Agenda usa para mostrar
                  "MEDICAÇÕES EM USO" na descrição do evento) — só que agora é
                  gerado sozinho a partir da lista estruturada, não digitado
                  aqui (ver sincronizarMedicacoesTexto em
                  app/api/cirurgias/[id]/medicamentos/route.ts). */}
              <div>
                <label className={label}>Observação</label>
                <textarea value={f.observacao} onChange={e => set('observacao', e.target.value)} rows={2} className={input}/>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
          {!novo && (
            <button onClick={excluir} disabled={excluindo || salvando}
              title="Excluir esta cirurgia"
              className="px-3 py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
              {excluindo ? <Loader2 size={15} className="animate-spin"/> : <Trash2 size={15}/>}
            </button>
          )}
          <button onClick={onFechar} className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600">Cancelar</button>
          <button onClick={salvar} disabled={salvando || verHistorico}
            className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {salvando ? <><Loader2 size={15} className="animate-spin"/> Salvando...</> : <><Save size={15}/> Salvar</>}
          </button>
        </div>
      </div>
    </div>

    {pedirSenhaPago && (
      <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={() => setPedirSenhaPago(false)}>
        <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-800">Desmarcar como pago</h2>
            <p className="text-xs text-slate-400 mt-0.5">Exige a senha administrativa — a mesma de Configurações → Sofia.</p>
          </div>
          <div className="px-5 py-4 space-y-2">
            {senhaPagoErro && <p className="text-xs text-red-600">{senhaPagoErro}</p>}
            <input type="password" value={senhaPago} onChange={e => setSenhaPago(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmarDesfazerPago()}
              placeholder="Senha administrativa" autoFocus
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
          </div>
          <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
            <button onClick={() => setPedirSenhaPago(false)} className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button onClick={confirmarDesfazerPago} disabled={verificandoSenhaPago}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
              {verificandoSenhaPago ? <Loader2 size={13} className="animate-spin"/> : null}
              Confirmar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
