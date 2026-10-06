import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { moeda, reaisPorExtenso } from '@/lib/extenso'
import { PARTES, Membro, documentoDoMembro, dividirHonorarios, lerComposicao, textoDivisao } from '@/lib/honorarios'
import { montarPdfTimbrado } from '@/lib/pdfTimbrado'
import { acharRepetidos, montarTextoMateriais, type ListaMaterial } from '@/lib/materiaisCirurgia'
import { semAcento } from '@/lib/texto'

// v48.69 — Documentos da cirurgia (orçamento, solicitação de procedimento).
//   GET ?tipo=...        → monta o texto para a secretária conferir
//   POST {acao:'gerar'}  → grava o texto conferido e devolve o PDF na folha
//   POST {acao:'enviar'} → manda o PDF ao paciente pelo WhatsApp
//
// v48.73 — A solicitação leva materiais, e materiais têm mais de um padrão por
// cirurgia. Por isso o GET devolve as LISTAS disponíveis e o texto já montado
// com a lista padrão: a secretária troca a lista se for o caso, e o texto se
// refaz. Escolher é mais rápido e mais seguro do que redigitar.

const TIPOS = ['orcamento', 'solicitacao', 'internacao', 'reembolso', 'suspensao_medicamentos'] as const
type Tipo = typeof TIPOS[number]
const ehTipo = (t: any): Tipo => TIPOS.includes(t) ? t : 'orcamento'

export const runtime = 'nodejs'
export const maxDuration = 60

async function quemEsta(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  })
  const { data: { user } } = await pub.auth.getUser(token)
  return user
}

// Os procedimentos como o convênio pede, e os diagnósticos correspondentes.
async function procedimentosEDiagnosticos(admin: any, c: any) {
  const { data: itens } = await admin.from('cirurgia_itens')
    .select('procedimento_id, sigla, nome, ordem').eq('cirurgia_id', c.id).order('ordem')
  const lista = (itens && itens.length ? itens : [{ procedimento_id: c.procedimento_id, sigla: c.procedimento_sigla, nome: c.procedimento_nome }]) as any[]

  const procedimentos: string[] = []
  const diagnosticos: string[] = []
  const procedimentoIds: string[] = []
  // v48.119 — Nome curto por procedimento (sigla de preferência, tipo "BP" /
  // "CCC"), só para agrupar a lista de materiais por cirurgia na tela —
  // "procedimentos" (acima) já tem o TUSS junto, formatado para a carta, o
  // que fica comprido demais para rótulo de grupo.
  const procedimentosResumo: { id: string; label: string }[] = []

  // v48.74 — O diagnóstico do PACIENTE, quando alguém escolheu na cirurgia,
  // manda. O catálogo do procedimento é só o típico daquela cirurgia; o que
  // vai na guia é o caso.
  const { data: doPaciente } = await admin.from('cirurgia_cids')
    .select('codigo, descricao, ordem').eq('cirurgia_id', c.id).order('ordem')
  for (const d of (doPaciente || [])) {
    const nomeCid = String(d.descricao || '').trim()
    const cod = String(d.codigo || '').trim()
    if (!nomeCid && !cod) continue
    const linha = cod ? `${nomeCid.toUpperCase()} (${cod})` : nomeCid.toUpperCase()
    if (!diagnosticos.includes(linha)) diagnosticos.push(linha)
  }
  const temDoPaciente = diagnosticos.length > 0
  for (const it of lista) {
    const nome = (it.nome || it.sigla || '').toUpperCase()
    let codigos: string[] = []
    if (it.procedimento_id) {
      const { data: tuss } = await admin.from('cirurgia_proc_tuss')
        .select('codigo, ordem').eq('procedimento_id', it.procedimento_id).order('ordem')
      codigos = (tuss || []).map((t: any) => String(t.codigo || '').trim()).filter(Boolean)

      // v48.74 — O diagnóstico vem do catálogo de CID que a cirurgia já tem
      // (Cad. Cirurgias → Cirurgias → CID), e não de um campo à parte: era
      // pedir para cadastrar duas vezes a mesma coisa, e duas cópias do mesmo
      // dado divergem. O campo solto só entra se o catálogo estiver vazio.
      const { data: cids } = temDoPaciente ? { data: [] } : await admin.from('cirurgia_proc_cid')
        .select('codigo, descricao, ordem').eq('procedimento_id', it.procedimento_id).order('ordem')
      for (const d of (cids || [])) {
        const nomeCid = String(d.descricao || '').trim()
        const cod = String(d.codigo || '').trim()
        if (!nomeCid && !cod) continue
        const linha = cod ? `${nomeCid.toUpperCase()} (${cod})` : nomeCid.toUpperCase()
        if (!diagnosticos.includes(linha)) diagnosticos.push(linha)
      }
      if (!temDoPaciente && !(cids || []).length) {
        const { data: p } = await admin.from('cirurgia_procedimentos')
          .select('diagnostico, cid').eq('id', it.procedimento_id).maybeSingle()
        const dg = (p?.diagnostico || '').trim()
        if (dg) {
          const linha = p?.cid ? `${dg.toUpperCase()} (${p.cid})` : dg.toUpperCase()
          if (!diagnosticos.includes(linha)) diagnosticos.push(linha)
        }
      }
    }
    if (it.procedimento_id) {
      procedimentoIds.push(it.procedimento_id)
      procedimentosResumo.push({ id: it.procedimento_id, label: (it.sigla || nome || 'procedimento').toString() })
    }
    if (!nome) continue
    procedimentos.push(codigos.length ? `${nome} (TUSS ${codigos.join(', ')})` : nome)
  }
  return { procedimentos, diagnosticos, procedimentoIds, procedimentosResumo }
}

