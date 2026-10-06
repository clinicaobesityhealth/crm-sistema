'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Toast, { Aviso } from '@/components/Toast'
import { calcularConjugadas, ITEM_VAZIO } from '@/lib/itensCirurgia'
import { lerComposicao } from '@/lib/honorarios'
import {
  AlertCircle, Check, ChevronLeft, Download, Loader2, Paperclip, Pill, Plus, Search, Sparkles, Stethoscope, Trash2, X, XCircle,
} from 'lucide-react'
import HospitalPausaMed, { ultimoHospitalUsado, type HospitalValor } from '@/components/HospitalPausaMed'
import { acharRepetidos } from '@/lib/materiaisCirurgia'

// v48.76 — Agendamento pelo cirurgião.
//
// O link é um só e ele escolhe o próprio nome; dali em diante a tela é dele:
// as cirurgias que aparecem, as sugestões de procedimento, tudo filtrado pelo
// que ele escolheu. Sem login — a chave longa no endereço é a senha.
//
// O formulário é curto de propósito. Valores, convênio autorizado, cartas e
// cobrança não estão aqui: são trabalho da secretaria, e cada campo a mais
// nesta tela é um motivo a mais para ele voltar a mandar por WhatsApp.

type Equipe = { id: string; nome_curto: string; nome_completo: string | null; funcao: string | null }
type Proc = { id: string; sigla: string; nome: string; valor_equipe?: number; valor_anestesista?: number }
type Contato = {
  id: string; nome: string; telefone: string | null; id_medx?: string | null; origem?: string
  // v48.106
  alergico?: boolean; alergia_obs?: string | null
}
type Minha = {
  id: string; contact_id: string | null; paciente_nome: string; paciente_telefone: string | null
  data_cirurgia: string | null; hora: string | null
  hospital: string | null
  // v48.110 — Hospital vindo da base nacional do PausaMed (cidade/estado/id),
  // para reabrir a cirurgia sem perder o vínculo com aquele hospital.
  hospital_estado?: string | null; hospital_cidade?: string | null; hospital_pausamed_id?: string | null
  status: string | null; status_id: string | null; procedimento_sigla: string | null
  valor_cobrado: number | null; valor_cobrado_manual: boolean | null
  procedimento_nome: string | null; observacao: string | null; categoria: string | null
  motivo_cancelamento: string | null
  modalidade: string | null; convenio_id: string | null; convenio: string | null
  via_acesso: string | null; medicacoes: string | null; composicao_equipe: string | null
  // v48.87 — Os procedimentos escolhidos, para reabrir sem perder a cirurgia.
  itens?: Proc[]
  // v48.100 — As listas de materiais que ele escolheu, uma por procedimento.
  material_listas_ids?: string[] | null
  // v48.106 — Alergia do paciente, só para mostrar (quem cadastra é a
  // secretaria, pelo CRM).
  alergico?: boolean
  alergia_obs?: string | null
}
// v48.117 — "itens" a mais: Jorge pediu para o cirurgião poder VER o
// material escolhido aqui, não só o nome da lista (antes era só nome/padrão
// — ver o comentário de v48.100 no route.ts).
type MaterialLista = { id: string; procedimento_id: string; nome: string; padrao: boolean; itens: string }
type Config = {
  equipe: Equipe[]; hospitais: string[]; convenios: { id: string; nome: string }[]
  modalidades: string[]; vias: string[]; procedimentos: Proc[]
  materiaisListas: MaterialLista[]
  frequentes: { procedimento_id: string; sigla: string; nome: string; valor_equipe?: number; valor_anestesista?: number }[]
  minhas: Minha[]
  // A cor de cada situação, pelo nome — a mesma que o CRM usa na lista.
  cores: Record<string, string>
  situacoes: {
    preop: { id: string; nome: string; cor?: string }
    agendar: { id: string; nome: string; cor?: string }
    cancelada: { id: string; nome: string; cor?: string }
  }
}

const CINZA = '#64748b'

// v48.102 — Rótulo fixo para as 3 situações do médico, independente de como
// a clínica batizou o status por trás (ver LinkCirurgiaoAba.tsx): o médico só
// precisa saber "pré-operatório / agendar / cancelada" — o nome interno do
// status (ex.: "Solicitado Orçamento") é assunto da secretaria, não dele.
const ROTULO_SITUACAO: Record<'preop' | 'agendar' | 'cancelada', string> = {
  preop: 'Pré-operatório', agendar: 'Agendar', cancelada: 'Cancelada',
}

// v48.102 — Mesmas duas funções de EscolherProcedimento.tsx, duplicadas aqui
// de propósito: aquele arquivo importa o cliente supabase do navegador, que
// não pode entrar nesta página pública (tudo passa pelo chamar(), com o token
// validado no servidor — ver o comentário no topo do arquivo).
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
function viaDoNome(nome: string) {
  const n = (nome || '').toLowerCase()
  if (/rob[óo]tic/.test(n)) return 'ROBÓTICA'
  if (/laparoscop|videolaparoscop/.test(n)) return 'VIDEOLAPAROSCOPIA'
  return ''
}

const VAZIO = {
  id: '', contact_id: '', paciente_nome: '', paciente_telefone: '',
  data_cirurgia: '', hora: '', hospital: '',
  // v48.110 — Hospital da base nacional do PausaMed (ver HospitalPausaMed.tsx).
  hospital_estado: null as string | null, hospital_cidade: null as string | null, hospital_pausamed_id: null as string | null,
  modalidade: '', convenio_id: '', convenio: '',
  via_acesso: '', medicacoes: '', observacao: '', valor_cobrado: '',
  // v48.142 — Pedido do Jorge: pré-preencher com 2 auxiliares e 1
  // instrumentador (o mais comum), podendo alterar se a cirurgia for
  // diferente. Só vale para cirurgia NOVA — reabrir uma já cadastrada sempre
  // sobrescreve com o que foi salvo (ver abrirExistente logo abaixo).
  auxiliares: 2, instrumentadores: 1, anestesista: false,
  situacao: 'preop' as 'preop' | 'agendar' | 'cancelada',
  motivo_cancelamento: '',
  procedimentos: [] as Proc[],
  // v48.100 — A lista de materiais escolhida, por procedimento_id. Para a
  // secretaria não ter que adivinhar qual foi combinada na sala.
  materiais: {} as Record<string, string>,
  // Ligado quando o cirurgião digita por cima: dali em diante o cálculo para
  // de mexer no campo, porque o que ele combinou vale mais que a tabela.
  valor_manual: false,
  // v48.106 — Alergia do paciente escolhido, só para mostrar o selo.
  alergico: false,
  alergia_obs: null as string | null,
}

