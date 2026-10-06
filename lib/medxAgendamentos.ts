import { supabase } from '@/lib/supabase'

// v48.161 — Extraído de ConversationSidePanel.tsx (aba MedX) para poder ser
// reaproveitado também na Agenda Médica, que precisa do mesmo "modalidade /
// com ou sem retorno / cobrar" por agendamento, sem duplicar a lógica (dedup,
// ordenação e correção manual de cobrança) num segundo lugar — o pedido do
// Jorge foi exatamente "já temos a função, fica fácil".
//
// O comportamento é idêntico ao que já existia: busca no MedX pelo nome/
// telefone/cpf do paciente, deduplica agendamentos repetidos, ordena do mais
// próximo para o mais distante, e aplica correções manuais de cobrança
// gravadas em agendamento_cobranca_overrides.

export type AgendamentoMedx = {
  data: string
  hora: string
  profissional: string | undefined
  profissional_id: string | undefined
  slot_id: string | undefined
  medx_agendamento_id: string
  status: string
  especialidade: string | undefined
  modalidade: string | null
  planoRetorno: 'Com retorno' | 'Sem retorno'
  cobranca: 'COBRAR' | 'NÃO COBRAR'
  cobrancaJustificativa?: string
  cobrancaAlteradoPor?: string
  cobrancaAlteradoEm?: string
  // v48.166 — correção manual de "Com/Sem retorno" (mesmo padrão da cobrança),
  // pros casos em que o que vem do MedX/CRM também sai errado (ver nota abaixo).
  retornoJustificativa?: string
  retornoAlteradoPor?: string
  retornoAlteradoEm?: string
}

