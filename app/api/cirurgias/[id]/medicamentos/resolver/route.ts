import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { resolverMedicamento } from '@/lib/pausamed'

// v48.97 — Consulta a base do PausaMed para UM medicamento da cirurgia e
// grava o resultado na linha (ainda como 'resolvido', não 'aprovado': quem
// aprova é o médico, revisando/editando antes de gerar o PDF).

export const runtime = 'nodejs'
// v48.172 — O "Erro 502" que o Jorge viu na Sinvastatina era, com grande
// chance, este limite (antes 60s) cortando a requisição ANTES da pesquisa
// por IA terminar — uma busca de verdade (agora com Google Search ao vivo,
// ver lib/pausamed.ts) mede entre ~55s e ~120s, e pode tentar 2 vezes. 300s
// cobre com folga até o pior caso de 2 tentativas. IMPORTANTE para quem for
// revisar isto depois: se o 502 persistir mesmo com este valor alto, o
// próximo lugar a checar é o timeout do PRÓPRIO proxy reverso do EasyPanel/
// Traefik na frente deste app (muitos vêm com um padrão de 60s) — este
// maxDuration só controla o limite do Next.js, não o do proxy na frente dele.
export const maxDuration = 300

async function quemEsta(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  })
  const { data: { user } } = await pub.auth.getUser(token)
  return user
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  let b: any = {}
  try { b = await req.json() } catch {}
  const id = String(b.id || '')
  if (!id) return NextResponse.json({ erro: 'Medicamento não informado.' }, { status: 400 })

  const { data: med } = await admin.from('cirurgia_medicamentos').select('*').eq('id', id).eq('cirurgia_id', params.id).maybeSingle()
  if (!med) return NextResponse.json({ erro: 'Medicamento não encontrado.' }, { status: 404 })
  if (med.status === 'aprovado') return NextResponse.json({ erro: 'Medicamento já aprovado.' }, { status: 400 })

  const { data: c } = await admin.from('cirurgias').select('hospital').eq('id', params.id).maybeSingle()

  const regra = await resolverMedicamento({ nomeInformado: med.nome_informado, hospitalNome: c?.hospital || null })
  if (regra.erro && !regra.encontrado) {
    // v48.118 — "ia_falhou" quer dizer que a pesquisa por IA nem chegou a
    // rodar (já tentou 2x — ver lib/pausamed.ts) — diferente de "não achei o
    // remédio". Mensagem específica para não parecer que o remédio é
    // desconhecido quando na verdade a busca falhou.
    // v48.172 — mensagem atualizada: o timeout de cada tentativa subiu para
    // 170s (ver lib/pausamed.ts) porque uma busca ao vivo de verdade demora
    // mais que os 45s de antes — por isso o texto agora deixa claro que pode
    // levar um pouco para a IA buscar na internet.
    const msg = regra.erro.startsWith('ia_falhou')
      ? 'A pesquisa por IA falhou agora (ela busca ao vivo na internet, o que pode levar até uns 2-3 minutos, e mesmo assim não respondeu) — tentamos 2 vezes. Toque em consultar de novo em alguns instantes.'
      : regra.erro
    return NextResponse.json({ erro: msg }, { status: 502 })
  }

  // v48.172 — "A IA achou Condroflex mas não corrigiu Coondroflex": a IA já
  // devolvia o nome corrigido, mas nada aqui aplicava a correção ao
  // cadastro — nome_informado continuava com o erro de digitação pra sempre.
  // Agora, quando a IA corrige sozinha (regra.correcaoAutomatica), o nome
  // corrigido passa a ser o nome_informado oficial — e o que a pessoa
  // realmente digitou fica guardado em nome_digitado_original (só na
  // primeira correção, para não perder o dado original se o remédio for
  // re-pesquisado depois).
  const aplicarCorrecaoNome = regra.encontrado && regra.correcaoAutomatica && regra.nomeCorrigido
    && regra.nomeCorrigido.trim().toLowerCase() !== String(med.nome_informado || '').trim().toLowerCase()

  const dados: any = regra.encontrado ? {
    ...(aplicarCorrecaoNome ? {
      nome_informado: regra.nomeCorrigido,
      nome_digitado_original: med.nome_digitado_original || med.nome_informado,
    } : {}),
    correcao_automatica: !!regra.correcaoAutomatica,
    principio_ativo: regra.principioAtivo,
    nomes_comerciais: regra.nomesComerciais,
    prazo_suspensao_dias: regra.prazoSuspensaoDias,
    // v48.173 — prazo por extenso (pode trazer variantes que o número
    // sozinho não mostra) — pedido do Jorge depois de ver a Auditoria sem
    // o prazo.
    prazo_texto: regra.prazoTexto,
    explicacao_paciente: regra.explicacaoPaciente,
    clinical_notes: regra.clinicalNotes,
    fonte: regra.fonte,
    fonte_detalhe: regra.fonteDetalhe,
    fonte_referencia: regra.fonteReferencia,
    // v48.172 — "auditoria" (nome dado pelo Jorge): motivo em linguagem
    // simples + fontes realmente consultadas numa busca ao vivo + a
    // confiabilidade que a própria IA atribuiu à resposta. Ver migração
    // 20261007_auditoria_medicamentos_ia_v48_172.sql.
    motivo_suspensao: regra.motivoSuspensao,
    fontes_consultadas: regra.fontesConsultadas || [],
    confiabilidade: regra.confiabilidade,
    auditado: !!regra.auditado,
    // v48.121 — "Mounjaro achou o prazo (15 dias) mas não veio a orientação":
    // isso marcava status:'resolvido' só de olhar o prazo, mesmo com
    // explicacao_paciente vazio — a base do PausaMed às vezes tem o prazo
    // cadastrado sem o texto para o paciente. Resultado: a tela não avisava
    // que faltava revisar, e só dava pra notar abrindo o remédio na mão (foi
    // o que aconteceu com o João Jorge). Gerar o PDF de suspensão já exigia os
    // dois campos (medicamentosPendentes em DocumentosCirurgia.tsx) — agora o
    // status bate com essa mesma regra, então o alerta aparece na hora certa.
    status: (regra.prazoSuspensaoDias != null && String(regra.explicacaoPaciente || '').trim()) ? 'resolvido' : 'pendente',
  } : {
    fonte: null, fonte_detalhe: null, status: 'pendente',
    // v48.172 — mesmo quando NÃO encontra o remédio, a IA agora pode
    // explicar o porquê (nome não reconhecido, sem fonte confiável etc.) —
    // guardamos para a tela mostrar em vez de um "não encontrado" mudo.
    correcao_detalhe: regra.correcaoDetalhe,
    confiabilidade: regra.confiabilidade,
    auditado: !!regra.auditado,
  }

  const { data: salvo, error } = await admin.from('cirurgia_medicamentos').update(dados).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
  return NextResponse.json({ medicamento: salvo, encontrado: regra.encontrado })
}