// Quem entra na divisão.
//
// v48.92 — Antes disso, o sistema "adivinhava" auxiliares e instrumentadores
// pegando os primeiros do cadastro em ordem — indiferente para dividir o
// dinheiro, mas errado para uma carta com nome próprio (reembolso, RGO), que
// precisa de quem realmente esteve na sala. Agora, papel por papel: se o
// cirurgião escolheu alguém pelo link da RGO, é esse; sem escolha, cai no
// palpite de antes — assim uma cirurgia sem RGO ainda gera orçamento normal.
async function montarEquipe(admin: any, c: any): Promise<Membro[]> {
  const { data: equipe } = await admin.from('cirurgia_equipe')
    .select('id, nome_curto, nome_completo, documento, funcao, ordem')
    .eq('ativo', true).order('ordem')
  const todos = (equipe || []) as any[]
  const porId = new Map(todos.map(m => [m.id, m]))
  const nome = (m: any) => (m?.nome_completo || m?.nome_curto || '').toUpperCase()
  const doc = (m: any) => (m?.documento || '').trim()

  const cirurgioes = todos.filter(m => /cirurgi/i.test(m.funcao || ''))
  const instrumentadores = todos.filter(m => /instrument/i.test(m.funcao || ''))
  const anestesistas = todos.filter(m => /anestesi/i.test(m.funcao || ''))

  // v48.120 — Quem foi digitado à mão no link da RGO (avulso, sem entrar no
  // cadastro): mesmo formato de nome()/doc() acima, só sem "id" — entra no
  // lugar do cadastro quando não há rgo_*_id para o papel.
  const avulsa = (c.rgo_equipe_avulsa && typeof c.rgo_equipe_avulsa === 'object') ? c.rgo_equipe_avulsa : {}
  const av = (papel: string) => {
    const a = avulsa[papel]
    const nomeAv = String(a?.nome || '').trim()
    return nomeAv ? { nome_completo: nomeAv, documento: String(a?.documento || '').trim() } : null
  }

  const principal = (c.rgo_cirurgiao_id && porId.get(c.rgo_cirurgiao_id))
    || av('cirurgiao')
    || todos.find(m => m.id === c.cirurgiao_id)
    || cirurgioes.find(m => (m.nome_curto || '').toUpperCase() === String(c.cirurgiao || '').toUpperCase())
  const outros = cirurgioes.filter(m => m.id !== principal?.id)

  const comp = lerComposicao(c.composicao_equipe || '')
  const membros: Membro[] = []

  const aux1 = (c.rgo_auxiliar1_id && porId.get(c.rgo_auxiliar1_id)) || av('auxiliar1') || outros[0]
  const aux2 = (c.rgo_auxiliar2_id && porId.get(c.rgo_auxiliar2_id)) || av('auxiliar2') || outros.find(m => m.id !== aux1?.id)
  const inst1 = (c.rgo_instrumentador1_id && porId.get(c.rgo_instrumentador1_id)) || av('instrumentador1') || instrumentadores[0]
  const inst2 = (c.rgo_instrumentador2_id && porId.get(c.rgo_instrumentador2_id)) || av('instrumentador2') || instrumentadores.find(m => m.id !== inst1?.id)
  const anest = (c.rgo_anestesista_id && porId.get(c.rgo_anestesista_id)) || av('anestesista') || anestesistas[0]

  if (principal) membros.push({ papel: 'CIRURGIÃO', nome: nome(principal), documento: doc(principal), partes: PARTES.cirurgiao })
  if ((comp.auxiliares >= 1 || c.rgo_auxiliar1_id || avulsa.auxiliar1) && aux1) membros.push({ papel: '1º AUXILIAR', nome: nome(aux1), documento: doc(aux1), partes: PARTES.auxiliar1 })
  if ((comp.auxiliares >= 2 || c.rgo_auxiliar2_id || avulsa.auxiliar2) && aux2) membros.push({ papel: '2º AUXILIAR', nome: nome(aux2), documento: doc(aux2), partes: PARTES.auxiliar2 })
  if ((comp.instrumentadores >= 1 || c.rgo_instrumentador1_id || avulsa.instrumentador1) && inst1) membros.push({ papel: '1º INSTRUMENTADOR(A)', nome: nome(inst1), documento: doc(inst1), partes: PARTES.instrumentador })
  if ((comp.instrumentadores >= 2 || c.rgo_instrumentador2_id || avulsa.instrumentador2) && inst2) membros.push({ papel: '2º INSTRUMENTADOR(A)', nome: nome(inst2), documento: doc(inst2), partes: PARTES.instrumentador })
  if ((comp.anestesista || c.rgo_anestesista_id || avulsa.anestesista) && !c.anestesista_cobra_direto && anest) {
    membros.push({ papel: 'ANESTESISTA', nome: nome(anest), documento: doc(anest), partes: PARTES.anestesista })
  }
  return membros
}

