import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  COLUNAS, TOTAL_COLUNAS, COLUNAS_DO_CRM, texto, paraData, paraDataHora, paraHora,
  paraNumero, paraInteiro, paraMarcado, lerEquipe, dataBr, moedaBr,
} from '@/lib/planilhaCirurgia'
import { separarSiglas } from '@/lib/itensCirurgia'

// v48.08 — Sincronização com a planilha CIRURGIAS OBESITY.
//
// Uma chamada só, das duas direções. O n8n manda TUDO o que está na planilha e
// recebe de volta o que a planilha deveria mostrar. Isso é melhor do que duas
// rotas separadas por um motivo prático: a reconciliação inteira acontece num
// único instante, com os dois lados na mão. Em duas chamadas, uma linha criada
// entre elas escaparia.
//
// A regra, combinada com a clínica:
//
//   O CRM é o dono. Linha da planilha que o CRM ainda não conhece é ADOTADA
//   (nasce no CRM). Linha que o CRM já conhece é IGNORADA na entrada — o que
//   está no CRM prevalece e volta por cima.
//
//   A linha nunca muda de aba. A contabilidade lê a aba CIRURGIAS, então
//   realizada e cancelada continuam lá, com a situação dizendo o que houve.

export const runtime = 'nodejs'
export const maxDuration = 60

type LinhaPlanilha = { aba?: string; linha?: number; valores: any[] }

function categoriaDaAba(aba?: string) {
  const a = (aba || '').toUpperCase()
  if (a.includes('REALIZADA')) return 'realizada'
  if (a.includes('CANCELADA')) return 'cancelada'
  return 'aberta'
}