export async function buscarAgendamentosMedx(params: { nome?: string | null; telefone?: string | null; cpf?: string | null }): Promise<{
  paciente: any
  agendamentosRaw: any[]
  agendamentos: AgendamentoMedx[]
}> {
  const res = await fetch('/api/medx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: params.nome, telefone: params.telefone, cpf: params.cpf }),
  })
  const json = await res.json()
  const pac = json.paciente
  if (json.debug) console.log('MedX debug:', json.debug)
  const aArr = Array.isArray(json.agendamentos) ? json.agendamentos : []

  let agendamentos: any[] = aArr.filter((a: any) => a && a.encontrado !== false).map((a: any) => {
    const modalidadeRaw = a.modalidade ?? a.tipo_atendimento ?? a.atendimento_modalidade
    const modalidadeRawTexto = String(modalidadeRaw ?? '')
    // v48.166 — `descricao_medx` é o texto literal que a própria equipe digita no
    // MedX (ex: "RODRIGO DE ALMEIDA GOMES, PRESENCIAL, COM RETORNO, ...") — é o
    // sinal mais confiável que existe, porque foi escrito à mão exatamente pra
    // isso (pedido do Jorge: "colocamos a palavra presencial ou on-line... na
    // descrição do agendamento justamente pra não errar com o código"). Entra
    // primeiro na lista, antes dos outros nomes de campo genéricos.
    const modalidadeDescricao = [
      a.descricao_medx,
      a.descricao,
      a.Descricao,
      a.descricao_compromisso,
      a.observacao,
    ].filter(Boolean).join(' ')
    // v48.165 — Removidos os palpites por código numérico/is_online (modalidadeRaw
    // === 1/0, a.is_online) e o "se não souber, assume PRESENCIAL": um agendamento
    // real (Rodrigo, 05/10) veio com modalidade PRESENCIAL confirmada no MedX e na
    // agenda por WhatsApp, mas esses códigos fizeram o CRM mostrar ONLINE — porque
    // o campo numérico que o MedX manda nem sempre representa online/presencial
    // (na verdade é o "tipo de consulta" interno do MedX, sem relação nenhuma com
    // modalidade — confirmado em 05/10 testando ao vivo: Rodrigo veio com
    // modalidade: "1", um código, não a palavra presencial/online). Agora só
    // confiamos em texto explícito ("presencial"/"online") no próprio campo ou na
    // descrição; sem isso, null — genuinamente desconhecido, igual ao campo manual
    // (lib/modalidadeConsulta.ts).
    const modalidade = /presencial/i.test(modalidadeRawTexto)
      ? 'PRESENCIAL'
      : /online/i.test(modalidadeRawTexto)
        ? 'ONLINE'
        : /presencial/i.test(modalidadeDescricao)
          ? 'PRESENCIAL'
          : /online/i.test(modalidadeDescricao)
            ? 'ONLINE'
            : null
    // v48.166 — Mesma lógica pro "com/sem retorno": o texto da descrição (quando
    // existir) manda mais que o campo com_retorno/retorno, que vem de uma coluna
    // interna (agendamentos.com_retorno) que também já saiu errada (Rodrigo, MedX
    // dizia "COM RETORNO" na descrição, mas essa coluna dizia "SEM RETORNO").
    const planoRaw = String(a.tem_retorno ?? a.com_retorno ?? a.retorno ?? '').trim().toUpperCase()
    const planoRetornoCampo = planoRaw === 'SIM' || planoRaw === 'TRUE' || planoRaw === '1' || (planoRaw.includes('COM RETORNO') && !planoRaw.includes('SEM RETORNO'))
      ? 'Com retorno' as const
      : 'Sem retorno' as const
    const planoRetorno = /com retorno/i.test(modalidadeDescricao) && !/sem retorno/i.test(modalidadeDescricao)
      ? 'Com retorno' as const
      : /sem retorno/i.test(modalidadeDescricao)
        ? 'Sem retorno' as const
        : planoRetornoCampo
    const cobrancaRaw = String(a.cobranca ?? '').trim().toUpperCase()
    const gratuito = a.retorno_gratuito === true || a.retorno_gratuito === 1 || a.retorno_gratuito === '1' || String(a.retorno_gratuito).toUpperCase() === 'SIM' || cobrancaRaw.includes('NÃO COBRAR') || cobrancaRaw.includes('NAO COBRAR')
    return {
      data: a.data, hora: a.hora_inicio, profissional: a.profissional, profissional_id: a.profissional_id, slot_id: a.slot_id,
      medx_agendamento_id: String(a.medx_agendamento_id ?? a.id_agendamento ?? a.Id_do_Agendamento ?? a.medx_id ?? ''),
      status: a.status || 'Agendada', especialidade: a.especialidade, modalidade, planoRetorno,
      cobranca: gratuito ? 'NÃO COBRAR' as const : 'COBRAR' as const,
    }
  })

  // O MedX (ou o fluxo que busca lá) às vezes devolve o mesmo agendamento repetido.
  {
    const porId = new Set<string>()
    const porHorario = new Map<string, any>()
    const unicos: any[] = []
    for (const a of agendamentos as any[]) {
      const id = a.medx_agendamento_id ? String(a.medx_agendamento_id) : ''
      if (id && porId.has(id)) continue

      const chaveHorario = `${a.data}|${a.hora}|${a.profissional_id || a.profissional || ''}`
      const jaVisto = porHorario.get(chaveHorario)
      if (jaVisto) {
        const pontos = (x: any) => (x.medx_agendamento_id ? 2 : 0) + (/confirm/i.test(String(x.status || '')) ? 1 : 0)
        if (pontos(a) > pontos(jaVisto)) Object.assign(jaVisto, a)
        continue
      }

      if (id) porId.add(id)
      porHorario.set(chaveHorario, a)
      unicos.push(a)
    }

    unicos.sort((a: any, b: any) => {
      const t = (x: any) => new Date(`${x.data}T${String(x.hora || '00:00').slice(0, 5)}:00`).getTime()
      const ta = t(a), tb = t(b)
      if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
      return ta - tb
    })

    agendamentos = unicos
  }

  // Correções manuais de cobrança (a Sofia/MedX às vezes classifica errado) sempre
  // prevalecem sobre o que veio calculado do MedX acima.
  const idsParaOverride = agendamentos.map((a: any) => a.medx_agendamento_id).filter(Boolean)
  if (idsParaOverride.length > 0) {
    try {
      const { data: overrides } = await supabase.from('agendamento_cobranca_overrides')
        .select('*').in('medx_agendamento_id', idsParaOverride)
      if (overrides && overrides.length > 0) {
        const porId: Record<string, any> = {}
        overrides.forEach((o: any) => { porId[o.medx_agendamento_id] = o })
        agendamentos = agendamentos.map((a: any) => {
          const o = a.medx_agendamento_id ? porId[a.medx_agendamento_id] : null
          if (!o) return a
          return {
            ...a,
            cobranca: o.cobranca,
            cobrancaJustificativa: o.justificativa || undefined,
            cobrancaAlteradoPor: o.updated_by_name || undefined,
            cobrancaAlteradoEm: o.updated_at || undefined,
          }
        })
      }
    } catch {}
  }

  // v48.166 — Mesmo esquema acima, agora pra "Com/Sem retorno": o palpite calculado
  // (texto da descrição ou, na falta dele, a coluna antiga) também pode sair errado
  // (foi o caso do Rodrigo em 05/10 — MedX dizia "COM RETORNO", o CRM mostrou "Sem
  // retorno"), então uma correção manual salva aqui sempre vence.
  if (idsParaOverride.length > 0) {
    try {
      const { data: overridesRetorno } = await supabase.from('agendamento_retorno_overrides')
        .select('*').in('medx_agendamento_id', idsParaOverride)
      if (overridesRetorno && overridesRetorno.length > 0) {
        const porId: Record<string, any> = {}
        overridesRetorno.forEach((o: any) => { porId[o.medx_agendamento_id] = o })
        agendamentos = agendamentos.map((a: any) => {
          const o = a.medx_agendamento_id ? porId[a.medx_agendamento_id] : null
          if (!o) return a
          return {
            ...a,
            planoRetorno: o.retorno,
            retornoJustificativa: o.justificativa || undefined,
            retornoAlteradoPor: o.updated_by_name || undefined,
            retornoAlteradoEm: o.updated_at || undefined,
          }
        })
      }
    } catch {}
  }

  return { paciente: pac, agendamentosRaw: aArr, agendamentos: agendamentos as AgendamentoMedx[] }
}