// As listas de materiais dos procedimentos da cirurgia, na ordem do cadastro.
async function listasDeMateriais(admin: any, ids: string[]) {
  if (!ids.length) return []
  const { data } = await admin.from('cirurgia_material_listas')
    .select('id, procedimento_id, nome, itens, empresas, padrao, ordem')
    .in('procedimento_id', ids).eq('ativo', true).order('ordem')
  return (data || []) as any[]
}

// v48.97 — Bloco de medicamentos para a carta de suspensão: uma entrada por
// linha, com o prazo já traduzido para a data de verdade (cirurgia − prazo).
// Sem cirurgia_medicamentos aprovado nenhum, devolve aviso em vez de travar —
// quem decide bloquear o PDF é o chamador (montarTexto/POST 'gerar').
async function montarBlocoMedicamentos(admin: any, c: any) {
  const { data: meds } = await admin.from('cirurgia_medicamentos').select('*').eq('cirurgia_id', c.id).order('criado_em')
  const lista = meds || []
  const pendentes = lista.filter((m: any) => m.prazo_suspensao_dias == null || !String(m.explicacao_paciente || '').trim())
  const linhas = lista.map((m: any) => {
    let dataSuspensao = ''
    if (c.data_cirurgia && m.prazo_suspensao_dias != null) {
      const d = new Date(String(c.data_cirurgia).slice(0, 10) + 'T00:00:00')
      d.setDate(d.getDate() - Number(m.prazo_suspensao_dias))
      dataSuspensao = d.toLocaleDateString('pt-BR')
    }
    const prazo = m.prazo_suspensao_dias != null ? `suspender ${m.prazo_suspensao_dias} dia(s) antes${dataSuspensao ? ` (a partir de ${dataSuspensao})` : ''}` : 'prazo ainda não definido'
    const explicacao = String(m.explicacao_paciente || '').trim()
    return `• ${m.nome_informado.toUpperCase()} — ${prazo}${explicacao ? `: ${explicacao}` : ''}`
  })
  return { texto: linhas.join('\n') || 'Nenhuma medicação cadastrada.', lista, pendentes }
}