export async function POST(req: NextRequest) {
  const inicio = Date.now()

  // Autenticação por chave compartilhada, definida no EasyPanel. Sem ela a rota
  // não responde: é um endereço que escreve no banco da clínica.
  const esperado = process.env.CIRURGIA_SYNC_TOKEN || ''
  if (!esperado) {
    return NextResponse.json({
      erro: 'Sincronização não configurada. Defina a variável CIRURGIA_SYNC_TOKEN no EasyPanel.',
    }, { status: 503 })
  }
  const recebido = req.headers.get('x-sync-token') || ''
  if (recebido !== esperado) {
    return NextResponse.json({ erro: 'Chave de sincronização inválida.' }, { status: 401 })
  }

  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const linhas: LinhaPlanilha[] = Array.isArray(body.linhas) ? body.linhas : []

  // Dois modos, e o padrão é o cauteloso.
  //
  //   'importar' — só traz da planilha para o CRM e responde com os números.
  //                Nada é escrito na planilha. É assim que a carga inicial deve
  //                rodar: primeiro você confere no CRM se as cirurgias chegaram
  //                certas, comparando com a planilha que continua intacta.
  //
  //   'completo' — depois de conferido, também devolve o que a planilha deve
  //                mostrar, para o n8n escrever de volta.
  //
  // O padrão é 'importar' de propósito: um erro de mapeamento no modo completo
  // escreveria por cima da planilha que alimenta a contabilidade.
  const modo = body.modo === 'completo' ? 'completo' : 'importar'

  const erros: any[] = []
  let criadas = 0, ignoradas = 0, marcadasParaApagar = 0

  // Linhas que a planilha ainda tem e o CRM já apagou de propósito. Vão de
  // volta para o n8n apagar. Ver o bloco das exclusões, mais abaixo.
  const remover: { aba: string; linha: number; nome: string; crm_id: string | null }[] = []

  // Catálogos, buscados uma vez. Dentro do laço seria uma consulta por linha.
  const [{ data: procs }, { data: equipe }, { data: hospitais }, { data: statusList }] = await Promise.all([
    admin.from('cirurgia_procedimentos').select('id, sigla, nome, valor_equipe, valor_anestesista'),
    admin.from('cirurgia_equipe').select('id, nome_curto'),
    admin.from('cirurgia_hospitais').select('id, nome'),
    admin.from('cirurgia_status').select('id, nome, categoria'),
  ])
  const achaProc = (s: string) => (procs ?? []).find(p => p.sigla.toLowerCase() === s.toLowerCase())
  const achaPessoa = (s: string) => (equipe ?? []).find(p => p.nome_curto.toLowerCase() === s.toLowerCase())
  const achaHosp = (s: string) => (hospitais ?? []).find(h => h.nome.toLowerCase() === s.toLowerCase())
  const achaStatus = (s: string) => (statusList ?? []).find(x => x.nome.toLowerCase() === s.toLowerCase())

  // Quem o CRM já conhece. Comparado por id da planilha e, para as linhas
  // antigas que ainda não têm id, por nome + data — que é o par que identifica
  // uma cirurgia na prática.
  const { data: existentes } = await admin.from('cirurgias')
    .select('id, planilha_uuid, paciente_nome, data_cirurgia, planilha_aba, planilha_linha')
  const porUuid = new Map((existentes ?? []).filter(c => c.planilha_uuid).map(c => [c.planilha_uuid, c.id]))
  const chaveNomeData = (n: string, d: string | null) => `${(n || '').trim().toLowerCase()}|${d || ''}`
  const porNomeData = new Map((existentes ?? []).map(c => [chaveNomeData(c.paciente_nome, c.data_cirurgia), c.id]))
  const ondeEstava = new Map((existentes ?? []).map(c => [c.id, { aba: c.planilha_aba, linha: c.planilha_linha }]))

  // v48.25 — Cirurgia apagada no CRM não pode voltar da planilha.
  //
  // Era o que acontecia: a linha continuava lá, o CRM não a reconhecia mais e
  // adotava de novo, na sincronização seguinte. Quem apagou via a cirurgia
  // ressuscitar sem entender por quê.
  //
  // Agora toda exclusão deixa registro (gatilho na tabela cirurgias), e a
  // sincronização lê esse registro para duas coisas: não adotar de novo, e
  // mandar o n8n apagar a linha da planilha.
  const { data: excluidas } = await admin.from('cirurgia_exclusoes')
    .select('id, cirurgia_id, paciente_nome, data_cirurgia')
    .eq('ativo', true)
  const excluidasPorId = new Map((excluidas ?? []).map(e => [e.cirurgia_id, e]))
  const excluidasPorNomeData = new Map(
    (excluidas ?? []).map(e => [chaveNomeData(e.paciente_nome || '', e.data_cirurgia), e]))
  const exclusoesUsadas = new Set<string>()

  for (const item of linhas) {
    const v = item.valores || []
    const nome = texto(v[COLUNAS.nome])
    if (!nome) { ignoradas++; continue }   // linha em branco no meio da planilha

    const dataCir = paraData(v[COLUNAS.data])
    const idPlanilha = texto(v[COLUNAS.crmId])

    // Apagada de propósito no CRM: a linha da planilha vai embora junto. Isso
    // vem ANTES de tudo, senão a linha seria adotada de novo aqui mesmo.
    const exclusao = (idPlanilha ? excluidasPorId.get(idPlanilha) : null)
      || excluidasPorNomeData.get(chaveNomeData(nome, dataCir))
    if (exclusao) {
      if (item.aba && item.linha) {
        remover.push({ aba: item.aba, linha: item.linha, nome, crm_id: idPlanilha || null })
        exclusoesUsadas.add(exclusao.id)
        marcadasParaApagar++
      }
      ignoradas++
      continue
    }

    // Já conhecida: o CRM manda, então nada entra. A resposta vai devolver o
    // valor do CRM por cima do que estiver lá.
    const jaConhecida = (idPlanilha && porUuid.get(idPlanilha)) || porNomeData.get(chaveNomeData(nome, dataCir))
    if (jaConhecida) {
      // A linha se move quando alguém insere ou apaga algo acima dela. Corrigir
      // a posição a cada leitura é o que mantém a escrita de volta mirando a
      // linha certa — antes disso, o número guardado envelhecia em silêncio.
      const antes = ondeEstava.get(jaConhecida as string)
      if (item.aba && item.linha && (antes?.aba !== item.aba || antes?.linha !== item.linha)) {
        await admin.from('cirurgias')
          .update({ planilha_aba: item.aba, planilha_linha: item.linha })
          .eq('id', jaConhecida)
        ondeEstava.set(jaConhecida as string, { aba: item.aba, linha: item.linha })
      }
      ignoradas++
      continue
    }

    // A coluna CIRURGIA às vezes traz mais de um procedimento na mesma célula:
    // "BP, HH, BX HEPÁTICA". Nesse caso casamos o PRIMEIRO que o cadastro
    // reconhece — é ele que manda no valor — e guardamos o texto inteiro, para
    // ninguém perder de vista que houve mais de um.
    const sigla = texto(v[COLUNAS.cirurgia])
    const proc = sigla
      ? (achaProc(sigla) || sigla.split(/[,;+/]/).map(x => achaProc(x.trim())).find(Boolean) || null)
      : null
    const nomeCirurgiao = texto(v[COLUNAS.cirurgiao])
    const pessoa = nomeCirurgiao ? achaPessoa(nomeCirurgiao) : null
    const nomeHospital = texto(v[COLUNAS.hospital])
    const hosp = nomeHospital ? achaHosp(nomeHospital) : null
    const nomeStatus = texto(v[COLUNAS.situacao])
    const st = nomeStatus ? achaStatus(nomeStatus) : null
    const eq = lerEquipe(v[COLUNAS.equipe])

    // O paciente é procurado no cadastro do CRM pelo telefone e, em seguida,
    // pelo nome exato. Não é criado contato aqui: inventar cadastro a partir de
    // texto de planilha é como se enche uma base de duplicados.
    const telefone = texto(v[COLUNAS.telefone]).replace(/\D/g, '')
    let contactId: string | null = null
    if (telefone.length >= 10) {
      const { data } = await admin.from('contacts').select('id').ilike('phone', `%${telefone.slice(-8)}`).limit(1)
      contactId = data?.[0]?.id ?? null
    }
    if (!contactId) {
      const { data } = await admin.from('contacts').select('id').ilike('full_name', nome).limit(1)
      contactId = data?.[0]?.id ?? null
    }

    const registro: any = {
      contact_id: contactId,
      paciente_nome: nome,
      paciente_telefone: texto(v[COLUNAS.telefone]) || null,
      data_cirurgia: dataCir,
      hora: paraHora(v[COLUNAS.hora]),
      procedimento_id: proc?.id ?? null,
      procedimento_sigla: sigla || null,
      procedimento_nome: proc?.nome ?? null,
      hospital_id: hosp?.id ?? null,
      hospital: nomeHospital || null,
      cirurgiao_id: pessoa?.id ?? null,
      cirurgiao: nomeCirurgiao || null,
      composicao_equipe: texto(v[COLUNAS.equipe]) || null,
      equipe_auxiliares: eq.auxiliares,
      equipe_instrumentadores: eq.instrumentadores,
      tem_anestesista: eq.temAnestesista,
      modalidade: texto(v[COLUNAS.condicao]) || null,
      status_id: st?.id ?? null,
      status: nomeStatus || 'AGENDAR',
      // Rede de proteção: se a situação escrita na planilha não existir no
      // cadastro do CRM, a aba de origem decide a categoria. Sem isso, uma
      // cirurgia realizada com a situação grafada de outro jeito cairia na
      // lista de "em andamento" e ficaria lá para sempre.
      categoria: st?.categoria ?? categoriaDaAba(item.aba),
      ajuste_valor: paraNumero(v[COLUNAS.ajuste]) ?? 0,
      valor_previa: paraNumero(v[COLUNAS.valorPrevia]),
      valor_cobrado: paraNumero(v[COLUNAS.valorCobrado]),
      // Valor que veio da planilha é valor acordado, não calculado. Marcar como
      // manual impede que o recálculo do CRM passe por cima de um acordo antigo.
      valor_previa_manual: paraNumero(v[COLUNAS.valorPrevia]) !== null,
      valor_cobrado_manual: paraNumero(v[COLUNAS.valorCobrado]) !== null,
      forma_pagamento: texto(v[COLUNAS.formaPagamento]) || null,
      parcelas: paraInteiro(v[COLUNAS.parcelas]),
      pago: paraMarcado(v[COLUNAS.pago]),
      observacao: texto(v[COLUNAS.observacao]) || null,
      medicacoes: texto(v[COLUNAS.medicacoes]) || null,
      documentos: texto(v[COLUNAS.documentos]) || null,
      data_pre_operatorio: paraData(v[COLUNAS.dataPreop]),
      data_solicitado_hospital: paraData(v[COLUNAS.dataSolicitado]),
      data_autorizacao: paraData(v[COLUNAS.dataAutorizacao]),
      msg_preop_enviada_em: paraMarcado(v[COLUNAS.msgPreop]) ? new Date().toISOString() : null,
      agenda_evento_id: texto(v[COLUNAS.logAgenda]) || null,
      carimbo_origem: paraDataHora(v[COLUNAS.carimbo]),
      planilha_aba: item.aba || null,
      planilha_linha: item.linha ?? null,
      sincronizado_em: new Date().toISOString(),
    }

    const { data: nova, error } = await admin.from('cirurgias').insert(registro).select('id').single()
    if (error || !nova) {
      erros.push({ linha: item.linha, nome, erro: error?.message || 'falha ao inserir' })
      continue
    }
    // O id do CRM é gravado como id da planilha também: a partir daqui as duas
    // pontas se reconhecem sem depender do número da linha.
    await admin.from('cirurgias').update({ planilha_uuid: nova.id }).eq('id', nova.id)

    // v48.25 — "BP, HH, BX HEPÁTICA" numa célula vira três itens. Cada sigla
    // que o cadastro reconhece entra com os valores dela; a que não reconhece
    // entra como texto, para não sumir da vista de quem for conferir.
    const partes = separarSiglas(sigla)
    const reconhecidos = (partes.length ? partes : (sigla ? [sigla] : [])).map(s => ({ s, achado: achaProc(s) }))

    // Cada linha guarda o valor CHEIO do procedimento, como na tabela. A regra
    // das conjugadas é aplicada na hora de calcular o cobrado — igual à
    // planilha, que também guarda os valores cheios em DADOS CARTAS. O total
    // combinado que veio da planilha continua intocado em valor_cobrado.
    const itens = reconhecidos.map((r, k) => ({
      cirurgia_id: nova.id,
      procedimento_id: r.achado?.id ?? null,
      sigla: r.s,
      nome: r.achado?.nome ?? null,
      valor_equipe: Number(r.achado?.valor_equipe ?? 0),
      valor_anestesista: Number(r.achado?.valor_anestesista ?? 0),
      valor_manual: false,
      ordem: k + 1,
    }))
    if (itens.length > 0) await admin.from('cirurgia_itens').insert(itens)

    porUuid.set(nova.id, nova.id)
    porNomeData.set(chaveNomeData(nome, dataCir), nova.id)
    criadas++
  }

  // --- volta: o que a planilha deve mostrar ---------------------------------
  if (modo === 'importar') {
    await admin.from('cirurgia_sync_log').insert({
      direcao: 'importar',
      recebidas: linhas.length,
      criadas, ignoradas, devolvidas: 0,
      erros: erros.length ? erros : null,
      duracao_ms: Date.now() - inicio,
    })
    // No modo de conferência a lista de exclusões vai junto, mas como aviso: o
    // n8n não escreve nada aqui. Serve para ver o que SERIA apagado.
    return NextResponse.json({
      ok: true, modo, recebidas: linhas.length, criadas, ignoradas,
      devolvidas: 0, erros, linhas: [],
      remover: [], a_apagar: marcadasParaApagar, previa_do_que_seria_apagado: remover,
    })
  }

  const { data: todas } = await admin.from('cirurgias')
    .select('*').order('data_cirurgia', { ascending: true, nullsFirst: false })

  // Só volta para a aba CIRURGIAS o que pertence a ela: as que vieram de lá e as
  // que nasceram no CRM. As importadas de REALIZADAS e CANCELADAS ficam onde
  // estão — o número da linha delas é de OUTRA aba, e escrever por esse número
  // na CIRURGIAS sobrescreveria a linha errada, em silêncio.
  const paraPlanilha = (todas ?? []).filter(c =>
    !c.planilha_aba || String(c.planilha_aba).toUpperCase() === 'CIRURGIAS')

  const devolver = paraPlanilha.map(c => {
    const valores = new Array(TOTAL_COLUNAS).fill('')
    valores[COLUNAS.nome] = c.paciente_nome || ''
    valores[COLUNAS.telefone] = c.paciente_telefone || ''
    valores[COLUNAS.data] = dataBr(c.data_cirurgia)
    valores[COLUNAS.hora] = (c.hora || '').slice(0, 5)
    valores[COLUNAS.situacao] = c.status || ''
    valores[COLUNAS.condicao] = c.modalidade || ''
    valores[COLUNAS.cirurgia] = c.procedimento_sigla || ''
    valores[COLUNAS.hospital] = c.hospital || ''
    valores[COLUNAS.cirurgiao] = c.cirurgiao || ''
    valores[COLUNAS.equipe] = c.composicao_equipe || ''
    valores[COLUNAS.ajuste] = c.ajuste_valor ? moedaBr(Number(c.ajuste_valor)) : ''
    valores[COLUNAS.msgPreop] = c.msg_preop_enviada_em ? '✔️' : ''
    valores[COLUNAS.documentos] = c.documentos || ''
    valores[COLUNAS.observacao] = c.observacao || ''
    valores[COLUNAS.dataPreop] = dataBr(c.data_pre_operatorio)
    valores[COLUNAS.dataSolicitado] = dataBr(c.data_solicitado_hospital)
    valores[COLUNAS.dataAutorizacao] = dataBr(c.data_autorizacao)
    valores[COLUNAS.logAgenda] = c.agenda_evento_id || ''
    valores[COLUNAS.medicacoes] = c.medicacoes || ''
    valores[COLUNAS.valorPrevia] = moedaBr(c.valor_previa)
    valores[COLUNAS.valorCobrado] = moedaBr(c.valor_cobrado)
    valores[COLUNAS.formaPagamento] = c.forma_pagamento || ''
    valores[COLUNAS.parcelas] = c.parcelas ?? ''
    valores[COLUNAS.pago] = c.pago ? '✔️' : ''
    valores[COLUNAS.crmId] = c.id
    // O carimbo só é preenchido em cirurgia que nasceu no CRM e ainda não tem
    // linha na planilha. Nas que vieram de lá, o carimbo original manda — e a
    // coluna nem entra na lista de colunas do CRM, então nunca é sobrescrita.
    const nova = !c.planilha_linha
    if (nova) valores[COLUNAS.carimbo] = dataBr(String(c.created_at).slice(0, 10))
    return { crm_id: c.id, linha: c.planilha_linha ?? null, nova, valores }
  })

  // Carimbo nas exclusões que estão indo para a planilha agora. O registro
  // continua ativo: se a escrita falhar, a linha reaparece na leitura seguinte e
  // é mandada apagar de novo. Carimbar e desligar seria pior — a cirurgia
  // voltaria e ninguém saberia.
  if (exclusoesUsadas.size > 0) {
    await admin.from('cirurgia_exclusoes')
      .update({ removida_da_planilha_em: new Date().toISOString() })
      .in('id', Array.from(exclusoesUsadas))
  }

  await admin.from('cirurgia_sync_log').insert({
    direcao: 'completo',
    recebidas: linhas.length,
    criadas, ignoradas,
    devolvidas: devolver.length,
    erros: erros.length ? erros : null,
    duracao_ms: Date.now() - inicio,
  })

  return NextResponse.json({
    ok: true,
    modo,
    recebidas: linhas.length,
    criadas, ignoradas,
    devolvidas: devolver.length,
    erros,
    // Linhas que saem da planilha porque a cirurgia foi apagada no CRM. Cada
    // uma traz aba e número da linha; o n8n apaga de baixo para cima, para o
    // número da linha seguinte não mudar no meio do caminho.
    remover,
    a_apagar: remover.length,
    // As colunas que o CRM pode escrever. O n8n usa esta lista para mesclar:
    // pega o valor do CRM nestas e mantém o da planilha em todas as outras.
    colunas_do_crm: COLUNAS_DO_CRM,
    total_colunas: TOTAL_COLUNAS,
    linhas: devolver,
  })
}