// v48.162 — Cache simples em memória, usado pela Agenda Médica: ela precisa
// buscar os mesmos poucos pacientes repetidamente (grade do dia + modal de
// detalhe, e de novo ao trocar de dia e voltar), e cada busca no MedX é uma
// chamada de rede de verdade (não é instantâneo). Sem isso, abrir a grade de
// um dia com 15 consultas dispararia até 15 buscas simultâneas no MedX.
// TTL curto (2 min): é só pra não repetir a MESMA busca em rajada — não é
// pensado pra ficar "desatualizado" por muito tempo.
const CACHE_TTL_MS = 2 * 60 * 1000
const cache = new Map<string, { at: number; promise: Promise<{ paciente: any; agendamentosRaw: any[]; agendamentos: AgendamentoMedx[] }> }>()

function chaveCache(params: { nome?: string | null; telefone?: string | null; cpf?: string | null }) {
  return [params.nome || '', params.telefone || '', params.cpf || ''].join('|').toLowerCase()
}

export function buscarAgendamentosMedxCached(params: { nome?: string | null; telefone?: string | null; cpf?: string | null }) {
  const chave = chaveCache(params)
  const atual = cache.get(chave)
  if (atual && Date.now() - atual.at < CACHE_TTL_MS) return atual.promise
  const promise = buscarAgendamentosMedx(params).catch(e => {
    cache.delete(chave) // não guarda falha em cache — próxima tentativa busca de novo
    throw e
  })
  cache.set(chave, { at: Date.now(), promise })
  return promise
}
