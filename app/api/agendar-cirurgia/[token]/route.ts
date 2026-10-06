import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { resolverMedicamento, sugerirMedicamentos } from '@/lib/pausamed'

// v48.76 — A página de agendamento do cirurgião.
//
// Sem login: a chave longa no endereço é a senha, como na página da RGO. Por
// isso tudo passa por aqui, no servidor — a página nunca fala direto com o
// banco, e o que ela consegue ler é só o que este arquivo devolve.
//
// O que o cirurgião NÃO alcança, por decisão de escopo: valores, convênio
// autorizado, cartas, cobrança e as cirurgias dos outros.

export const runtime = 'nodejs'
export const maxDuration = 60

const LIMITE = 15 * 1024 * 1024

async function conferir(token: string) {
  const admin = getSupabaseAdmin()
  // Aceita a chave curta (10) e a longa antiga (64), para um link já enviado
  // não parar de funcionar quando a clínica encurtar o endereço.
  if (!admin || !/^[A-Za-z0-9]{8,80}$/.test(token)) return { admin: null as any, cfg: null as any }
  const { data } = await admin.from('clinic_settings').select('id, agenda_cirurgiao').limit(1).maybeSingle()
  const cfg = (data as any)?.agenda_cirurgiao || null
  if (!cfg?.ativa || String(cfg.token || '') !== token) return { admin, cfg: null }
  return { admin, cfg }
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { admin, cfg } = await conferir(String(params.token || ''))
  if (!admin || !cfg) return NextResponse.json({ erro: 'Link inválido ou desativado.' }, { status: 404 })

  const equipeId = req.nextUrl.searchParams.get('equipe') || ''

  const [equipe, hospitais, convenios, modalidades, vias, procedimentos, status, materiais] = await Promise.all([
    admin.from('cirurgia_equipe').select('id, nome_curto, nome_completo, funcao').eq('ativo', true).order('ordem'),
    admin.from('cirurgia_hospitais').select('id, nome').eq('ativo', true).order('ordem'),
    admin.from('cirurgia_convenios').select('id, nome').eq('ativo', true).order('ordem'),
    admin.from('cirurgia_modalidades').select('id, nome').eq('ativo', true).order('ordem'),
    admin.from('cirurgia_vias').select('id, nome').eq('ativo', true).order('ordem'),
    // Os valores de tabela vêm junto: é com eles que a página calcula o
    // orçamento sozinha, igual ao CRM.
    admin.from('cirurgia_procedimentos').select('id, sigla, nome, valor_equipe, valor_anestesista').eq('ativo', true).order('ordem'),
    admin.from('cirurgia_status').select('id, nome, cor').eq('ativo', true).order('ordem'),
    // v48.100 — As listas de materiais de cada procedimento, para ele já
    // escolher aqui.
    // v48.117 — "itens" entrou na consulta: antes só nome e padrão vinham,
    // porque o texto de verdade era coisa só da secretaria; Jorge pediu para
    // o cirurgião também poder VER o material escolhido aqui no link dele,
    // não só o nome da lista.
    admin.from('cirurgia_material_listas').select('id, procedimento_id, nome, padrao, itens').eq('ativo', true).order('ordem'),
  ])

  // As mais lançadas por este cirurgião, para ficarem a um toque.
  let frequentes: any[] = []
  if (equipeId) {
    const { data } = await admin.rpc('cirurgias_frequentes', { p_equipe: equipeId, p_limite: 5 })
    const porId = new Map((procedimentos.data || []).map((p: any) => [p.id, p]))
    frequentes = (data || []).map((x: any) => ({
      ...x,
      valor_equipe: (porId.get(x.procedimento_id) as any)?.valor_equipe || 0,
      valor_anestesista: (porId.get(x.procedimento_id) as any)?.valor_anestesista || 0,
    }))
  }

  // As cirurgias dele, para conferir e editar.
  let minhas: any[] = []
  if (equipeId) {
    const SELECT_MINHAS = `id, contact_id, paciente_nome, paciente_telefone, data_cirurgia, hora, hospital,
        hospital_estado, hospital_cidade, hospital_pausamed_id,
        status, status_id, procedimento_sigla, procedimento_nome, observacao, categoria, motivo_cancelamento,
        modalidade, convenio_id, convenio, via_acesso, medicacoes, composicao_equipe,
        valor_cobrado, valor_cobrado_manual, material_listas_ids`
    let { data, error } = await admin.from('cirurgias')
      .select(SELECT_MINHAS)
      .eq('cirurgiao_id', equipeId)
      // v48.79 — Só as em andamento.
      //
      // Realizada e cancelada são histórico: o cirurgião não mexe mais nelas, e
      // uma lista que cresce para sempre esconde as que ainda precisam de algo.
      // O histórico completo ele consulta pelo CRM.
      .or('categoria.is.null,categoria.eq.aberta')
      .order('data_cirurgia', { ascending: true, nullsFirst: false })
      .limit(60)

    // v48.102 — Blindagem: se a coluna nova (material_listas_ids, v48.100)
    // ainda não existir no banco porque a migração não rodou antes do
    // deploy, a query acima falha inteira e ANTES disso a lista virava []
    // silenciosamente — o cirurgião via a tela de agendamento vazia, sem
    // nenhum aviso, como se não tivesse cirurgia em andamento nenhuma. Agora,
    // se der erro, tenta de novo sem a coluna nova em vez de sumir com tudo.
    //
    // v48.110 — Mesma blindagem para as 3 colunas novas do hospital do
    // PausaMed (hospital_estado/hospital_cidade/hospital_pausamed_id): se a
    // migração ainda não rodou, tenta de novo sem elas também, em vez de
    // deixar a tela inteira em branco.
    if (error) {
      console.error('[agendar-cirurgia] falha ao buscar cirurgias do cirurgião, tentando sem material_listas_ids:', error.message)
      let retry = await admin.from('cirurgias')
        .select(SELECT_MINHAS.replace(', material_listas_ids', ''))
        .eq('cirurgiao_id', equipeId)
        .or('categoria.is.null,categoria.eq.aberta')
        .order('data_cirurgia', { ascending: true, nullsFirst: false })
        .limit(60)
      if (retry.error) {
        console.error('[agendar-cirurgia] falha também sem material_listas_ids, tentando sem os campos de hospital do PausaMed:', retry.error.message)
        retry = await admin.from('cirurgias')
          .select(SELECT_MINHAS.replace(', material_listas_ids', '').replace(/\s*hospital_estado, hospital_cidade, hospital_pausamed_id,/, ''))
          .eq('cirurgiao_id', equipeId)
          .or('categoria.is.null,categoria.eq.aberta')
          .order('data_cirurgia', { ascending: true, nullsFirst: false })
          .limit(60)
        data = (retry.data || []).map((m: any) => ({
          ...m, material_listas_ids: [], hospital_estado: null, hospital_cidade: null, hospital_pausamed_id: null,
        })) as any
        if (retry.error) console.error('[agendar-cirurgia] falha também sem os campos de hospital do PausaMed:', retry.error.message)
      } else {
        data = (retry.data || []).map((m: any) => ({ ...m, material_listas_ids: [] })) as any
      }
    }
    minhas = data || []

    // v48.87 — Reabrir uma cirurgia para editar precisa trazer de volta o que
    // foi escolhido, senão o formulário volta em branco e parece que sumiu:
    // os procedimentos são lidos à parte (ficam na tabela de itens, para dar
    // conta de cirurgia conjugada), com o valor de tabela junto para o cálculo
    // funcionar igual à primeira vez.
    if (minhas.length) {
      const ids = minhas.map((m: any) => m.id)
      const [{ data: itens }, { data: procs }] = await Promise.all([
        admin.from('cirurgia_itens').select('cirurgia_id, procedimento_id, sigla, nome, ordem').in('cirurgia_id', ids).order('ordem'),
        admin.from('cirurgia_procedimentos').select('id, valor_equipe, valor_anestesista'),
      ])
      const valorPorId = new Map((procs || []).map((p: any) => [p.id, p]))
      const itensPorCirurgia = new Map<string, any[]>()
      for (const it of (itens || []) as any[]) {
        const lista = itensPorCirurgia.get(it.cirurgia_id) || []
        const v = valorPorId.get(it.procedimento_id) as any
        lista.push({
          id: it.procedimento_id, sigla: it.sigla, nome: it.nome,
          valor_equipe: v?.valor_equipe || 0, valor_anestesista: v?.valor_anestesista || 0,
        })
        itensPorCirurgia.set(it.cirurgia_id, lista)
      }
      minhas = minhas.map((m: any) => ({ ...m, itens: itensPorCirurgia.get(m.id) || [] }))

      // v48.106 — Alergia do paciente, para o selo vermelho aparecer também
      // aqui. Só leitura: quem cadastra ou edita a alergia é a secretaria,
      // pelo CRM — o cirurgião só precisa ver, na hora de decidir a receita.
      const contactIds = Array.from(new Set(minhas.map((m: any) => m.contact_id).filter(Boolean)))
      if (contactIds.length) {
        const { data: contatos } = await admin.from('contacts')
          .select('id, alergico, alergia_obs').in('id', contactIds).eq('alergico', true)
        const mapaAlergia = new Map((contatos || []).map((x: any) => [x.id, x]))
        minhas = minhas.map((m: any) => {
          const a = m.contact_id ? mapaAlergia.get(m.contact_id) : null
          return { ...m, alergico: !!(a as any)?.alergico, alergia_obs: (a as any)?.alergia_obs || null }
        })
      }
    }
  }

  const acha = (id: string) => (status.data || []).find((x: any) => x.id === id) || {}
  const nomeStatus = (id: string) => (acha(id) as any).nome || ''
  const corStatus = (id: string) => (acha(id) as any).cor || ''
  // A cor de cada situação, pelo nome, como a lista do CRM faz.
  const cores: Record<string, string> = {}
  for (const x of (status.data || []) as any[]) if (x.nome) cores[x.nome] = x.cor

  return NextResponse.json({
    equipe: equipe.data || [],
    hospitais: (hospitais.data || []).map((h: any) => h.nome),
    convenios: convenios.data || [],
    modalidades: (modalidades.data || []).map((m: any) => m.nome),
    vias: (vias.data || []).map((v: any) => v.nome),
    procedimentos: procedimentos.data || [],
    materiaisListas: materiais.data || [],
    frequentes,
    minhas,
    cores,
    situacoes: {
      preop: { id: cfg.status_preop, nome: nomeStatus(cfg.status_preop), cor: corStatus(cfg.status_preop) },
      agendar: { id: cfg.status_agendar, nome: nomeStatus(cfg.status_agendar), cor: corStatus(cfg.status_agendar) },
      cancelada: { id: cfg.status_cancelada, nome: nomeStatus(cfg.status_cancelada), cor: corStatus(cfg.status_cancelada) },
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const { admin, cfg } = await conferir(String(params.token || ''))
  if (!admin || !cfg) return NextResponse.json({ erro: 'Link inválido ou desativado.' }, { status: 404 })

  // --- anexos (multipart) ---------------------------------------------------
  if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await req.formData()
    const cirurgiaId = String(form.get('cirurgia_id') || '')
    const arquivos = form.getAll('arquivos').filter(f => typeof f !== 'string') as File[]
    if (!cirurgiaId || !arquivos.length) return NextResponse.json({ erro: 'Nada para anexar.' }, { status: 400 })

    const { data: c } = await admin.from('cirurgias').select('id, anexos').eq('id', cirurgiaId).maybeSingle()
    if (!c) return NextResponse.json({ erro: 'Cirurgia não encontrada.' }, { status: 404 })

    const novos: any[] = []
    for (let i = 0; i < arquivos.length; i++) { const f = arquivos[i]
      if (f.size > LIMITE) return NextResponse.json({ erro: `"${f.name}" passa de 15 MB.` }, { status: 400 })
      const tipo = f.type || 'application/octet-stream'
      const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
      const caminho = `${cirurgiaId}/${Date.now()}-${i}.${ext}`
      const { error } = await admin.storage.from('anexos').upload(caminho, Buffer.from(await f.arrayBuffer()), { contentType: tipo })
      if (error) return NextResponse.json({ erro: 'Não consegui guardar: ' + error.message }, { status: 500 })
      novos.push({
        url: admin.storage.from('anexos').getPublicUrl(caminho).data.publicUrl,
        nome: f.name, tipo, enviado_em: new Date().toISOString(),
      })
    }
    const lista = [...(Array.isArray(c.anexos) ? c.anexos : []), ...novos]
    await admin.from('cirurgias').update({ anexos: lista }).eq('id', c.id)
    return NextResponse.json({ ok: true, anexos: lista })
  }

  let b: any = {}
  try { b = await req.json() } catch {}

  // --- procurar o paciente --------------------------------------------------
  if (b.acao === 'buscar_paciente') {
    const termo = String(b.termo || '').trim()
    if (termo.length < 3) return NextResponse.json({ contatos: [] })

    // v48.106 — Marca quem já está com alergia cadastrada, para o selo
    // aparecer assim que ele escolhe o paciente, sem precisar reabrir.
    const marcarAlergia = async (contatos: any[]) => {
      const ids = contatos.map(c => c.id).filter(Boolean)
      if (!ids.length) return contatos
      const { data: al } = await admin.from('contacts').select('id, alergico, alergia_obs').in('id', ids).eq('alergico', true)
      const mapa = new Map((al || []).map((x: any) => [x.id, x]))
      return contatos.map(c => {
        const a = c.id ? mapa.get(c.id) : null
        return { ...c, alergico: !!(a as any)?.alergico, alergia_obs: (a as any)?.alergia_obs || null }
      })
    }

    // v48.77 — Procura no CRM e no espelho do MedX. Quem já é contato do CRM
    // vem primeiro; quem só existe no MedX vem marcado, e o contato é criado
    // no CRM na hora em que o cirurgião escolhe.
    const { data, error } = await admin.rpc('buscar_pacientes', { p_termo: termo, p_limite: 8 })
    if (!error) {
      const contatos = await marcarAlergia((data || []).map((c: any) => ({
        id: c.origem === 'crm' ? c.id : '', nome: c.nome, telefone: c.telefone,
        id_medx: c.id_medx || null, origem: c.origem,
      })))
      return NextResponse.json({ contatos })
    }
    // Migração ainda não rodada: o CRM sozinho continua respondendo.
    const { data: so } = await admin.rpc('buscar_contatos', { p_termo: termo, p_limite: 8 })
    const contatos = await marcarAlergia((so || []).map((c: any) => ({ id: c.id, nome: c.full_name, telefone: c.phone, origem: 'crm' })))
    return NextResponse.json({ contatos })
  }

  // --- buscar no catálogo TUSS -----------------------------------------------
  // v48.102 — A mesma busca que o CRM já tem em EscolherProcedimento.tsx: além
  // das cirurgias já cadastradas (que vêm inteiras no GET), procura também no
  // catálogo da ANS, para o cirurgião achar uma que a clínica ainda não opera.
  if (b.acao === 'buscar_tuss') {
    const termo = String(b.termo || '').trim()
    if (termo.length < 2) return NextResponse.json({ tuss: [] })
    const limpo = termo.replace(/[,()*%]/g, ' ').trim()
    const numeros = limpo.replace(/\D/g, '')
    const { data } = await admin.from('tuss_catalog').select('code, procedure_name')
      .or(numeros.length >= 4 ? `code.ilike.${numeros}%` : `procedure_name.ilike.%${limpo}%`)
      .eq('is_active', true).limit(8)
    return NextResponse.json({ tuss: (data || []).map((t: any) => ({ codigo: t.code, nome: t.procedure_name })) })
  }

  // --- cadastrar uma cirurgia nova a partir do catálogo TUSS -----------------
  if (b.acao === 'cadastrar_procedimento') {
    const nome = String(b.nome || '').trim()
    const sigla = String(b.sigla || '').trim()
    const codigo = String(b.codigo || '').trim()
    if (!nome) return NextResponse.json({ erro: 'Informe o nome.' }, { status: 400 })
    if (!sigla) return NextResponse.json({ erro: 'Informe a abreviação.' }, { status: 400 })
    const { data, error } = await admin.from('cirurgia_procedimentos').insert({
      sigla, nome, valor_equipe: 0, valor_anestesista: 0, via_padrao: String(b.via || '').trim() || null, ordem: 999,
    }).select('id, sigla, nome, valor_equipe, valor_anestesista').single()
    if (error) return NextResponse.json({ erro: 'Não consegui cadastrar: ' + error.message }, { status: 500 })
    // O código TUSS vem junto, do mesmo jeito que na tela interna — é por ele
    // que a guia do convênio vai reconhecer o procedimento.
    if (codigo) await admin.from('cirurgia_proc_tuss').insert({ procedimento_id: data.id, codigo, ordem: 1 })
    return NextResponse.json({ procedimento: data })
  }

  // --- cadastrar um convênio novo, na hora ----------------------------------
  // v48.116 — Mesma folga que o cadastro de procedimento (acima): o
  // cirurgião não pode ficar travado na tela de agendamento porque o
  // convênio do paciente ainda não está na lista. Mesma regra de
  // duplicidade do SelectComCriar usado no CRM (acento/caixa não contam
  // como convênio diferente), só que verificada aqui no servidor — esta
  // página pública nunca fala direto com o banco.
  if (b.acao === 'criar_convenio') {
    const nome = String(b.nome || '').trim()
    if (!nome) return NextResponse.json({ erro: 'Informe o nome.' }, { status: 400 })
    const { data: existentes } = await admin.from('cirurgia_convenios').select('id, nome').eq('ativo', true)
    const igual = (existentes || []).find((c: any) => c.nome.localeCompare(nome, 'pt-BR', { sensitivity: 'base' }) === 0)
    if (igual) return NextResponse.json({ convenio: igual })
    const { data, error } = await admin.from('cirurgia_convenios')
      .insert({ nome, ordem: (existentes?.length || 0) + 1 })
      .select('id, nome').single()
    if (error) return NextResponse.json({ erro: 'Não consegui cadastrar: ' + error.message }, { status: 500 })
    return NextResponse.json({ convenio: data })
  }

  // --- cadastrar uma lista de materiais nova, na hora -----------------------
  // v48.117 — Jorge pediu para o cirurgião poder gravar um material novo sem
  // sair da tela de agendamento, igual já dava para fazer com convênio
  // (acima) e procedimento (cadastrar_procedimento) — mesma ideia, com o
  // texto dos itens em vez de só um nome.
  if (b.acao === 'criar_material_lista') {
    const procedimentoId = String(b.procedimento_id || '').trim()
    const nome = String(b.nome || '').trim()
    const itensTexto = String(b.itens || '')
    if (!procedimentoId) return NextResponse.json({ erro: 'Procedimento inválido.' }, { status: 400 })
    if (!nome) return NextResponse.json({ erro: 'Informe o nome da lista.' }, { status: 400 })
    const { data: existentes } = await admin.from('cirurgia_material_listas')
      .select('id, procedimento_id, nome, padrao, itens').eq('procedimento_id', procedimentoId).eq('ativo', true)
    const igual = (existentes || []).find((l: any) => l.nome.localeCompare(nome, 'pt-BR', { sensitivity: 'base' }) === 0)
    if (igual) return NextResponse.json({ lista: igual })
    const { data, error } = await admin.from('cirurgia_material_listas')
      .insert({
        procedimento_id: procedimentoId, nome, itens: itensTexto,
        padrao: !(existentes && existentes.length), ativo: true, ordem: existentes?.length || 0,
      })
      .select('id, procedimento_id, nome, padrao, itens').single()
    if (error) return NextResponse.json({ erro: 'Não consegui cadastrar: ' + error.message }, { status: 500 })
    return NextResponse.json({ lista: data })
  }

  // --- criar o contato quando não existe -----------------------------------
  if (b.acao === 'criar_paciente') {
    const nome = String(b.nome || '').trim()
    const telefone = String(b.telefone || '').replace(/[^0-9]/g, '')
    if (!nome) return NextResponse.json({ erro: 'Informe o nome.' }, { status: 400 })
    // Telefone repetido é o mesmo paciente: devolve o que existe em vez de
    // criar um irmão gêmeo do cadastro.
    if (telefone) {
      const { data: achado } = await admin.from('contacts').select('id, full_name, phone')
        .eq('phone', telefone).maybeSingle()
      if (achado) return NextResponse.json({ contato: { id: achado.id, nome: achado.full_name, telefone: achado.phone } })
    }
    const { data: novo, error } = await admin.from('contacts')
      .insert({ full_name: nome, phone: telefone || null, medx_id: String(b.id_medx || '') || null })
      .select('id, full_name, phone').single()
    if (error) return NextResponse.json({ erro: 'Não consegui cadastrar: ' + error.message }, { status: 500 })
    return NextResponse.json({ contato: { id: novo.id, nome: novo.full_name, telefone: novo.phone } })
  }

  // --- trocar só a situação -------------------------------------------------
  // v48.80 — O que mais acontece no dia a dia é a situação mudar. Obrigar a
  // abrir o formulário inteiro para isso é o caminho para a lista ficar
  // desatualizada — a mesma razão pela qual o CRM troca pela etiqueta.
  if (b.acao === 'situacao') {
    const id = String(b.id || '')
    if (!id) return NextResponse.json({ erro: 'Cirurgia não informada.' }, { status: 400 })
    const qual = b.situacao === 'agendar' ? 'agendar' : b.situacao === 'cancelada' ? 'cancelada' : 'preop'
    if (qual === 'cancelada' && !String(b.motivo_cancelamento || '').trim()) {
      return NextResponse.json({ erro: 'Escreva o motivo do cancelamento.' }, { status: 400 })
    }
    const statusId = cfg[`status_${qual}`] || null
    const { data: st } = statusId
      ? await admin.from('cirurgia_status').select('nome, categoria').eq('id', statusId).maybeSingle()
      : { data: null as any }

    const { error } = await admin.from('cirurgias').update({
      status_id: statusId,
      status: st?.nome || null,
      categoria: st?.categoria || 'aberta',
      motivo_cancelamento: qual === 'cancelada' ? String(b.motivo_cancelamento || '').trim() : null,
    }).eq('id', id)
    if (error) return NextResponse.json({ erro: 'Não consegui salvar: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status: st?.nome || null })
  }

  // --- atualizar o valor de tabela de um procedimento ------------------------
  // v48.86 — Quando o cirurgião escolhe uma cirurgia sem valor cadastrado, a
  // página pergunta o valor e, se ele topar, esse valor vira o de tabela daqui
  // pra frente — assim a próxima vez que alguém lançar essa cirurgia já vem
  // preenchido, sem precisar voltar no CRM.
  if (b.acao === 'atualizar_valor_procedimento') {
    const id = String(b.procedimento_id || '')
    const valor = Number(b.valor_equipe)
    if (!id || !Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ erro: 'Valor inválido.' }, { status: 400 })
    }
    const { error } = await admin.from('cirurgia_procedimentos').update({ valor_equipe: valor }).eq('id', id)
    if (error) return NextResponse.json({ erro: 'Não consegui salvar: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // --- medicações e suspensão -------------------------------------------
  // v48.106 — Item #3 do combinado: a mesma tela de medicações e suspensão
  // que o CRM tem (MedicamentosCirurgia.tsx), agora também no link do
  // cirurgião — mesmas ações, mesma tabela (cirurgia_medicamentos), só
  // passando pelo token em vez do login por Supabase Auth. Uma vez aprovado
  // (a secretaria gerou o documento de suspensão), a linha trava aqui do
  // mesmo jeito que trava no CRM.
  //
  // v48.148 — Pedido do Jorge: um botão para o PRÓPRIO cirurgião aprovar o
  // plano de suspensão (ver ação medicamentos_aprovar, abaixo) — separado do
  // status 'aprovado' de cada remédio (que é travado pela secretaria ao
  // gerar o PDF). Qualquer mutação aqui que dê certo (adicionar/remover/
  // editar/re-consultar) derruba essa aprovação: se algo mudou, o cirurgião
  // precisa aprovar de novo.
  const derrubarAprovacaoSuspensao = (cirurgiaId: string) =>
    admin.from('cirurgias')
      .update({ suspensao_medicamentos_aprovada: false, suspensao_medicamentos_aprovada_em: null })
      .eq('id', cirurgiaId)

  // v48.154 — Pedido do Jorge: "não precisamos de Medicações em uso porque
  // temos Medicações e suspensão" — o campo de texto livre (cirurgias.medicacoes)
  // saiu da tela do CRM (CirurgiaModal.tsx). MAS esse mesmo campo é o que a
  // Google Agenda usa hoje para mostrar "MEDICAÇÕES EM USO: ..." na descrição
  // do evento (workflow n8n "CRM - Cirurgia -> Google Agenda") — importante
  // no dia da cirurgia, pedido explícito do Jorge. Em vez de mexer no n8n,
  // mantemos cirurgias.medicacoes sincronizado sozinho a partir da lista
  // estruturada, toda vez que ela muda (só os nomes, como já era o texto livre).
  const sincronizarMedicacoesTexto = async (cirurgiaId: string) => {
    const { data: meds } = await admin.from('cirurgia_medicamentos')
      .select('nome_informado').eq('cirurgia_id', cirurgiaId).order('criado_em')
    const texto = (meds || []).map((m: any) => String(m.nome_informado || '').trim()).filter(Boolean).join(', ')
    await admin.from('cirurgias').update({ medicacoes: texto || null }).eq('id', cirurgiaId)
  }

  if (b.acao === 'medicamentos_listar') {
    const cirurgiaId = String(b.cirurgia_id || '')
    if (!cirurgiaId) return NextResponse.json({ erro: 'Cirurgia não informada.' }, { status: 400 })
    const { data, error } = await admin.from('cirurgia_medicamentos')
      .select('*').eq('cirurgia_id', cirurgiaId).order('criado_em')
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    const { data: c } = await admin.from('cirurgias')
      .select('medicacoes, suspensao_medicamentos_aprovada, suspensao_medicamentos_aprovada_em')
      .eq('id', cirurgiaId).maybeSingle()
    return NextResponse.json({
      medicamentos: data || [],
      medicacoesTextoLivre: c?.medicacoes || '',
      suspensaoAprovada: !!c?.suspensao_medicamentos_aprovada,
      suspensaoAprovadaEm: c?.suspensao_medicamentos_aprovada_em || null,
    })
  }

  // --- o cirurgião aprova o plano de suspensão --------------------------
  // v48.148 — Pedido do Jorge, verbatim: "TEMOS QUE TER UM BOTÃO APROVAR E
  // FICAR SINALIZADO NO CRM QUE O MÉDICO APROVOU A SUSPENSÃO DE REMÉDIOS".
  // Mesma validação da geração do PDF (documento/route.ts,
  // medicamentosVazio/medicamentosPendentes), adaptada para uma consulta
  // direta aqui — não é a mesma coisa: aqui é só o cirurgião confirmando ANTES
  // de a secretaria gerar o documento.
  if (b.acao === 'medicamentos_aprovar') {
    const cirurgiaId = String(b.cirurgia_id || '')
    if (!cirurgiaId) return NextResponse.json({ erro: 'Cirurgia não informada.' }, { status: 400 })
    const { data: meds, error } = await admin.from('cirurgia_medicamentos')
      .select('prazo_suspensao_dias, explicacao_paciente').eq('cirurgia_id', cirurgiaId)
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    if (!meds?.length) return NextResponse.json({ erro: 'Não há medicações cadastradas para esta cirurgia. Adicione ao menos uma antes de aprovar.' }, { status: 400 })
    const pendentes = meds.filter((m: any) => m.prazo_suspensao_dias == null || !String(m.explicacao_paciente || '').trim()).length
    if (pendentes > 0) return NextResponse.json({ erro: `${pendentes} medicação(ões) ainda sem prazo/orientação definidos. Revise antes de aprovar.` }, { status: 400 })

    const agora = new Date().toISOString()
    const { error: err2 } = await admin.from('cirurgias')
      .update({ suspensao_medicamentos_aprovada: true, suspensao_medicamentos_aprovada_em: agora })
      .eq('id', cirurgiaId)
    if (err2) return NextResponse.json({ erro: 'Não consegui salvar: ' + err2.message }, { status: 500 })
    return NextResponse.json({ suspensaoAprovada: true, suspensaoAprovadaEm: agora })
  }

  if (b.acao === 'medicamentos_importar_texto') {
    const cirurgiaId = String(b.cirurgia_id || '')
    if (!cirurgiaId) return NextResponse.json({ erro: 'Cirurgia não informada.' }, { status: 400 })
    const { data: c } = await admin.from('cirurgias').select('medicacoes').eq('id', cirurgiaId).maybeSingle()
    const linhas = String(c?.medicacoes || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean)
    if (!linhas.length) return NextResponse.json({ erro: 'Não há medicações em texto livre para importar.' }, { status: 400 })
    const { data: existentes } = await admin.from('cirurgia_medicamentos').select('nome_informado').eq('cirurgia_id', cirurgiaId)
    const jaTem = new Set((existentes || []).map((x: any) => String(x.nome_informado).trim().toLowerCase()))
    const novas = linhas.filter(l => !jaTem.has(l.toLowerCase())).map(nome_informado => ({ cirurgia_id: cirurgiaId, nome_informado, status: 'pendente' }))
    if (!novas.length) return NextResponse.json({ importados: 0 })
    const { data, error } = await admin.from('cirurgia_medicamentos').insert(novas).select('*')
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    await derrubarAprovacaoSuspensao(cirurgiaId)
    await sincronizarMedicacoesTexto(cirurgiaId)
    return NextResponse.json({ importados: data?.length || 0, medicamentos: data })
  }

  if (b.acao === 'medicamentos_adicionar') {
    const cirurgiaId = String(b.cirurgia_id || '')
    const nome = String(b.nome || '').trim()
    if (!cirurgiaId) return NextResponse.json({ erro: 'Cirurgia não informada.' }, { status: 400 })
    if (!nome) return NextResponse.json({ erro: 'Nome do medicamento é obrigatório.' }, { status: 400 })
    const { data, error } = await admin.from('cirurgia_medicamentos')
      .insert({ cirurgia_id: cirurgiaId, nome_informado: nome, status: 'pendente' }).select('*').single()
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    await derrubarAprovacaoSuspensao(cirurgiaId)
    await sincronizarMedicacoesTexto(cirurgiaId)
    return NextResponse.json({ medicamento: data })
  }

  if (b.acao === 'medicamentos_editar') {
    const cirurgiaId = String(b.cirurgia_id || '')
    const id = String(b.id || '')
    if (!cirurgiaId || !id) return NextResponse.json({ erro: 'Medicamento não informado.' }, { status: 400 })
    const { data: atual } = await admin.from('cirurgia_medicamentos').select('*').eq('id', id).eq('cirurgia_id', cirurgiaId).maybeSingle()
    if (!atual) return NextResponse.json({ erro: 'Medicamento não encontrado.' }, { status: 404 })
    if (atual.status === 'aprovado') return NextResponse.json({ erro: 'Medicamento já aprovado — não é mais possível editar.' }, { status: 400 })

    const dados: any = {}
    if ('nome_informado' in b) dados.nome_informado = String(b.nome_informado || '').trim()
    if ('prazo_suspensao_dias' in b) dados.prazo_suspensao_dias = b.prazo_suspensao_dias === '' || b.prazo_suspensao_dias == null ? null : Number(b.prazo_suspensao_dias)
    if ('explicacao_paciente' in b) dados.explicacao_paciente = b.explicacao_paciente?.trim() || null
    if ('prazo_suspensao_dias' in b || 'explicacao_paciente' in b) {
      dados.fonte = 'manual'
      dados.fonte_detalhe = 'Editado manualmente pelo cirurgião'
      dados.status = dados.prazo_suspensao_dias != null && dados.explicacao_paciente ? 'manual' : 'pendente'
    }
    const { data, error } = await admin.from('cirurgia_medicamentos').update(dados).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    await derrubarAprovacaoSuspensao(cirurgiaId)
    if ('nome_informado' in dados) await sincronizarMedicacoesTexto(cirurgiaId)
    return NextResponse.json({ medicamento: data })
  }

  if (b.acao === 'medicamentos_remover') {
    const cirurgiaId = String(b.cirurgia_id || '')
    const id = String(b.id || '')
    if (!cirurgiaId || !id) return NextResponse.json({ erro: 'Medicamento não informado.' }, { status: 400 })
    const { error } = await admin.from('cirurgia_medicamentos').delete().eq('id', id).eq('cirurgia_id', cirurgiaId).neq('status', 'aprovado')
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    await derrubarAprovacaoSuspensao(cirurgiaId)
    await sincronizarMedicacoesTexto(cirurgiaId)
    return NextResponse.json({ ok: true })
  }

  // v48.144 — Autocomplete ao digitar o nome do medicamento (catálogo do
  // PausaMed + o que a própria clínica já pesquisou antes), pedido do Jorge
  // depois do caso "MOUJARO" (typo que a IA não pegou). Ver
  // sugerirMedicamentos() em lib/pausamed.ts.
  if (b.acao === 'medicamentos_sugestoes') {
    const termo = String(b.termo || '').trim()
    if (termo.length < 2) return NextResponse.json({ medicamentos: [] })
    const sugestoes = await sugerirMedicamentos(termo)
    return NextResponse.json({ medicamentos: sugestoes })
  }

  if (b.acao === 'medicamentos_consultar') {
    const cirurgiaId = String(b.cirurgia_id || '')
    const id = String(b.id || '')
    if (!cirurgiaId || !id) return NextResponse.json({ erro: 'Medicamento não informado.' }, { status: 400 })
    const { data: med } = await admin.from('cirurgia_medicamentos').select('*').eq('id', id).eq('cirurgia_id', cirurgiaId).maybeSingle()
    if (!med) return NextResponse.json({ erro: 'Medicamento não encontrado.' }, { status: 404 })
    if (med.status === 'aprovado') return NextResponse.json({ erro: 'Medicamento já aprovado.' }, { status: 400 })
    const { data: c } = await admin.from('cirurgias').select('hospital').eq('id', cirurgiaId).maybeSingle()
    const regra = await resolverMedicamento({ nomeInformado: med.nome_informado, hospitalNome: c?.hospital || null })
    if (regra.erro && !regra.encontrado) return NextResponse.json({ erro: regra.erro }, { status: 502 })
    const dados: any = regra.encontrado ? {
      principio_ativo: regra.principioAtivo,
      nomes_comerciais: regra.nomesComerciais,
      prazo_suspensao_dias: regra.prazoSuspensaoDias,
      explicacao_paciente: regra.explicacaoPaciente,
      clinical_notes: regra.clinicalNotes,
      fonte: regra.fonte,
      fonte_detalhe: regra.fonteDetalhe,
      fonte_referencia: regra.fonteReferencia,
      status: regra.prazoSuspensaoDias != null ? 'resolvido' : 'pendente',
    } : { fonte: null, fonte_detalhe: null, status: 'pendente' }
    const { data: salvo, error } = await admin.from('cirurgia_medicamentos').update(dados).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    await derrubarAprovacaoSuspensao(cirurgiaId)
    return NextResponse.json({ medicamento: salvo, encontrado: regra.encontrado })
  }

  // --- salvar a cirurgia ----------------------------------------------------
  if (b.acao === 'salvar') {
    const equipeId = String(b.cirurgiao_id || '')
    if (!equipeId) return NextResponse.json({ erro: 'Escolha o cirurgião.' }, { status: 400 })
    const { data: medico } = await admin.from('cirurgia_equipe').select('id, nome_curto').eq('id', equipeId).maybeSingle()
    if (!medico) return NextResponse.json({ erro: 'Cirurgião não encontrado.' }, { status: 400 })

    const qual = b.situacao === 'agendar' ? 'agendar' : b.situacao === 'cancelada' ? 'cancelada' : 'preop'
    const statusId = cfg[`status_${qual}`] || null
    const { data: st } = statusId
      ? await admin.from('cirurgia_status').select('nome, categoria').eq('id', statusId).maybeSingle()
      : { data: null as any }

    if (qual === 'cancelada' && !String(b.motivo_cancelamento || '').trim()) {
      return NextResponse.json({ erro: 'Escreva o motivo do cancelamento.' }, { status: 400 })
    }

    const proc = Array.isArray(b.procedimentos) ? b.procedimentos.filter((p: any) => p?.procedimento_id) : []
    const corpo: any = {
      contact_id: b.contact_id || null,
      paciente_nome: String(b.paciente_nome || '').trim(),
      paciente_telefone: String(b.paciente_telefone || '').replace(/[^0-9]/g, '') || null,
      cirurgiao_id: medico.id,
      cirurgiao: medico.nome_curto,
      data_cirurgia: b.data_cirurgia || null,
      hora: b.hora || null,
      hospital: b.hospital || null,
      hospital_estado: b.hospital_estado || null,
      hospital_cidade: b.hospital_cidade || null,
      hospital_pausamed_id: b.hospital_pausamed_id || null,
      modalidade: b.modalidade || null,
      convenio_id: b.convenio_id || null,
      convenio: b.convenio || null,
      via_acesso: b.via_acesso || null,
      medicacoes: String(b.medicacoes || '').trim() || null,
      observacao: String(b.observacao || '').trim() || null,
      composicao_equipe: String(b.composicao_equipe || '').trim() || null,
      status_id: statusId,
      status: st?.nome || null,
      categoria: st?.categoria || 'aberta',
      motivo_cancelamento: qual === 'cancelada' ? String(b.motivo_cancelamento || '').trim() : null,
      procedimento_id: proc[0]?.procedimento_id || null,
      procedimento_sigla: proc.map((p: any) => p.sigla).filter(Boolean).join(', ') || null,
      procedimento_nome: proc.map((p: any) => p.nome).filter(Boolean).join(' + ') || null,
      // v48.100 — O material que ele já escolheu na tela, por lista (uma por
      // procedimento). Guardado como veio: quem confere se as listas ainda
      // existem e ainda valem é a solicitação, na hora de montar o texto.
      material_listas_ids: Array.isArray(b.materiais)
        ? Array.from(new Set(b.materiais.filter((x: any) => typeof x === 'string' && x))) : [],
    }

    // v48.81 — O valor combinado, quando o cirurgião quiser adiantar.
    //
    // Entra como valor DIGITADO À MÃO, e não calculado: é acordo com o
    // paciente, e o cálculo do CRM não pode passar por cima dele depois. Em
    // branco, o campo nem é tocado — a secretária segue com o orçamento de
    // tabela, como sempre.
    const valor = b.valor_cobrado === '' || b.valor_cobrado === null || b.valor_cobrado === undefined
      ? null : Number(b.valor_cobrado)
    if (valor !== null && Number.isFinite(valor) && valor > 0) {
      corpo.valor_cobrado = valor
      corpo.valor_cobrado_manual = true
    }
    if (!corpo.paciente_nome) return NextResponse.json({ erro: 'Informe o paciente.' }, { status: 400 })

    let id = String(b.id || '')
    if (id) {
      const { error } = await admin.from('cirurgias').update(corpo).eq('id', id)
      if (error) return NextResponse.json({ erro: 'Não consegui salvar: ' + error.message }, { status: 500 })
    } else {
      const { data: criada, error } = await admin.from('cirurgias').insert({
        ...corpo,
        origem: 'cirurgiao',
        lancada_por: medico.nome_curto,
      }).select('id').single()
      if (error) return NextResponse.json({ erro: 'Não consegui salvar: ' + error.message }, { status: 500 })
      id = criada.id
    }

    // Os procedimentos como itens, para a conta das conjugadas e as cartas.
    await admin.from('cirurgia_itens').delete().eq('cirurgia_id', id)
    if (proc.length) {
      await admin.from('cirurgia_itens').insert(proc.map((p: any, i: number) => ({
        cirurgia_id: id, procedimento_id: p.procedimento_id,
        sigla: p.sigla || '', nome: p.nome || '',
        valor_equipe: p.valor_equipe || 0, valor_anestesista: p.valor_anestesista || 0,
        via_acesso: b.via_acesso || null, ordem: i,
      })))
    }

    return NextResponse.json({ ok: true, id })
  }

  return NextResponse.json({ erro: 'Ação inválida.' }, { status: 400 })
}