export default function AgendarCirurgiaPage() {
  const params = useParams<{ token: string }>()
  const token = String(params?.token || '')

  const [cfg, setCfg] = useState<Config | null>(null)
  const [erro, setErro] = useState('')
  const [medico, setMedico] = useState<Equipe | null>(null)
  const [marca, setMarca] = useState<{ logo: string | null; cor: string; nome: string }>({ logo: null, cor: '#0c8ee7', nome: 'Obesity Health' })

  const [f, setF] = useState({ ...VAZIO })
  const [tela, setTela] = useState<'lista' | 'form'>('lista')
  const [ocupado, setOcupado] = useState('')
  const [aviso, setAviso] = useState('')
  const [toast, setToast] = useState<Aviso>(null)

  const [buscaPac, setBuscaPac] = useState('')
  const [contatos, setContatos] = useState<Contato[]>([])
  const [buscandoPac, setBuscandoPac] = useState(false)
  const [buscaProc, setBuscaProc] = useState('')
  // v48.102 — Igual à busca de cirurgia do CRM (EscolherProcedimento.tsx):
  // além das já cadastradas (filtradas localmente em procFiltrados, do que já
  // veio no GET), busca também no catálogo TUSS da ANS, para o cirurgião
  // achar uma cirurgia que a clínica ainda não opera e já cadastrar na hora.
  const [sugestoesTuss, setSugestoesTuss] = useState<{ codigo: string; nome: string }[]>([])
  const [buscandoTuss, setBuscandoTuss] = useState(false)
  const [novoDoTuss, setNovoDoTuss] = useState<{ codigo: string; nome: string } | null>(null)
  // A cirurgia cuja situação está sendo trocada pela etiqueta da lista.
  const [trocando, setTrocando] = useState<Minha | null>(null)
  const [motivo, setMotivo] = useState('')
  const [buscaLista, setBuscaLista] = useState('')
  // v48.106 — Qual cartão está com a alergia aberta, clicando no selo.
  const [verAlergiaId, setVerAlergiaId] = useState<string | null>(null)
  const [verAlergiaForm, setVerAlergiaForm] = useState(false)
  const inputArquivo = useRef<HTMLInputElement>(null)
  // v48.86 — Cirurgia sem valor de tabela: o cirurgião digita o valor aqui, e
  // este mapa guarda se ele quer que esse valor vire o de tabela dali pra
  // frente (por procedimento_id). Some junto com o procedimento.
  const [salvarNoCadastro, setSalvarNoCadastro] = useState<Record<string, boolean>>({})
  // v48.117 — Qual procedimento está com o formulário de "nova lista de
  // material" aberto — um só por vez, igual ao novoDoTuss acima.
  const [novaLista, setNovaLista] = useState<string | null>(null)

  // v48.85 — O mesmo cálculo do CRM, aqui.
  //
  // O cirurgião vê o valor de tabela já preenchido e ajusta se combinou outra
  // coisa — assim a secretária recebe exatamente o que foi acordado, e não um
  // campo em branco para ela adivinhar.
  //
  // Fica antes dos efeitos de propósito: um deles depende deste valor, e uma
  // constante declarada depois quebraria na primeira renderização.
  const conta = calcularConjugadas(
    f.procedimentos.map(p => ({
      ...ITEM_VAZIO, procedimento_id: p.id, sigla: p.sigla, nome: p.nome,
      valor_equipe: Number(p.valor_equipe) || 0,
      valor_anestesista: Number(p.valor_anestesista) || 0,
    })),
    { temAnestesista: f.anestesista, anestesistaCobraDireto: false },
  )
  const calculado = f.procedimentos.length ? conta.total : 0

  const chamar = useCallback(async (corpo: any) => {
    const r = await fetch(`/api/agendar-cirurgia/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
    return j
  }, [token])

  const carregar = useCallback(async (equipeId?: string) => {
    const r = await fetch(`/api/agendar-cirurgia/${token}` + (equipeId ? `?equipe=${equipeId}` : ''), { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j) throw new Error(j?.erro || 'Link inválido.')
    setCfg(j)
    return j as Config
  }, [token])

  useEffect(() => {
    carregar().catch(e => setErro(e.message))
    supabase.from('clinic_branding').select('logo_url, primary_color, clinic_name')
      .eq('clinic_id', '00000000-0000-0000-0000-000000000001').maybeSingle()
      .then(({ data }) => { if (data) setMarca({ logo: data.logo_url || null, cor: data.primary_color || '#0c8ee7', nome: data.clinic_name || 'Obesity Health' }) })
  }, [token, carregar])

  // Quem ele é fica guardado no aparelho: ele não escolhe o próprio nome toda
  // vez que abre o link.
  useEffect(() => {
    if (!cfg || medico) return
    try {
      const salvo = localStorage.getItem('crm_cirurgiao_id')
      const m = cfg.equipe.find(x => x.id === salvo)
      if (m) escolherMedico(m)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg])

  // v48.100 — Ao entrar um procedimento sem material escolhido ainda, já marca
  // a lista padrão — ele troca se não for a certa, em vez de partir do zero
  // toda vez.
  useEffect(() => {
    if (!cfg?.materiaisListas?.length || !f.procedimentos.length) return
    setF(a => {
      let mudou = false
      const materiais = { ...a.materiais }
      for (const p of a.procedimentos) {
        if (materiais[p.id]) continue
        const opcoes = cfg.materiaisListas.filter(l => l.procedimento_id === p.id)
        const escolhida = opcoes.find(l => l.padrao) || opcoes[0]
        if (escolhida) { materiais[p.id] = escolhida.id; mudou = true }
      }
      return mudou ? { ...a, materiais } : a
    })
  }, [cfg, f.procedimentos])

  async function escolherMedico(m: Equipe) {
    setMedico(m)
    try { localStorage.setItem('crm_cirurgiao_id', m.id) } catch {}
    try { await carregar(m.id) } catch (e: any) { setErro(e.message) }
  }

  useEffect(() => {
    const q = buscaPac.trim()
    if (q.length < 3) { setContatos([]); return }
    const t = setTimeout(async () => {
      setBuscandoPac(true)
      try { const j = await chamar({ acao: 'buscar_paciente', termo: q }); setContatos(j.contatos || []) }
      catch {}
      setBuscandoPac(false)
    }, 300)
    return () => clearTimeout(t)
  }, [buscaPac, chamar])

  // v48.102 — Mesma busca do catálogo TUSS que o CRM já tem, só que aqui: o
  // que já está cadastrado na clínica é filtrado localmente (procFiltrados,
  // do que já veio no GET); o catálogo da ANS é consultado à parte, para não
  // sobrecarregar a página inicial com a tabela inteira.
  useEffect(() => {
    const q = buscaProc.trim()
    if (q.length < 2) { setSugestoesTuss([]); return }
    const t = setTimeout(async () => {
      setBuscandoTuss(true)
      try { const j = await chamar({ acao: 'buscar_tuss', termo: q }); setSugestoesTuss(j.tuss || []) }
      catch {}
      setBuscandoTuss(false)
    }, 300)
    return () => clearTimeout(t)
  }, [buscaProc, chamar])

  async function confirmarNovoDoTuss(sigla: string, via: string) {
    if (!novoDoTuss) return
    setOcupado('cadastrar_procedimento'); setErro('')
    try {
      const j = await chamar({ acao: 'cadastrar_procedimento', nome: novoDoTuss.nome, sigla, codigo: novoDoTuss.codigo, via })
      setF(a => ({ ...a, procedimentos: [...a.procedimentos, j.procedimento] }))
      setNovoDoTuss(null); setBuscaProc(''); setSugestoesTuss([])
      // A lista de cadastradas (cfg.procedimentos) fica desatualizada até a
      // próxima recarga — não atrapalha: o procedimento já entrou na cirurgia,
      // e a próxima busca já o acha entre as cadastradas.
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  // v48.116 — Mesma folga do procedimento, agora pro convênio: o cirurgião
  // não sabia o convênio do paciente aqui na lista, e antes disso significava
  // sair da tela de agendamento, avisar a secretária e voltar depois. Agora
  // cadastra na hora, igual já acontecia dentro do CRM.
  async function criarConvenio() {
    const nome = window.prompt('Nome do convênio')?.trim()
    if (!nome) return
    const igual = cfg?.convenios.find(c => c.nome.localeCompare(nome, 'pt-BR', { sensitivity: 'base' }) === 0)
    if (igual) { setF(a => ({ ...a, convenio_id: igual.id, convenio: igual.nome })); return }
    setOcupado('criar_convenio'); setErro('')
    try {
      const j = await chamar({ acao: 'criar_convenio', nome })
      setCfg(a => a ? { ...a, convenios: [...a.convenios, j.convenio] } : a)
      setF(a => ({ ...a, convenio_id: j.convenio.id, convenio: j.convenio.nome }))
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  // v48.117 — Gravar uma lista de materiais nova, direto no agendamento:
  // Jorge pediu para o cirurgião poder ver o material escolhido e escolher
  // entre os prontos OU gravar um novo, sem precisar avisar a secretária. O
  // nome pode repetir o mesmo texto de outra lista do mesmo procedimento —
  // aí o servidor devolve a que já existe em vez de criar duplicada, mesma
  // regra do SelectComCriar usado no CRM.
  async function criarMaterial(procedimentoId: string, nome: string, itensTexto: string) {
    setOcupado('criar_material_lista'); setErro('')
    try {
      const j = await chamar({ acao: 'criar_material_lista', procedimento_id: procedimentoId, nome, itens: itensTexto })
      setCfg(a => a ? { ...a, materiaisListas: [...a.materiaisListas.filter(l => l.id !== j.lista.id), j.lista] } : a)
      setF(a => ({ ...a, materiais: { ...a.materiais, [procedimentoId]: j.lista.id } }))
      setNovaLista(null)
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  // Escolhido um paciente que só existe no MedX, o contato nasce no CRM aqui —
  // é o mesmo trabalho que a secretária faria depois, feito no momento certo.
  async function escolherPaciente(c: Contato) {
    setContatos([]); setBuscaPac('')
    if (c.id) {
      setF(a => ({ ...a, contact_id: c.id, paciente_nome: c.nome, paciente_telefone: c.telefone || '', alergico: !!c.alergico, alergia_obs: c.alergia_obs || null }))
      return
    }
    setOcupado('paciente')
    try {
      const j = await chamar({ acao: 'criar_paciente', nome: c.nome, telefone: c.telefone || '', id_medx: c.id_medx || '' })
      // Paciente novo no CRM: não tem alergia cadastrada ainda.
      setF(a => ({ ...a, contact_id: j.contato.id, paciente_nome: j.contato.nome, paciente_telefone: j.contato.telefone || '', alergico: false, alergia_obs: null }))
    } catch (e: any) {
      // Falhou o cadastro: segue com o nome digitado, que é melhor do que
      // travar o lançamento da cirurgia.
      setF(a => ({ ...a, contact_id: '', paciente_nome: c.nome, paciente_telefone: c.telefone || '', alergico: false, alergia_obs: null }))
    }
    setOcupado('')
  }

  // Enquanto ele não digitar, o campo segue a tabela — inclusive ao trocar de
  // procedimento ou marcar o anestesista.
  useEffect(() => {
    if (f.valor_manual) return
    const novo = calculado > 0 ? String(calculado) : ''
    setF(a => a.valor_cobrado === novo ? a : { ...a, valor_cobrado: novo })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculado, f.valor_manual])

  async function salvar() {
    setOcupado('salvar'); setErro(''); setAviso('')
    try {
      const composicao = [
        f.auxiliares > 0 ? `${f.auxiliares} ${f.auxiliares === 1 ? 'AUXILIAR' : 'AUXILIARES'}` : '',
        f.instrumentadores > 0 ? `${f.instrumentadores} ${f.instrumentadores === 1 ? 'INSTRUMENTADOR' : 'INSTRUMENTADORES'}` : '',
        f.anestesista ? '1 ANESTESISTA' : '',
      ].filter(Boolean).join(', ')

      const j = await chamar({
        acao: 'salvar', ...f,
        cirurgiao_id: medico?.id,
        composicao_equipe: composicao,
        procedimentos: f.procedimentos.map(p => ({ procedimento_id: p.id, sigla: p.sigla, nome: p.nome })),
        // v48.100 — Só os das cirurgias que continuam no formulário — se um
        // procedimento foi removido, a lista escolhida para ele some junto.
        materiais: f.procedimentos.map(p => f.materiais[p.id]).filter(Boolean),
      })
      const novo = !f.id
      setF(a => ({ ...a, id: j.id }))

      // v48.86 — Os valores que o cirurgião preencheu para procedimentos sem
      // tabela e marcou para guardar viram o valor de tabela a partir de
      // agora. Um por um, e um erro aqui não desfaz a cirurgia já salva.
      const paraGravar = f.procedimentos.filter(p => salvarNoCadastro[p.id] && Number(p.valor_equipe) > 0)
      for (const p of paraGravar) {
        try { await chamar({ acao: 'atualizar_valor_procedimento', procedimento_id: p.id, valor_equipe: p.valor_equipe }) } catch {}
      }
      if (paraGravar.length) setSalvarNoCadastro({})

      const texto = f.situacao === 'cancelada'
        ? 'Cancelamento registrado. A clínica foi avisada — a cirurgia sai desta lista.'
        : novo
          ? `Cirurgia de ${f.paciente_nome} lançada. A equipe da clínica foi avisada.`
          : 'Alterações salvas. A equipe da clínica foi avisada.'
      setAviso(texto)
      setToast({ texto: paraGravar.length ? texto + ' Valor de tabela atualizado.' : texto })
      await carregar(medico?.id)
    } catch (e: any) { setErro(e.message); setToast({ texto: e.message, tom: 'erro' }) }
    setOcupado('')
  }

  async function anexar(files: FileList | null) {
    if (!files?.length || !f.id) return
    setOcupado('anexar'); setErro('')
    const fd = new FormData()
    fd.append('cirurgia_id', f.id)
    Array.from(files).forEach(x => fd.append('arquivos', x))
    try {
      const r = await fetch(`/api/agendar-cirurgia/${token}`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
      setAviso('Documento anexado.')
      setToast({ texto: `${files.length > 1 ? files.length + ' documentos anexados' : 'Documento anexado'}.` })
    } catch (e: any) { setErro(e.message); setToast({ texto: e.message, tom: 'erro' }) }
    setOcupado('')
    if (inputArquivo.current) inputArquivo.current.value = ''
  }

  async function trocarSituacao(qual: 'preop' | 'agendar' | 'cancelada') {
    if (!trocando) return
    if (qual === 'cancelada' && !motivo.trim()) { setErro('Escreva o motivo do cancelamento.'); return }
    setOcupado('situacao'); setErro('')
    try {
      const nome = trocando.paciente_nome
      const alvo = cfg.situacoes[qual]?.nome || qual
      await chamar({ acao: 'situacao', id: trocando.id, situacao: qual, motivo_cancelamento: motivo })
      setTrocando(null); setMotivo('')
      setToast({ texto: `${nome}: situação alterada para ${alvo}.` })
      await carregar(medico?.id)
    } catch (e: any) { setErro(e.message); setToast({ texto: e.message, tom: 'erro' }) }
    setOcupado('')
  }

  function abrirNova() {
    // v48.110 — Mesma regra do CRM (CirurgiaModal.tsx): cirurgia nova já abre
    // com o último hospital escolhido por ele, porque na prática é quase
    // sempre o mesmo — poupa ele de escolher de novo toda vez.
    const ultimo = ultimoHospitalUsado()
    setF({
      ...VAZIO,
      ...(ultimo ? { hospital: ultimo.nome, hospital_cidade: ultimo.cidade, hospital_estado: ultimo.estado, hospital_pausamed_id: ultimo.pausamedId } : {}),
    })
    setBuscaPac(''); setContatos([]); setBuscaProc(''); setAviso(''); setErro(''); setVerAlergiaForm(false); setTela('form')
  }
  function abrirExistente(m: Minha) {
    // v48.87 — Reabrir tem que devolver a cirurgia como ela ficou salva, não
    // um formulário em branco com só o nome do paciente — senão parece que os
    // procedimentos, o convênio, a equipe sumiram.
    const comp = lerComposicao(m.composicao_equipe || '')
    // v48.100 — Os ids salvos viram, de volta, um mapa por procedimento — é
    // assim que a tela sabe qual pílula marcar em cada cirurgia do formulário.
    const materiaisMap: Record<string, string> = {}
    for (const lid of (m.material_listas_ids || [])) {
      const l = cfg?.materiaisListas.find(x => x.id === lid)
      if (l) materiaisMap[l.procedimento_id] = l.id
    }
    setF({
      ...VAZIO, id: m.id, contact_id: m.contact_id || '',
      paciente_nome: m.paciente_nome || '', paciente_telefone: m.paciente_telefone || '',
      data_cirurgia: m.data_cirurgia || '', hora: (m.hora || '').slice(0, 5),
      hospital: m.hospital || '',
      hospital_estado: m.hospital_estado || null, hospital_cidade: m.hospital_cidade || null,
      hospital_pausamed_id: m.hospital_pausamed_id || null,
      observacao: m.observacao || '',
      modalidade: m.modalidade || '', convenio_id: m.convenio_id || '', convenio: m.convenio || '',
      via_acesso: m.via_acesso || '', medicacoes: m.medicacoes || '',
      auxiliares: comp.auxiliares, instrumentadores: comp.instrumentadores, anestesista: comp.anestesista,
      motivo_cancelamento: m.motivo_cancelamento || '',
      procedimentos: m.itens || [],
      materiais: materiaisMap,
      valor_cobrado: m.valor_cobrado === null || m.valor_cobrado === undefined ? '' : String(m.valor_cobrado),
      valor_manual: !!m.valor_cobrado_manual,
      alergico: !!m.alergico, alergia_obs: m.alergia_obs || null,
      // Abrir uma cirurgia que já está em "agendar" mostrando "pré-operatório"
      // faria o próprio salvamento andar para trás. A situação vem do id.
      situacao: m.status_id === cfg.situacoes.cancelada.id ? 'cancelada'
        : m.status_id === cfg.situacoes.agendar.id ? 'agendar'
        : m.categoria === 'cancelada' ? 'cancelada' : 'preop',
    })
    setAviso(''); setErro(''); setVerAlergiaForm(false); setTela('form')
  }

  const campo = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400'
  const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const rotulo = 'block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1'

  if (erro && !cfg) {
    return (
      <div className="h-[100dvh] flex items-center justify-center px-6 bg-slate-50">
        <div className="text-center max-w-sm">
          <XCircle size={30} className="text-slate-300 mx-auto mb-3"/>
          <p className="text-sm text-slate-600">{erro}</p>
        </div>
      </div>
    )
  }
  if (!cfg) {
    return <div className="h-[100dvh] flex items-center justify-center text-slate-400"><Loader2 className="animate-spin"/></div>
  }

  const cirurgioes = cfg.equipe.filter(m => /cirurgi/i.test(m.funcao || ''))

  // Sem acento e sem caixa dos dois lados: "joao" acha "JOÃO".
  const semAcento = (t: string) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const q = semAcento(buscaLista.trim())
  const listaFiltrada = q
    ? cfg.minhas.filter(m => semAcento(
        [m.paciente_nome, m.procedimento_sigla, m.procedimento_nome, m.hospital, m.status].filter(Boolean).join(' ')
      ).includes(q))
    : cfg.minhas
  const procFiltrados = buscaProc.trim().length >= 2
    ? cfg.procedimentos.filter(p => (p.sigla + ' ' + p.nome).toLowerCase().includes(buscaProc.trim().toLowerCase())).slice(0, 8)
    : []

  // --- escolher quem é ------------------------------------------------------
  if (!medico) {
    return (
      <div className="h-[100dvh] overflow-y-auto bg-slate-50 px-4 py-8">
        <div className="max-w-md mx-auto">
          <div className="flex flex-col items-center text-center mb-6">
            {marca.logo
              ? <img src={marca.logo} alt={marca.nome} className="w-16 h-16 object-contain mb-2"/>
              : <div className="w-16 h-16 rounded-full mb-2" style={{ background: marca.cor }}/>}
            <h1 className="text-base font-semibold text-slate-800">{marca.nome}</h1>
            <p className="text-xs text-slate-500">Agendamento de cirurgia</p>
          </div>
          <p className="text-sm text-slate-600 mb-3 text-center">Quem está lançando?</p>
          <div className="space-y-2">
            {cirurgioes.map(m => (
              <button key={m.id} onClick={() => escolherMedico(m)}
                className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3.5 text-left hover:border-slate-300">
                <Stethoscope size={16} className="text-slate-300 shrink-0"/>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{m.nome_curto}</p>
                  {m.nome_completo && <p className="text-xs text-slate-400 truncate">{m.nome_completo}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
        <Toast aviso={toast} aoFechar={() => setToast(null)}/>
      </div>
    )
  }

  // --- lista das cirurgias dele --------------------------------------------
  if (tela === 'lista') {
    return (
      <div className="h-[100dvh] overflow-y-auto bg-slate-50">
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          {marca.logo
            ? <img src={marca.logo} alt={marca.nome} className="w-9 h-9 object-contain"/>
            : <div className="w-9 h-9 rounded-full" style={{ background: marca.cor }}/>}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{medico.nome_curto}</p>
            <button onClick={() => { setMedico(null); try { localStorage.removeItem('crm_cirurgiao_id') } catch {} }}
              className="text-[11px] text-slate-400 underline">não sou eu</button>
          </div>
          <button onClick={abrirNova} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-sm font-semibold"
            style={{ background: marca.cor }}>
            <Plus size={15}/> Nova
          </button>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-5 space-y-2">
          {/* Busca simples, sobre o que já está na tela: são no máximo 60
              cirurgias em andamento, e procurar no servidor a cada tecla não
              traria nada que a lista já não tenha. */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300"/>
            <input value={buscaLista} onChange={e => setBuscaLista(e.target.value)}
              placeholder="procurar paciente, cirurgia ou hospital"
              className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400"/>
            {buscaLista && (
              <button onClick={() => setBuscaLista('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300"><X size={14}/></button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 px-1 pb-1">
            Em andamento. As realizadas e canceladas ficam no CRM.
          </p>
          {listaFiltrada.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">
              {buscaLista.trim() ? 'Nada encontrado.' : 'Nenhuma cirurgia em andamento.'}
            </p>
          ) : listaFiltrada.map(m => (
            <button key={m.id} onClick={() => abrirExistente(m)}
              className="w-full text-left bg-white border border-slate-200 rounded-2xl px-4 py-3 hover:border-slate-300">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-bold text-slate-500 tabular-nums">
                  {m.data_cirurgia ? m.data_cirurgia.split('-').reverse().join('/') : 'sem data'}
                  {m.hora ? ` · ${m.hora.slice(0, 5)}` : ''}
                </span>
                {/* Igual ao CRM: a etiqueta troca a situação sem abrir o
                    cadastro. Abrir o paciente continua funcionando para o resto. */}
                <span role="button" tabIndex={0}
                  onClick={e => { e.stopPropagation(); setMotivo(m.motivo_cancelamento || ''); setErro(''); setTrocando(m) }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setTrocando(m) } }}
                  className="text-[10px] font-bold px-2 py-1 rounded-full text-white truncate max-w-[55%] cursor-pointer hover:opacity-80"
                  style={{ background: (m.status && cfg.cores?.[m.status]) || CINZA }}>
                  {m.status || 'sem situação'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-semibold text-slate-800 leading-snug">{m.paciente_nome}</p>
                {m.alergico && (
                  // span com role="button", não <button>: o cartão inteiro já
                  // é um botão, e button dentro de button quebra o HTML.
                  <span role="button" tabIndex={0}
                    onClick={e => { e.stopPropagation(); setVerAlergiaId(id => id === m.id ? null : m.id) }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setVerAlergiaId(id => id === m.id ? null : m.id) } }}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white cursor-pointer">
                    ALÉRGICO(A)
                  </span>
                )}
              </div>
              {m.alergico && verAlergiaId === m.id && (
                <p className="text-[11px] text-red-800 bg-red-50 border border-red-100 rounded-md px-2 py-1 mt-1">
                  <span className="font-semibold">Alergia anotada no cadastro: </span>
                  {m.alergia_obs?.trim() || 'nada escrito — só marcado como alérgico(a), sem detalhe.'}
                </p>
              )}
              <p className="text-xs text-slate-500 leading-snug">
                {m.procedimento_sigla || m.procedimento_nome || 'sem procedimento'}
                {m.hospital ? ` · ${m.hospital}` : ''}
                {m.valor_cobrado
                  ? ` · ${Number(m.valor_cobrado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                  : ''}
              </p>
            </button>
          ))}
        </div>

        {trocando && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end justify-center"
            onClick={() => { if (!ocupado) { setTrocando(null); setErro('') } }}>
            <div className="bg-white w-full sm:max-w-md rounded-t-3xl px-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
              onClick={e => e.stopPropagation()}>
              <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-4"/>
              <p className="text-sm font-semibold text-slate-800">{trocando.paciente_nome}</p>
              <p className="text-xs text-slate-400 mb-3">Mudar a situação</p>

              <div className="space-y-2">
                {(['preop', 'agendar', 'cancelada'] as const).map(v => {
                  const alvo = cfg.situacoes[v]
                  const cor = alvo.cor || (v === 'cancelada' ? '#dc2626' : CINZA)
                  const atual = trocando.status_id === alvo.id
                  return (
                    <button key={v} onClick={() => trocarSituacao(v)} disabled={!!ocupado}
                      className="w-full flex items-center justify-between gap-2 py-3 px-3 rounded-xl border-2 text-sm font-semibold disabled:opacity-50"
                      style={{ borderColor: cor, color: atual ? '#fff' : cor, background: atual ? cor : '#fff' }}>
                      <span>{ROTULO_SITUACAO[v]}</span>
                      {ocupado === 'situacao'
                        ? <Loader2 size={15} className="animate-spin"/>
                        : atual ? <Check size={15}/> : null}
                    </button>
                  )
                })}
              </div>

              {/* O motivo fica sempre à vista: quem vai cancelar já digita antes
                  de tocar em "Cancelada", e não leva um erro na cara depois. */}
              <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                placeholder="Motivo (obrigatório para cancelar)"
                className={campo + ' mt-3'}/>
              {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
            </div>
          </div>
        )}
        <Toast aviso={toast} aoFechar={() => setToast(null)}/>
      </div>
    )
  }

  // --- formulário -----------------------------------------------------------
  return (
    <div className="h-[100dvh] overflow-y-auto bg-slate-50">
      <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
        <button onClick={() => { setTela('lista'); carregar(medico.id) }} className="p-1.5 -ml-1.5 text-slate-500"><ChevronLeft size={18}/></button>
        <p className="text-sm font-semibold text-slate-800 flex-1">{f.id ? 'Cirurgia' : 'Nova cirurgia'}</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4 pb-24">
        {/* Paciente */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <p className={rotulo}>Paciente</p>
          {f.paciente_nome ? (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <Check size={15} className="text-emerald-600 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800 truncate">{f.paciente_nome}</p>
                    {f.alergico && (
                      <button type="button" onClick={() => setVerAlergiaForm(v => !v)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold shrink-0">
                        ALÉRGICO(A)
                      </button>
                    )}
                  </div>
                  {f.paciente_telefone && <p className="text-xs text-slate-500">{f.paciente_telefone}</p>}
                </div>
                <button onClick={() => setF(a => ({ ...a, paciente_nome: '', paciente_telefone: '', contact_id: '', alergico: false, alergia_obs: null }))}
                  className="p-1 text-slate-400"><X size={14}/></button>
              </div>
              {f.alergico && verAlergiaForm && (
                <div className="px-3 py-2 bg-red-50 border-t border-red-100 text-xs text-red-800">
                  <span className="font-semibold">Alergia anotada no cadastro: </span>
                  {f.alergia_obs?.trim() || 'nada escrito — só marcado como alérgico(a), sem detalhe.'}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300"/>
                <input value={buscaPac} onChange={e => setBuscaPac(e.target.value)}
                  placeholder="nome ou telefone" className={campo + ' pl-9'}/>
              </div>
              {buscandoPac && <p className="text-xs text-slate-400">procurando...</p>}
              {contatos.map((c, i) => (
                <button key={(c.id || c.id_medx || '') + i} onClick={() => escolherPaciente(c)}
                  className="w-full text-left px-3 py-2 rounded-xl border border-slate-200 hover:border-slate-300">
                  <p className="text-sm text-slate-800 flex items-center gap-1.5">
                    {c.nome}
                    {/* Quem veio do prontuário e ainda não é contato do CRM: o
                        cadastro é criado no instante em que ele escolhe. */}
                    {c.origem === 'medx' && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">MedX</span>
                    )}
                  </p>
                  {c.telefone && <p className="text-xs text-slate-400">{c.telefone}</p>}
                </button>
              ))}
              {buscaPac.trim().length >= 3 && !buscandoPac && contatos.length === 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs text-amber-700">Não achei no cadastro. Lance assim mesmo — a clínica vincula depois.</p>
                  <input value={f.paciente_nome} onChange={e => setF(a => ({ ...a, paciente_nome: e.target.value }))}
                    placeholder="nome completo do paciente" className={campo}/>
                  <input value={f.paciente_telefone} onChange={e => setF(a => ({ ...a, paciente_telefone: e.target.value }))}
                    placeholder="celular com DDD" className={campo}/>
                </div>
              )}
            </>
          )}
        </div>

        {/* Situação */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <p className={rotulo}>Situação</p>
          <div className="grid grid-cols-3 gap-2">
            {(['preop', 'agendar', 'cancelada'] as const).map(v => {
              const alvo = cfg.situacoes[v]
              const cor = alvo.cor || (v === 'cancelada' ? '#dc2626' : marca.cor)
              const rotuloSit = ROTULO_SITUACAO[v]
              return (
                <button key={v} onClick={() => setF(a => ({ ...a, situacao: v }))}
                  className="px-2 py-2.5 rounded-xl border-2 text-xs font-semibold transition-colors leading-tight"
                  style={f.situacao === v
                    ? { background: cor, borderColor: cor, color: '#fff' }
                    : { borderColor: cor + '55', color: cor }}>
                  {rotuloSit}
                </button>
              )
            })}
          </div>
          {f.situacao === 'cancelada' && (
            <textarea value={f.motivo_cancelamento} onChange={e => setF(a => ({ ...a, motivo_cancelamento: e.target.value }))}
              rows={3} placeholder="Motivo do cancelamento" className={campo}/>
          )}
        </div>

        {/* Cirurgia */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <p className={rotulo}>Cirurgia</p>
          {f.procedimentos.map((p, i) => {
            const semTabela = !(Number(p.valor_equipe) > 0) && !(Number(p.valor_anestesista) > 0)
            return (
              <div key={p.id + i} className="bg-slate-50 rounded-xl px-3 py-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500 shrink-0">{p.sigla}</span>
                  <span className="text-xs text-slate-700 flex-1 min-w-0 truncate">{p.nome}</span>
                  <button onClick={() => {
                    setF(a => ({ ...a, procedimentos: a.procedimentos.filter((_, j) => j !== i) }))
                    setSalvarNoCadastro(m => { const n = { ...m }; delete n[p.id]; return n })
                  }} className="p-1 text-slate-300"><Trash2 size={13}/></button>
                </div>
                {semTabela && (
                  <div className="border-t border-slate-200 pt-1.5 space-y-1.5">
                    <p className="text-[11px] font-semibold text-amber-600">
                      Sem valor de tabela cadastrado — qual foi o valor combinado para esta cirurgia?
                    </p>
                    <input type="number" step="0.01" inputMode="decimal" placeholder="valor da equipe (R$)"
                      value={p.valor_equipe || ''}
                      onChange={e => setF(a => ({
                        ...a,
                        procedimentos: a.procedimentos.map((x, j) => j === i ? { ...x, valor_equipe: Number(e.target.value) || 0 } : x),
                      }))}
                      className={campo}/>
                    <label className="flex items-center gap-2 text-[11px] text-slate-500">
                      <input type="checkbox" checked={!!salvarNoCadastro[p.id]} className="rounded"
                        onChange={e => setSalvarNoCadastro(m => ({ ...m, [p.id]: e.target.checked }))}/>
                      Salvar este valor no cadastro, para a próxima vez
                    </label>
                  </div>
                )}
                {/* v48.100 — Qual material usar, por procedimento.
                    v48.117 — Antes só aparecia com alguma lista já
                    cadastrada e sem mostrar o conteúdo dela; Jorge pediu para
                    dar para VER o material escolhido aqui e para poder
                    ESCOLHER ENTRE OS PRONTOS OU GRAVAR UM NOVO, sem precisar
                    avisar a secretária — igual já dava para fazer com
                    convênio e procedimento nesta mesma tela. */}
                {(() => {
                  const opcoes = cfg.materiaisListas.filter(l => l.procedimento_id === p.id)
                  const selecionada = opcoes.find(l => l.id === f.materiais[p.id]) || null
                  return (
                    <div className="border-t border-slate-200 pt-1.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-slate-400">Material a usar — a secretaria vê essa escolha ao montar a solicitação</p>
                        {novaLista !== p.id && (
                          <button type="button" onClick={() => setNovaLista(p.id)}
                            className="shrink-0 text-[11px] font-semibold" style={{ color: marca.cor }}>
                            + nova lista
                          </button>
                        )}
                      </div>
                      {opcoes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {opcoes.map(l => {
                            const sel = f.materiais[p.id] === l.id
                            return (
                              <button key={l.id} type="button"
                                onClick={() => setF(a => ({ ...a, materiais: { ...a.materiais, [p.id]: l.id } }))}
                                className="px-2 py-1 rounded-lg border text-[11px] font-medium"
                                style={{ borderColor: sel ? marca.cor : '#e2e8f0', color: sel ? '#fff' : '#64748b', background: sel ? marca.cor : '#fff' }}>
                                {l.nome}{l.padrao ? ' ·' : ''}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {!opcoes.length && novaLista !== p.id && (
                        <p className="text-[11px] text-slate-400">Nenhuma lista cadastrada ainda para esta cirurgia.</p>
                      )}
                      {selecionada && novaLista !== p.id && (
                        <pre className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1.5 whitespace-pre-wrap max-h-28 overflow-y-auto font-mono">
                          {selecionada.itens?.trim() || '(lista sem itens cadastrados)'}
                        </pre>
                      )}
                      {novaLista === p.id && (
                        <FormNovaListaMaterial
                          ocupado={ocupado === 'criar_material_lista'} erro={erro} campo={campo}
                          onCancelar={() => { setNovaLista(null); setErro('') }}
                          onConfirmar={(nome, itensTexto) => criarMaterial(p.id, nome, itensTexto)}/>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })}
          {/* v48.119 — Cirurgia com 2+ procedimentos (ex.: BP + CCC) pode
              repetir item entre as listas de material escolhidas — trocarte
              e agulha de Veress são os exemplos do Jorge. Aqui é só o aviso;
              quem resolve de verdade se entra 1 ou 2 vezes é a secretária,
              em "Solicitação de cirurgia" (já dedupa por padrão lá). */}
          {(() => {
            const selecionadas = f.procedimentos
              .map(p => f.materiais[p.id])
              .filter((id): id is string => !!id)
              .map(id => cfg.materiaisListas.find(l => l.id === id))
              .filter((l): l is typeof cfg.materiaisListas[number] => !!l)
            const repetidos = selecionadas.length > 1 ? acharRepetidos(selecionadas) : []
            if (!repetidos.length) return null
            return (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                Item repetido entre os materiais escolhidos: {repetidos.map(r => r.linha).join('; ')}.
                A secretaria decide, na solicitação, se entra 1 ou 2 vezes.
              </p>
            )
          })()}
          {cfg.frequentes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cfg.frequentes.filter(x => !f.procedimentos.some(p => p.id === x.procedimento_id)).map(x => (
                <button key={x.procedimento_id}
                  onClick={() => setF(a => ({ ...a, procedimentos: [...a.procedimentos, { id: x.procedimento_id, sigla: x.sigla, nome: x.nome, valor_equipe: x.valor_equipe, valor_anestesista: x.valor_anestesista }] }))}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:border-slate-300">
                  <Plus size={11}/>{x.sigla}
                </button>
              ))}
            </div>
          )}
          {/* v48.102 — Cadastrar uma cirurgia nova a partir do catálogo TUSS,
              igual ao CRM: abreviação sugerida, editável, e a via já vem
              preenchida quando a descrição da ANS entrega ("...por
              videolaparoscopia"). */}
          {novoDoTuss ? (
            <FormNovoDoTuss codigo={novoDoTuss.codigo} nome={novoDoTuss.nome} vias={cfg.vias}
              ocupado={ocupado === 'cadastrar_procedimento'} erro={erro}
              onCancelar={() => { setNovoDoTuss(null); setErro('') }}
              onConfirmar={confirmarNovoDoTuss} campo={campo}/>
          ) : (
            <>
              <input value={buscaProc} onChange={e => setBuscaProc(e.target.value)}
                placeholder="procurar outra cirurgia — nome ou código TUSS" className={campo}/>
              {procFiltrados.map(p => (
                <button key={p.id} onClick={() => { setF(a => ({ ...a, procedimentos: [...a.procedimentos, p] })); setBuscaProc('') }}
                  className="w-full text-left px-3 py-2 rounded-xl border border-slate-200 hover:border-slate-300">
                  <p className="text-xs font-bold text-slate-600">{p.sigla}</p>
                  <p className="text-xs text-slate-500">{p.nome}</p>
                </button>
              ))}
              {buscaProc.trim().length >= 2 && (buscandoTuss ? (
                <p className="text-xs text-slate-400 flex items-center gap-1.5 px-1"><Loader2 size={12} className="animate-spin"/> Procurando no catálogo TUSS...</p>
              ) : (() => {
                // Não repete o que já apareceu entre as cadastradas.
                const jaTem = new Set(procFiltrados.map(p => p.nome.toLowerCase()))
                const doCatalogo = sugestoesTuss.filter(t => !jaTem.has(t.nome.toLowerCase()))
                if (!doCatalogo.length) return null
                return doCatalogo.map((t, i) => (
                  <button key={t.codigo + i} type="button" onClick={() => setNovoDoTuss(t)}
                    className="w-full text-left px-3 py-2 rounded-xl border border-amber-200 bg-amber-50/60 hover:bg-amber-50">
                    <div className="flex items-start gap-2">
                      <Plus size={12} className="text-amber-600 shrink-0 mt-0.5"/>
                      <div className="min-w-0">
                        <p className="text-xs text-slate-700 leading-snug">{t.nome}</p>
                        <p className="text-[11px] text-amber-700">TUSS {t.codigo} · cadastrar esta cirurgia</p>
                      </div>
                    </div>
                  </button>
                ))
              })())}
            </>
          )}
          <div>
            <p className={rotulo}>Via de acesso</p>
            <select value={f.via_acesso} onChange={e => setF(a => ({ ...a, via_acesso: e.target.value }))} className={campo}>
              <option value="">—</option>
              {cfg.vias.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        {/* Condição e hospital */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div>
            <p className={rotulo}>Condição</p>
            <select value={f.modalidade} onChange={e => setF(a => ({ ...a, modalidade: e.target.value }))} className={campo}>
              <option value="">—</option>
              {cfg.modalidades.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <p className={rotulo}>Convênio</p>
            <div className="flex gap-1.5">
              <select value={f.convenio_id} className={campo + ' flex-1'}
                onChange={e => {
                  const c = cfg.convenios.find(x => x.id === e.target.value)
                  setF(a => ({ ...a, convenio_id: e.target.value, convenio: c?.nome || '' }))
                }}>
                <option value="">Particular (sem convênio)</option>
                {cfg.convenios.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              {/* v48.116 — Convênio novo, sem sair daqui pra pedir à secretária. */}
              <button type="button" onClick={criarConvenio} disabled={ocupado === 'criar_convenio'}
                title="Cadastrar convênio novo"
                className="px-2.5 rounded-lg border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300 disabled:opacity-50 shrink-0">
                {ocupado === 'criar_convenio' ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>}
              </button>
            </div>
          </div>
          <div>
            <p className={rotulo}>Hospital</p>
            <HospitalPausaMed
              valor={{ nome: f.hospital, cidade: f.hospital_cidade, estado: f.hospital_estado, pausamedId: f.hospital_pausamed_id }}
              className={campo}
              onEscolher={(h: HospitalValor) => setF(a => ({
                ...a, hospital: h.nome, hospital_cidade: h.cidade, hospital_estado: h.estado, hospital_pausamed_id: h.pausamedId,
              }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={rotulo}>Data</p>
              <input type="date" value={f.data_cirurgia} onChange={e => setF(a => ({ ...a, data_cirurgia: e.target.value }))} className={campo}/>
            </div>
            <div>
              <p className={rotulo}>Hora</p>
              <input type="time" value={f.hora} onChange={e => setF(a => ({ ...a, hora: e.target.value }))} className={campo}/>
            </div>
          </div>
        </div>

        {/* Equipe */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <p className={rotulo}>Equipe</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">Auxiliares</p>
              <div className="flex gap-1.5">
                {[0, 1, 2].map(n => (
                  <button key={n} onClick={() => setF(a => ({ ...a, auxiliares: n }))}
                    className={'flex-1 py-2 rounded-xl border text-sm font-semibold ' + (f.auxiliares === n ? 'text-white border-transparent' : 'border-slate-200 text-slate-500')}
                    style={f.auxiliares === n ? { background: marca.cor } : undefined}>{n}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Instrumentadores</p>
              <div className="flex gap-1.5">
                {[0, 1, 2].map(n => (
                  <button key={n} onClick={() => setF(a => ({ ...a, instrumentadores: n }))}
                    className={'flex-1 py-2 rounded-xl border text-sm font-semibold ' + (f.instrumentadores === n ? 'text-white border-transparent' : 'border-slate-200 text-slate-500')}
                    style={f.instrumentadores === n ? { background: marca.cor } : undefined}>{n}</button>
                ))}
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={f.anestesista} className="rounded"
              onChange={e => setF(a => ({ ...a, anestesista: e.target.checked }))}/>
            com anestesista
          </label>
        </div>

        {/* Valor: vem da tabela e o cirurgião ajusta se combinou outra coisa. */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
          <p className={rotulo}>Valor cobrado</p>
          <input type="number" step="0.01" inputMode="decimal" value={f.valor_cobrado}
            onChange={e => setF(a => ({ ...a, valor_cobrado: e.target.value, valor_manual: true }))}
            placeholder="total dos honorários" className={campo}/>
          {calculado > 0 && (
            f.valor_manual && Number(f.valor_cobrado) !== calculado ? (
              <button type="button"
                onClick={() => setF(a => ({ ...a, valor_cobrado: String(calculado), valor_manual: false }))}
                className="text-[11px] font-semibold" style={{ color: marca.cor }}>
                ajustado por você — usar o de tabela ({brl(calculado)})
              </button>
            ) : (
              <p className="text-[11px] text-slate-400">
                Valor de tabela{f.procedimentos.length > 1 ? ' (conjugada: o maior inteiro, os outros pela metade)' : ''}.
                Ajuste se combinou outro com o paciente.
              </p>
            )
          )}
          {calculado === 0 && (
            <p className="text-[11px] text-slate-400">Escolha a cirurgia para o valor de tabela aparecer.</p>
          )}
        </div>

        {/* Observações */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div>
            <p className={rotulo}>Observações</p>
            <textarea value={f.observacao} onChange={e => setF(a => ({ ...a, observacao: e.target.value }))} rows={3} className={campo}/>
          </div>
        </div>

        {/* v48.106 — Item #3: a mesma tela de medicações e suspensão do CRM,
            só depois de salvar — a lista fica presa a uma cirurgia já
            existente (cirurgia_medicamentos.cirurgia_id).
            v48.146 — Pedido do Jorge: tirar o campo de texto livre "Medicações
            em uso" (acima) — não faz sentido duas telas para a mesma coisa.
            Esta aqui é a única entrada de medicação no link do médico agora;
            digitar já lista sugestões (PausaMed + base da clínica), como
            antes. `f.medicacoes` continua existindo por baixo dos panos (ver
            tipo Cirurgia e carregarCirurgia) só para não perder o texto livre
            de cirurgias antigas — é o que alimenta o "Importar da lista
            atual" de reserva dentro do card abaixo quando a lista estruturada
            ainda está vazia. */}
        {f.id ? (
          <MedicamentosCirurgiao cirurgiaId={f.id} chamar={chamar}/>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className={rotulo}>Medicações e suspensão</p>
            <p className="text-xs text-slate-400 mt-1">Salve a cirurgia primeiro; depois dá para consultar o prazo de suspensão de cada remédio.</p>
          </div>
        )}

        {/* Documentos: só depois de salvar, porque o arquivo precisa de uma
            cirurgia a que pertencer. */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
          <p className={rotulo}>Documentos</p>
          {f.id ? (
            <>
              <input ref={inputArquivo} type="file" multiple className="hidden" onChange={e => anexar(e.target.files)}/>
              <button onClick={() => inputArquivo.current?.click()} disabled={!!ocupado}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-600 font-semibold disabled:opacity-50">
                {ocupado === 'anexar' ? <Loader2 size={16} className="animate-spin"/> : <Paperclip size={16}/>}
                Anexar documento
              </button>
            </>
          ) : (
            <p className="text-xs text-slate-400">Salve primeiro; depois dá para anexar.</p>
          )}
        </div>

        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {aviso && !erro && <p className="text-sm text-emerald-700 flex items-center gap-1.5"><Check size={15}/>{aviso}</p>}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <button onClick={salvar} disabled={!!ocupado || !f.paciente_nome.trim()}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-white font-semibold disabled:opacity-50"
            style={{ background: marca.cor }}>
            {ocupado === 'salvar' ? <Loader2 size={18} className="animate-spin"/> : <Check size={18}/>}
            {f.id ? 'Salvar alterações' : 'Lançar cirurgia'}
          </button>
        </div>
      </div>

      <Toast aviso={toast} aoFechar={() => setToast(null)}/>
    </div>
  )
}

// v48.102 — Cadastro rápido a partir de uma sugestão do catálogo TUSS, igual
// a NovoProcedimento em EscolherProcedimento.tsx (mas sem reabrir a busca de
// nome pela tabela TUSS — aqui o nome já veio de lá; só falta a abreviação,
// que vira o "padrão" que a equipe usa depois, tipo SSS ou HIB).
function FormNovoDoTuss({ codigo, nome, vias, ocupado, erro, onCancelar, onConfirmar, campo }: {
  codigo: string; nome: string; vias: string[]; ocupado: boolean; erro: string
  onCancelar: () => void; onConfirmar: (sigla: string, via: string) => void; campo: string
}) {
  const [sigla, setSigla] = useState(sugerirSigla(nome))
  const [via, setVia] = useState(viaDoNome(nome))
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-900">Cadastrar cirurgia nova</p>
      <p className="text-xs text-slate-700 leading-snug">{nome}</p>
      <p className="text-[11px] text-amber-700">TUSS {codigo}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Abreviação</label>
          <input value={sigla} onChange={e => setSigla(e.target.value)} className={campo}/>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Via de acesso</label>
          <select value={via} onChange={e => setVia(e.target.value)} className={campo}>
            <option value="">—</option>
            {vias.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancelar} disabled={ocupado}
          className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-50">
          Cancelar
        </button>
        <button type="button" onClick={() => onConfirmar(sigla.trim(), via)} disabled={ocupado || !sigla.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold disabled:opacity-50">
          {ocupado ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>} Cadastrar e usar
        </button>
      </div>
      <p className="text-[10px] text-amber-700">
        Valores e materiais podem ser preenchidos depois pela equipe da clínica.
      </p>
    </div>
  )
}

// v48.117 — Gravar uma lista de materiais nova, direto no link do cirurgião
// — mesma ideia do FormNovoDoTuss acima (formulário inline, sem sair da
// tela), aqui com o texto dos itens em vez de sigla/via.
function FormNovaListaMaterial({ ocupado, erro, onCancelar, onConfirmar, campo }: {
  ocupado: boolean; erro: string
  onCancelar: () => void; onConfirmar: (nome: string, itens: string) => void; campo: string
}) {
  const [nome, setNome] = useState('')
  const [itensTexto, setItensTexto] = useState('')
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-900">Nova lista de materiais</p>
      <div>
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Nome</label>
        <input value={nome} onChange={e => setNome(e.target.value)} placeholder="ex.: Tela Bard" className={campo}/>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">Material</label>
        <textarea value={itensTexto} onChange={e => setItensTexto(e.target.value)} rows={4}
          placeholder={'* 1 UNIDADE - AGULHA DE VERES\n* 1 UNIDADE - TROCARTE 12/5MM DESCARTÁVEL'}
          className={campo + ' font-mono'}/>
      </div>
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancelar} disabled={ocupado}
          className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-50">
          Cancelar
        </button>
        <button type="button" onClick={() => onConfirmar(nome.trim(), itensTexto)} disabled={ocupado || !nome.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold disabled:opacity-50">
          {ocupado ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>} Salvar e usar
        </button>
      </div>
    </div>
  )
}

// v48.106 — Item #3: medicações e suspensão pré-operatória, no link do
// cirurgião. Mesma lógica de components/cirurgias/MedicamentosCirurgia.tsx
// (mesma tabela, cirurgia_medicamentos, e a mesma cascata PausaMed → base da
// clínica → IA), reescrita aqui porque aquele componente usa o cliente
// supabase do navegador para autenticar (sessão de login), que não existe
// nesta página pública — tudo passa pelo chamar() com o token, como o resto
// do link.
type MedicamentoCirurgiao = {
  id: string; nome_informado: string; principio_ativo: string | null
  prazo_suspensao_dias: number | null; explicacao_paciente: string | null
  fonte: string | null; fonte_detalhe: string | null; fonte_referencia: string | null; status: string
}

const FONTE_LABEL_MED: Record<string, string> = {
  hospital: 'Regra do hospital', clinica: 'Personalização da clínica',
  hospital_importada: 'Regra hospitalar importada', geral: 'Base padrão PausaMed',
  clinica_ia: 'Base própria da clínica (IA)', ia: 'Pesquisado agora por IA — revise com atenção',
  manual: 'Editado manualmente',
}

function MedicamentosCirurgiao({ cirurgiaId, chamar }: {
  cirurgiaId: string
  chamar: (corpo: any) => Promise<any>
}) {
  const [lista, setLista] = useState<MedicamentoCirurgiao[]>([])
  const [textoLivre, setTextoLivre] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [novoNome, setNovoNome] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  // v48.143 — Pedido do Jorge: nada de clicar em "importar" — a lista de texto
  // livre (campo "Medicações" do formulário) entra sozinha na tabela
  // estruturada E já é analisada (PausaMed → base da clínica → IA), com uma
  // animação enquanto isso acontece e um aviso quando termina.
  const [analisando, setAnalisando] = useState(false)
  const [analiseFeita, setAnaliseFeita] = useState<{ total: number; encontrados: number } | null>(null)
  const tentouAutoImportar = useRef(false)

  // v48.148 — Pedido do Jorge: um botão para o PRÓPRIO cirurgião aprovar o
  // plano de suspensão, separado do status 'aprovado' de cada remédio (que é
  // travado pela secretaria ao gerar o PDF). O servidor derruba essa
  // aprovação sozinho sempre que algo muda na lista (ver
  // app/api/agendar-cirurgia/[token]/route.ts) — carregar() de novo depois de
  // cada mutação já traz o valor atualizado.
  const [suspensaoAprovada, setSuspensaoAprovada] = useState(false)
  const [suspensaoAprovadaEm, setSuspensaoAprovadaEm] = useState<string | null>(null)

  // v48.144 — Autocomplete ao digitar o nome (catálogo do PausaMed + base
  // própria da clínica), pedido do Jorge depois do caso "MOUJARO" (digitou
  // errado de propósito: a IA não reconheceu, não achou o remédio, e voltou
  // um prazo genérico errado). Escolher da lista já inclui o remédio e
  // limpa o campo para o próximo — "escolher na lista... seguir para a
  // próxima". Mesmo padrão de MedicamentosCirurgia.tsx (lado CRM).
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

  async function buscarSugestoesNome(termo: string) {
    setBuscandoSugestao(true)
    try {
      const j = await chamar({ acao: 'medicamentos_sugestoes', termo })
      setSugestoesNome(j.medicamentos || [])
    } catch { setSugestoesNome([]) }
    setBuscandoSugestao(false)
  }

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const j = await chamar({ acao: 'medicamentos_listar', cirurgia_id: cirurgiaId })
      setLista(j.medicamentos || []); setTextoLivre(j.medicacoesTextoLivre || '')
      setSuspensaoAprovada(!!j.suspensaoAprovada); setSuspensaoAprovadaEm(j.suspensaoAprovadaEm || null)
    } catch (e: any) { setErro(e.message) }
    setCarregando(false)
  }, [cirurgiaId, chamar])

  useEffect(() => { carregar() }, [carregar])

  async function importar() {
    setOcupado('importar'); setErro('')
    try { await chamar({ acao: 'medicamentos_importar_texto', cirurgia_id: cirurgiaId }); await carregar() }
    catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  // v48.143 — Roda uma vez só, sozinho, assim que a tela abre com medicação em
  // texto livre e a lista estruturada ainda vazia: importa cada remédio E já
  // consulta o prazo de suspensão de cada um (mesma cascata da lupa/✨), sem
  // esperar clique nenhum. Se um remédio não for encontrado, os outros
  // continuam sendo analisados — no final, quem ficou sem prazo aparece
  // destacado na lista do jeito de sempre, para completar na mão.
  useEffect(() => {
    if (carregando || tentouAutoImportar.current) return
    if (lista.length || !textoLivre.trim()) return
    tentouAutoImportar.current = true
    ;(async () => {
      setAnalisando(true); setErro('')
      try {
        const ji = await chamar({ acao: 'medicamentos_importar_texto', cirurgia_id: cirurgiaId })
        const novos: MedicamentoCirurgiao[] = ji?.medicamentos || []
        let encontrados = 0
        for (const m of novos) {
          try {
            const jc = await chamar({ acao: 'medicamentos_consultar', cirurgia_id: cirurgiaId, id: m.id })
            if (jc.encontrado) encontrados++
          } catch { /* um remédio falhar não trava a análise dos demais */ }
        }
        await carregar()
        if (novos.length) setAnaliseFeita({ total: novos.length, encontrados })
      } catch (e: any) { setErro(e.message) }
      setAnalisando(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, lista.length, textoLivre])

  // v48.141 — Pedido do Jorge: ao adicionar pelo botão, já vai pra lista E já
  // roda a busca (PausaMed → base da clínica → IA) sozinho — antes eram dois
  // passos (adicionar, depois clicar na lupa de cada um). Se a busca não achar
  // nada, o item continua na lista — a lupa continua ali para tentar de novo
  // ou como registro, e o médico ainda pode preencher prazo/orientação na mão.
  async function adicionar(nomeForcado?: string) {
    const nome = (nomeForcado ?? novoNome).trim()
    if (!nome) return
    setOcupado('adicionar'); setErro('')
    try {
      const j = await chamar({ acao: 'medicamentos_adicionar', cirurgia_id: cirurgiaId, nome })
      setNovoNome('')
      const novoId = j?.medicamento?.id
      if (novoId) {
        const jc = await chamar({ acao: 'medicamentos_consultar', cirurgia_id: cirurgiaId, id: novoId })
        if (!jc.encontrado) setErro('Adicionado — mas não achei regra pronta (nem no PausaMed, nem na base da clínica, nem pesquisando agora com IA). Preencha prazo e orientação manualmente abaixo.')
      }
      await carregar()
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  // v48.144 — Escolher da lista já inclui direto (sem precisar clicar em
  // "Adicionar" depois) e limpa/refoca o campo para digitar o próximo remédio
  // em seguida — pedido explícito do Jorge ("escolher na lista... seguir
  // para a próxima").
  async function escolherSugestao(nome: string) {
    setSugestoesNome([]); setSugestoesAbertas(false)
    await adicionar(nome)
    inputNovoNome.current?.focus()
  }

  async function remover(id: string) {
    setOcupado('remover:' + id); setErro('')
    try { await chamar({ acao: 'medicamentos_remover', cirurgia_id: cirurgiaId, id }); await carregar() }
    catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  async function consultar(id: string) {
    setOcupado('consultar:' + id); setErro('')
    try {
      const j = await chamar({ acao: 'medicamentos_consultar', cirurgia_id: cirurgiaId, id })
      await carregar()
      if (!j.encontrado) setErro('Não achei regra para este medicamento — nem no PausaMed, nem na base da clínica, nem pesquisando agora com IA. Preencha prazo e orientação manualmente abaixo.')
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  async function salvarCampo(id: string, campo: 'prazo_suspensao_dias' | 'explicacao_paciente', valor: any) {
    setErro('')
    try {
      const j = await chamar({ acao: 'medicamentos_editar', cirurgia_id: cirurgiaId, id, [campo]: valor })
      setLista(l => l.map(m => m.id === id ? j.medicamento : m))
      // v48.148 — Editar um campo derruba a aprovação lá no servidor; espelha
      // aqui na hora, sem esperar um recarregamento — senão o botão de
      // aprovar fica escondido mesmo já podendo aparecer de novo.
      setSuspensaoAprovada(false); setSuspensaoAprovadaEm(null)
    }
    catch (e: any) { setErro(e.message) }
  }

  async function aprovarSuspensao() {
    setOcupado('aprovar'); setErro('')
    try {
      const j = await chamar({ acao: 'medicamentos_aprovar', cirurgia_id: cirurgiaId })
      setSuspensaoAprovada(!!j.suspensaoAprovada); setSuspensaoAprovadaEm(j.suspensaoAprovadaEm || null)
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  const inputMed = 'w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  // v48.148 — Mesmo "completo" calculado por item dentro do .map() abaixo,
  // só que para a lista inteira: é o que libera o botão de aprovar.
  const todosCompletos = lista.length > 0 && lista.every(m => m.prazo_suspensao_dias != null && !!m.explicacao_paciente?.trim())

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
        <Pill size={15} className="text-brand-500"/> Medicações e suspensão
      </p>
      <p className="text-[11px] text-slate-400 -mt-2">
        Consulte cada remédio para trazer o prazo de suspensão pronto, ou preencha na mão. A secretaria usa isso para montar o documento de suspensão.
      </p>

      {carregando ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-4"><Loader2 size={14} className="animate-spin"/> Carregando...</div>
      ) : analisando ? (
        // v48.144 — "Orbe de IA": indicador animado enquanto importa e
        // consulta cada remédio da lista de texto livre sozinho, sem esperar
        // clique. Núcleo brilhante + anéis girando (inspirado no vídeo de
        // referência do Jorge) + barra de progresso, sem áudio.
        <div className="flex items-center gap-3 text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-xl px-3.5 py-3">
          <div className="ai-orb-wrap" aria-hidden="true">
            <div className="ai-orb-ring ai-orb-ring-1"/>
            <div className="ai-orb-ring ai-orb-ring-2"/>
            <div className="ai-orb-ring ai-orb-ring-3"/>
            <div className="ai-orb-core"><Sparkles size={13}/></div>
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <span className="font-medium block">Analisando prazos de suspensão com IA...</span>
            <div className="ai-orb-bar-track"><div className="ai-orb-bar-fill"/></div>
          </div>
        </div>
      ) : (
        <>
          {analiseFeita && (
            <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
              <Sparkles size={14} className="mt-0.5 shrink-0"/>
              <span className="flex-1">
                Os prazos de suspensão foram analisados ({analiseFeita.encontrados} de {analiseFeita.total} com prazo pronto) — favor conferir e confirmar.
              </span>
              <button onClick={() => setAnaliseFeita(null)} className="text-emerald-400 hover:text-emerald-600 shrink-0"><X size={13}/></button>
            </div>
          )}

          {/* v48.146 — Pedido do Jorge: o campo para digitar fica ACIMA da
              lista de medicações já incluídas (antes ficava embaixo, depois
              de tudo) — é a única entrada de medicação nesta tela agora. */}
          {/* v48.147 — Jorge notou que a animação de "analisando com IA"
              tinha sumido: ela só existia para a importação automática do
              texto livre antigo (efeito acima), e desde que o campo de texto
              livre saiu da tela (v48.146) esse caminho praticamente nunca
              mais roda. Agora o mesmo "orbe" aparece aqui, no lugar do campo
              de digitar, enquanto o "Adicionar" está resolvendo (PausaMed →
              base da clínica → IA) — que é o caminho que todo mundo usa hoje. */}
          {ocupado === 'adicionar' ? (
            <div className="flex items-center gap-3 text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-xl px-3.5 py-3">
              <div className="ai-orb-wrap" aria-hidden="true">
                <div className="ai-orb-ring ai-orb-ring-1"/>
                <div className="ai-orb-ring ai-orb-ring-2"/>
                <div className="ai-orb-ring ai-orb-ring-3"/>
                <div className="ai-orb-core"><Sparkles size={13}/></div>
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <span className="font-medium block">Pesquisando prazo de suspensão com IA...</span>
                <div className="ai-orb-bar-track"><div className="ai-orb-bar-fill"/></div>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <div ref={caixaNovoNome} className="relative flex-1 min-w-0">
                <input ref={inputNovoNome} value={novoNome}
                  onChange={e => { setNovoNome(e.target.value); setSugestoesAbertas(true) }}
                  onFocus={() => setSugestoesAbertas(true)}
                  onKeyDown={e => { if (e.key === 'Enter') { adicionar(); setSugestoesAbertas(false) } }}
                  placeholder="Nome do medicamento" className={inputMed}/>
                {/* v48.144 — Sugestões do catálogo do PausaMed + o que a
                    própria clínica já pesquisou antes. Clicar já inclui e
                    segue para o próximo; digitar e mandar Adicionar sem
                    escolher nada continua funcionando como texto livre. */}
                {sugestoesAbertas && novoNome.trim().length >= 2 && (buscandoSugestao || sugestoesNome.length > 0) && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {buscandoSugestao ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-slate-400">
                        <Loader2 size={12} className="animate-spin"/> Buscando no PausaMed e na base da clínica...
                      </div>
                    ) : (
                      sugestoesNome.map(s => (
                        <button key={s.nome} type="button" onClick={() => escolherSugestao(s.nome)}
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
                <Plus size={13}/> Adicionar
              </button>
            </div>
          )}

          {/* v48.143 — A importação automática acima cobre o caso normal; este
              botão só continua aqui como reserva, se por algum motivo a
              automática não rodou ou precisa repetir. */}
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
                        {m.fonte && <span>{FONTE_LABEL_MED[m.fonte] || m.fonte} · </span>}
                        {travado ? <span className="text-emerald-600 font-semibold flex items-center gap-0.5"><Check size={11}/> aprovado</span>
                          : completo ? <span className="text-slate-500">pronto</span>
                          : <span className="text-amber-700 font-semibold flex items-center gap-0.5"><AlertCircle size={11}/> falta prazo/orientação</span>}
                      </p>
                    </button>
                    {!travado && (
                      // v48.141 — Ícone de IA: a busca automática (PausaMed →
                      // base da clínica → IA) já roda sozinha ao adicionar;
                      // este botão é para buscar de novo (ex.: depois de
                      // corrigir o nome do remédio).
                      <button onClick={() => consultar(m.id)} disabled={!!ocupado}
                        title="Buscar de novo — PausaMed, base da clínica e, se preciso, IA" className="p-1.5 text-brand-600 disabled:opacity-40 shrink-0">
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
                          onBlur={e => salvarCampo(m.id, 'prazo_suspensao_dias', e.target.value)} className={inputMed}/>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-500 block mb-1">Orientação ao paciente</label>
                        <textarea disabled={travado} rows={2} defaultValue={m.explicacao_paciente ?? ''}
                          onBlur={e => salvarCampo(m.id, 'explicacao_paciente', e.target.value)}
                          placeholder="Explicação simples, em linguagem de paciente" className={inputMed}/>
                      </div>
                      {m.fonte_detalhe && <p className="text-[11px] text-slate-400">Fonte: {m.fonte_detalhe}</p>}
                      {m.fonte_referencia && <p className="text-[11px] text-slate-400">Referência: {m.fonte_referencia}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {erro && <p className="text-[11px] text-red-600">{erro}</p>}

          {/* v48.148 — Pedido do Jorge: o próprio cirurgião aprova o plano de
              suspensão daqui, sem depender da secretaria gerar o PDF. Some
              (volta a pedir aprovação) sozinho se algo na lista mudar depois
              — o servidor derruba suspensaoAprovada em toda mutação. */}
          {suspensaoAprovada ? (
            <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
              <Check size={14} className="shrink-0"/>
              <span>
                Suspensão de medicamentos aprovada por você
                {suspensaoAprovadaEm && ' em ' + new Date(suspensaoAprovadaEm).toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}.
              </span>
            </div>
          ) : (
            <button onClick={aprovarSuspensao} disabled={!!ocupado || !todosCompletos}
              title={todosCompletos ? '' : 'Preencha prazo e orientação de todos os medicamentos antes de aprovar'}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40">
              {ocupado === 'aprovar' ? <Loader2 size={14} className="animate-spin"/> : <Check size={14}/>}
              Aprovar suspensão de medicamentos
            </button>
          )}
        </>
      )}
    </div>
  )
}