async function montarTexto(admin: any, c: any, tipo: Tipo, listasEscolhidas?: string[], manterDuplicados?: string[]) {
  const { data: modelo } = await admin.from('cirurgia_cartas').select('*').eq('tipo', tipo).maybeSingle()
  const { procedimentos, diagnosticos, procedimentoIds, procedimentosResumo } = await procedimentosEDiagnosticos(admin, c)
  const valor = Number(c.valor_cobrado) || 0
  const medicamentos = tipo === 'suspensao_medicamentos' ? await montarBlocoMedicamentos(admin, c) : null
  // v48.93 — O reembolso mostra a mesma divisão do orçamento: é o valor já
  // cobrado do paciente, sendo devolvido pelo convênio.
  const linhas = (tipo === 'orcamento' || tipo === 'reembolso') ? dividirHonorarios(valor, await montarEquipe(admin, c)) : []

  // Materiais: uma lista por procedimento. Sem escolha explícita na tela, vale
  // o que o cirurgião já marcou no link (v48.100); sem isso, a que está
  // marcada como padrão; sem padrão, a primeira do cadastro.
  //
  // v48.119 — "listasEscolhidas" undefined é diferente de []: undefined quer
  // dizer "a tela ainda não perguntou nada, use o padrão de cada
  // procedimento"; um array, mesmo vazio, é escolha EXPLÍCITA da pessoa e
  // vale como está. Sem essa distinção, desmarcar a última lista de um
  // procedimento não tinha como ficar sem nenhuma marcada — sempre voltava
  // ao padrão. Jorge pediu justamente isso: poder desmarcar a "Padrão" da
  // vesícula e manter só a "Panther" da BP, porque uma cobre a outra.
  const todas = tipo === 'solicitacao' ? await listasDeMateriais(admin, procedimentoIds) : []
  const doCirurgiao = Array.isArray(c.material_listas_ids) ? c.material_listas_ids as string[] : []
  const escolhaPadrao = doCirurgiao.length ? doCirurgiao : null
  const usadas = Array.isArray(listasEscolhidas)
    ? todas.filter(l => listasEscolhidas.includes(l.id))
    : todas.filter(l => escolhaPadrao
        ? escolhaPadrao.includes(l.id)
        : (l.padrao || !todas.some(o => o.procedimento_id === l.procedimento_id && o.padrao)))
  // v48.119 — Item repetido entre as listas escolhidas (ex.: trocarte e
  // agulha de Veress na BP e na CCC) não soma: por padrão entra só uma vez.
  // "manterDuplicados" é a exceção, escolhida no aviso da tela, quando as
  // duas ocorrências são mesmo para manter.
  const materiais = montarTextoMateriais(usadas as ListaMaterial[], manterDuplicados)
  const materiaisRepetidos = acharRepetidos(usadas as ListaMaterial[])
  const empresas = Array.from(new Set(usadas.flatMap(l =>
    String(l.empresas || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean)))).join(', ')

  // Horário da internação: o que foi combinado, ou duas horas antes da
  // cirurgia como sugestão — que é o costume da casa. Sugerir é melhor do que
  // deixar em branco numa carta que vai para o hospital.
  const hhmm = (t: any) => String(t || '').slice(0, 5)
  const horaCirurgia = hhmm(c.hora)
  let horaInternacao = hhmm(c.hora_internacao)
  if (!horaInternacao && horaCirurgia) {
    const [h, m] = horaCirurgia.split(':').map(Number)
    const min = ((h * 60 + m - 120) + 1440) % 1440
    horaInternacao = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  }

  const corpo = String(modelo?.corpo || '')
    .replace(/\{materiais\}/g, materiais || '—')
    .replace(/\{empresas\}/g, empresas || '—')
    .replace(/\{hora_internacao\}/g, horaInternacao || 'a combinar')
    // Sem lista de medicações, a frase fica sozinha em vez de terminar num
    // travessão. A lista virá do PausaMed quando integrarmos.
    .replace(/\{remedios\}/g, String(c.medicacoes || '').trim())
    .replace(/\{medicamentos\}/g, medicamentos?.texto || '')
    .replace(/\{paciente\}/g, String(c.paciente_nome || '').toUpperCase())
    .replace(/\{data\}/g, c.data_cirurgia ? String(c.data_cirurgia).slice(0, 10).split('-').reverse().join('/') : 'a definir')
    .replace(/\{hospital\}/g, String(c.hospital || '').toUpperCase())
    // v48.150 — Faltava este placeholder na substituição: o modelo de
    // "suspensao_medicamentos" (cirurgia_cartas) usa "sua cirurgia
    // ({cirurgia})" no meio da frase, mas nada aqui trocava {cirurgia} por
    // nada — saía literal "{cirurgia}" no PDF. Jorge: "AO GERAR O PDF DA
    // MEDICACAO O NOME DA CIRURGIA NAO ESTA SENDO SUBSTITUIDO". Mesmo
    // significado de {cirurgia} usado em todo o resto do sistema (mensagens
    // de WhatsApp por situação, texto do RGO — ver as funções SQL
    // avisar_cirurgias_paradas/mensagem por situação): procedimento_nome da
    // própria cirurgia, sem inventar uma lógica nova só para este PDF.
    .replace(/\{cirurgia\}/g, String(c.procedimento_nome || c.procedimento_sigla || '').toUpperCase())
    .replace(/\{hora\}/g, horaCirurgia || 'a definir')
    // v48.105 — O \t na frente marca "isto é conteúdo de lista, nunca
    // negrito" para montarPdfTimbrado.ts: sem ele, o PDF decidia negrito
    // pela mesma regra dos títulos ("linha inteira maiúscula e curta"), e
    // como procedimento e diagnóstico já são gravados em maiúsculas, um saía
    // em negrito e o de nome mais comprido não — inconsistente e sem
    // sentido para quem lê. Ver comentário lá para o resto da regra.
    .replace(/\{procedimentos\}/g, procedimentos.map(p => '\t' + p).join('\n') || '—')
    .replace(/\{diagnosticos\}/g, diagnosticos.map(p => '\t' + p).join('\n') || '—')
    .replace(/\{valor\}/g, moeda(valor))
    .replace(/\{valor_extenso\}/g, reaisPorExtenso(valor))
    .replace(/\{divisao\}/g, textoDivisao(linhas))
    .replace(/\{cirurgiao\}/g, String(c.cirurgiao || ''))
    // v48.137 — Pedido do Jorge: "o orçamento do hospital será enviado
    // separado" só faz sentido quando o convênio NÃO cobre o hospital, ou
    // seja, particular total. Com convênio (mesmo "particular com convênio"),
    // o hospital é coberto e a frase confunde. Ver migração v48.137 que troca
    // o texto fixo da carta padrão por este placeholder.
    .replace(/\{aviso_hospital_separado\}/g, ehParticularTotal(c.modalidade) ? 'O ORÇAMENTO DO HOSPITAL SERÁ ENVIADO SEPARADAMENTE.' : '')

  return {
    titulo: String(modelo?.titulo || 'DOCUMENTO'), texto: corpo, valor, linhas,
    listas: todas.map(l => ({ id: l.id, procedimento_id: l.procedimento_id, nome: l.nome, padrao: l.padrao })),
    listasUsadas: usadas.map(l => l.id),
    // v48.119 — Sigla/nome de cada procedimento da cirurgia, para a tela
    // agrupar "qual material é de qual cirurgia" quando há 2+ procedimentos
    // (ex.: "BP" e "CCC") — pedido do Jorge de deixar isso claro na tela.
    materiaisProcedimentos: procedimentosResumo,
    // v48.119 — Itens que se repetem entre as listas escolhidas, para o
    // aviso "isso está duplicado, quer manter as duas ou só uma?".
    materiaisRepetidos,
    // v48.100 — Para a tela avisar "material já definido pelo cirurgião",
    // mesmo que a secretária depois troque a lista na tela.
    materiaisDoCirurgiao: tipo === 'solicitacao' && doCirurgiao.length > 0,
    medicamentosPendentes: medicamentos?.pendentes.length || 0,
    medicamentosVazio: tipo === 'suspensao_medicamentos' && !medicamentos?.lista.length,
  }
}

async function acharCirurgia(admin: any, id: string) {
  const { data } = await admin.from('cirurgias')
    .select(`id, contact_id, paciente_nome, data_cirurgia, hora, hospital, cirurgiao, cirurgiao_id, procedimento_id, procedimento_sigla, procedimento_nome,
      composicao_equipe, anestesista_cobra_direto, valor_cobrado, hora_internacao, medicacoes, material_listas_ids, modalidade,
      rgo_cirurgiao_id, rgo_auxiliar1_id, rgo_auxiliar2_id, rgo_instrumentador1_id, rgo_instrumentador2_id, rgo_anestesista_id,
      rgo_equipe_avulsa`)
    .eq('id', id).maybeSingle()
  return data
}

// v48.137 — "Particular total" x "particular com convênio" x "convênio" x
// "via hospital" são nomes livres cadastrados em Configurações → Cirurgias →
// Modalidades (não um enum fixo) — mesmo jeito de reconhecer convênio que já
// existia em CirurgiaModal.tsx (pedeCarteirinha). Aqui serve para: (1) só
// mostrar o aviso "orçamento do hospital será enviado separado" quando for
// particular TOTAL (sem convênio nenhum — o hospital não é coberto), e (2) só
// deixar o botão Reembolso ativo quando for particular COM convênio (só nesse
// caso o paciente paga e depois pede reembolso ao convênio).
function ehParticularTotal(modalidade: string) {
  const m = String(modalidade || '')
  return /particular/i.test(m) && !/conv[êe]nio/i.test(m)
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  const c = await acharCirurgia(admin, String(params.id || ''))
  if (!c) return NextResponse.json({ erro: 'Cirurgia não encontrada' }, { status: 404 })

  // v48.118 — "os botões dos docs já enviados devem ficar com fundo verde":
  // pra colorir os 5 botões de tipo já na abertura da tela (sem precisar
  // clicar em cada um), o front busca esse resumo uma vez, ao montar.
  if (req.nextUrl.searchParams.get('resumo') === '1') {
    const { data } = await admin.from('cirurgia_documentos')
      .select('tipo, enviado_em').eq('cirurgia_id', c.id).not('enviado_em', 'is', null)
    const enviados: Record<string, boolean> = {}
    for (const d of (data || []) as any[]) enviados[d.tipo] = true
    // v48.137 — Junto com o resumo (já buscado ao abrir a tela) vai a
    // modalidade, para a tela decidir se o botão Reembolso fica ativo sem
    // precisar de outra ida ao servidor.
    return NextResponse.json({ enviados, modalidade: c.modalidade || '' })
  }

  const tipo = ehTipo(req.nextUrl.searchParams.get('tipo'))
  // v48.119 — A presença do parâmetro "listas" (mesmo vazio) é que diz se é
  // escolha explícita ou carregamento inicial — ver o comentário em
  // montarTexto. "manter" traz as chaves (normalizadas) dos itens repetidos
  // que a pessoa decidiu manter duplicados mesmo assim.
  const escolhidas = req.nextUrl.searchParams.has('listas')
    ? (req.nextUrl.searchParams.get('listas') || '').split(',').map(x => x.trim()).filter(Boolean)
    : undefined
  const manterDuplicados = (req.nextUrl.searchParams.get('manter') || '')
    .split(',').map(x => x.trim()).filter(Boolean).map(x => { try { return decodeURIComponent(x) } catch { return x } })
  const montado = await montarTexto(admin, c, tipo, escolhidas, manterDuplicados)
  // v48.168 — "texto" entra na seleção para o botão Editar (abaixo) poder
  // recarregar exatamente o que foi salvo naquele documento, em vez de
  // remontar do zero (o que perderia qualquer ajuste manual feito na hora).
  const { data: anteriores } = await admin.from('cirurgia_documentos')
    .select('id, tipo, titulo, texto, url, nome_arquivo, criado_em, criado_por, enviado_em, valor')
    .eq('cirurgia_id', c.id).eq('tipo', tipo).order('criado_em', { ascending: false }).limit(20)

  return NextResponse.json({ ...montado, temPaciente: !!c.contact_id, anteriores: anteriores || [] })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  const { data: agente } = await admin.from('agents').select('id, name').eq('id', user.id).maybeSingle()

  const c = await acharCirurgia(admin, String(params.id || ''))
  if (!c) return NextResponse.json({ erro: 'Cirurgia não encontrada' }, { status: 404 })

  let b: any = {}
  try { b = await req.json() } catch {}

  // --- enviar ao paciente ---------------------------------------------------
  if (b.acao === 'enviar') {
    if (!c.contact_id) return NextResponse.json({ erro: 'Esta cirurgia não está ligada a um contato do CRM.' }, { status: 400 })
    const { data: doc } = await admin.from('cirurgia_documentos').select('*').eq('id', String(b.id || '')).maybeSingle()
    if (!doc?.url) return NextResponse.json({ erro: 'Documento não encontrado.' }, { status: 404 })
    // v48.96 — A solicitação de procedimento vai para o hospital, não para o
    // paciente. Travar aqui também, e não só escondendo o botão na tela, porque
    // é a API que decide o que pode ser enfileirado no WhatsApp do paciente.
    if (doc.tipo === 'solicitacao') {
      return NextResponse.json({ erro: 'A solicitação de procedimento é enviada ao hospital, não ao paciente.' }, { status: 400 })
    }

    const texto = String(b.mensagem || '').trim()
    if (texto) {
      const { error } = await admin.from('messages').insert({
        contact_id: c.contact_id, channel: 'whatsapp', direction: 'outbound', status: 'queued',
        content: texto, sender_id: agente?.id ?? null,
      })
      if (error) return NextResponse.json({ erro: 'Não consegui enfileirar a mensagem: ' + error.message }, { status: 500 })
      await new Promise(r => setTimeout(r, 900))
    }
    const { error: err2 } = await admin.from('messages').insert({
      contact_id: c.contact_id, channel: 'whatsapp', direction: 'outbound', status: 'queued',
      media_url: doc.url, media_type: 'document', content: doc.nome_arquivo || 'orcamento.pdf',
      sender_id: agente?.id ?? null,
    })
    if (err2) return NextResponse.json({ erro: 'Não consegui enfileirar o arquivo: ' + err2.message }, { status: 500 })

    await admin.from('cirurgia_documentos').update({ enviado_em: new Date().toISOString() }).eq('id', doc.id)
    return NextResponse.json({ ok: true })
  }

  // --- apagar um documento não enviado --------------------------------------
  // v48.168 — Jorge: gerar um orçamento e não enviar deixava o PDF preso na
  // lista "Já gerados" para sempre — sem jeito de apagar, e cada tentativa
  // nova (ajustar algo e gerar de novo) só empilhava mais um. Só dá para
  // apagar o que ainda NÃO foi enviado: um documento já enviado é o registro
  // do que o paciente recebeu (ver comentário no topo do arquivo de v48.69),
  // e esse histórico não pode desaparecer.
  if (b.acao === 'apagar') {
    const { data: doc } = await admin.from('cirurgia_documentos')
      .select('id, nome_arquivo, enviado_em').eq('id', String(b.id || '')).eq('cirurgia_id', c.id).maybeSingle()
    if (!doc) return NextResponse.json({ erro: 'Documento não encontrado.' }, { status: 404 })
    if (doc.enviado_em) return NextResponse.json({ erro: 'Este documento já foi enviado ao paciente — não pode ser apagado.' }, { status: 400 })
    if (doc.nome_arquivo) await admin.storage.from('documentos').remove([`${c.id}/${doc.nome_arquivo}`]).catch(() => {})
    const { error } = await admin.from('cirurgia_documentos').delete().eq('id', doc.id)
    if (error) return NextResponse.json({ erro: 'Não consegui apagar: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // --- marcar como enviado (sem WhatsApp) ------------------------------------
  // v48.118 — A solicitação de procedimento vai pro hospital "por fora" (ver
  // bloqueio acima) — nunca tinha como o botão dela ficar verde porque nada
  // nunca gravava enviado_em. Isso aqui é só um "carimbo" manual: quem gerou
  // confirma que já mandou por fora, e o botão do tipo na tela principal
  // passa a mostrar fundo verde.
  if (b.acao === 'marcar_enviado') {
    const { data: doc } = await admin.from('cirurgia_documentos').select('id').eq('id', String(b.id || '')).maybeSingle()
    if (!doc) return NextResponse.json({ erro: 'Documento não encontrado.' }, { status: 404 })
    await admin.from('cirurgia_documentos').update({ enviado_em: new Date().toISOString() }).eq('id', doc.id)
    return NextResponse.json({ ok: true })
  }

  // --- gerar o PDF ----------------------------------------------------------
  const tipo = ehTipo(b.tipo)
  // v48.119 — b.listas vem sempre preenchido pela tela (mesmo vazio, quando a
  // pessoa desmarcou tudo de propósito) por essa altura — ver montarTexto.
  const montado = await montarTexto(
    admin, c, tipo,
    Array.isArray(b.listas) ? b.listas : undefined,
    Array.isArray(b.manterDuplicados) ? b.manterDuplicados : undefined,
  )
  const titulo = String(b.titulo || montado.titulo)
  const texto = String(b.texto || montado.texto)

  // v48.168 — Editar um documento ainda não enviado: em vez de empilhar mais
  // um na lista "Já gerados", SUBSTITUI o mesmo registro (mesmo "id" na
  // lista). Só vale para o que ainda não foi enviado — ver "apagar" acima,
  // mesma regra de não tocar no que já é histórico de envio.
  const substituirId = String(b.substituirId || '')
  let antigo: { id: string; nome_arquivo: string } | null = null
  if (substituirId) {
    const { data: doc } = await admin.from('cirurgia_documentos')
      .select('id, nome_arquivo, enviado_em').eq('id', substituirId).eq('cirurgia_id', c.id).maybeSingle()
    if (!doc) return NextResponse.json({ erro: 'Documento a substituir não encontrado.' }, { status: 404 })
    if (doc.enviado_em) return NextResponse.json({ erro: 'Este documento já foi enviado ao paciente — gere um novo em vez de substituir.' }, { status: 400 })
    antigo = doc
  }

  // v48.97 — O PDF de suspensão fica bloqueado enquanto houver medicação sem
  // prazo/explicação definidos: é exatamente o que a integração com o
  // PausaMed existe para evitar — mandar uma orientação incompleta ao
  // paciente. Gerar o PDF é o que aprova as medicações (ver abaixo).
  if (tipo === 'suspensao_medicamentos') {
    if (montado.medicamentosVazio) return NextResponse.json({ erro: 'Não há medicações cadastradas para esta cirurgia. Adicione ao menos uma antes de gerar.' }, { status: 400 })
    if (montado.medicamentosPendentes > 0) return NextResponse.json({ erro: `${montado.medicamentosPendentes} medicação(ões) ainda sem prazo/orientação definidos. Revise antes de gerar.` }, { status: 400 })
  }

  // A folha é a do cirurgião do caso: cabeçalho, marca d'água e rodapé dele.
  const { data: medico } = await admin.from('cirurgia_equipe')
    .select('papel_url, margem_topo_mm, margem_base_mm, margem_esquerda_mm, margem_direita_mm')
    .eq('id', c.cirurgiao_id).maybeSingle()

  let pdf: Uint8Array
  try {
    pdf = await montarPdfTimbrado({
      titulo, texto,
      papelUrl: medico?.papel_url || null,
      margens: {
        topo: Number(medico?.margem_topo_mm ?? 45),
        base: Number(medico?.margem_base_mm ?? 35),
        esquerda: Number(medico?.margem_esquerda_mm ?? 25),
        direita: Number(medico?.margem_direita_mm ?? 20),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ erro: 'Não consegui montar o PDF: ' + (e?.message || e) }, { status: 500 })
  }

  // v48.154 — Jorge: "JOÃO - JO-O" — o nome do arquivo trocava CADA acento por
  // um hífen (regex [^a-z0-9] não reconhece "ã"), então "João" virava "Jo-o"
  // em vez de "joao". semAcento() (lib/texto.ts) tira só o acento e mantém a
  // letra antes de gerar o slug — mesmo normalizador já usado na busca.
  const nome = `${tipo}-${semAcento(c.paciente_nome || 'paciente').replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now()}.pdf`
  const caminho = `${c.id}/${nome}`
  const { error } = await admin.storage.from('documentos').upload(caminho, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false })
  if (error) return NextResponse.json({ erro: 'Não consegui guardar o PDF: ' + error.message }, { status: 500 })
  const url = admin.storage.from('documentos').getPublicUrl(caminho).data.publicUrl

  // v48.168 — Substituindo (editar): atualiza o mesmo registro e some com o
  // PDF antigo do storage. Sem substituirId, segue como sempre — um registro
  // novo por documento gerado.
  const { data: salvo, error: err3 } = antigo
    ? await admin.from('cirurgia_documentos')
        .update({ titulo, texto, valor: tipo === 'orcamento' ? montado.valor : null, url, nome_arquivo: nome, criado_em: new Date().toISOString() })
        .eq('id', antigo.id).select('id, url, nome_arquivo, criado_em').single()
    : await admin.from('cirurgia_documentos').insert({
        cirurgia_id: c.id, tipo, titulo, texto, valor: tipo === 'orcamento' ? montado.valor : null,
        url, nome_arquivo: nome, criado_por: agente?.name || 'Equipe',
      }).select('id, url, nome_arquivo, criado_em').single()
  if (err3) return NextResponse.json({ erro: 'PDF gerado, mas não consegui registrar: ' + err3.message }, { status: 500 })
  if (antigo && antigo.nome_arquivo) await admin.storage.from('documentos').remove([`${c.id}/${antigo.nome_arquivo}`]).catch(() => {})

  // v48.97 — Gerar o PDF de suspensão é o momento da aprovação: os
  // medicamentos usados nele ficam travados (a API de edição já recusa mexer
  // num 'aprovado') e é esse conjunto que dispara o aviso de véspera por
  // remédio (avisar_suspensao_medicamentos, varrido como os demais avisos).
  if (tipo === 'suspensao_medicamentos') {
    await admin.from('cirurgia_medicamentos')
      .update({ status: 'aprovado', aprovado_por: agente?.id ?? null, aprovado_em: new Date().toISOString() })
      .eq('cirurgia_id', c.id).neq('status', 'aprovado')
  }

  return NextResponse.json({ ok: true, documento: salvo })
}
