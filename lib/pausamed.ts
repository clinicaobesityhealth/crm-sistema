import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v48.97 — Ponte de LEITURA com o banco do PausaMed (Supabase separado do
// nosso). O PausaMed é quem mantém a base clínica (regras de suspensão de
// medicamento por hospital/princípio ativo); o nosso CRM só CONSULTA essas
// tabelas — nunca grava lá, nunca cria "consultas" no PausaMed. A revisão, a
// aprovação e o PDF final são inteiramente nossos (ver
// app/api/cirurgias/[id]/documento/route.ts, tipo 'suspensao_medicamentos').
//
// Duas variáveis novas no EasyPanel:
//   PAUSAMED_SUPABASE_URL — https://gbxngfraxfsgsthsdxyc.supabase.co
//   PAUSAMED_SUPABASE_KEY — uma chave do projeto do PausaMed com permissão de
//     leitura nas tabelas abaixo (idealmente uma chave própria, só de leitura,
//     e não o service_role do PausaMed — quem administra aquele projeto
//     decide isso). NUNCA o token de login do médico: aquele é do usuário,
//     não da integração, e não deve circular pelo backend do CRM.
//
// Sem as duas variáveis configuradas, resolverMedicamento() devolve
// encontrado:false com um aviso claro em vez de quebrar a geração do PDF.

function clientePausaMed() {
  const url = process.env.PAUSAMED_SUPABASE_URL || ''
  const key = process.env.PAUSAMED_SUPABASE_KEY || ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Casos que já deram problema antes (do spec do PausaMed): nome comercial não
// bate com o princípio ativo cadastrado na base. Resolvemos aqui, ANTES de
// consultar, para que a busca já saia pelo princípio ativo — e dois nomes
// comerciais do mesmo remédio caiam na mesma regra clínica.
const SINONIMOS: Record<string, string> = {
  'mounjaro': 'tirzepatida',
  'zepbound': 'tirzepatida',
  'tirzepatida': 'tirzepatida',
  'aas': 'ácido acetilsalicílico',
  'aspirina': 'ácido acetilsalicílico',
  'melhoral': 'ácido acetilsalicílico',
  'ácido acetilsalicílico': 'ácido acetilsalicílico',
  'acido acetilsalicilico': 'ácido acetilsalicílico',
}

function normalizar(v: string) {
  return String(v || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sem acento, para casar com a lista acima
}

// v48.108 — interruption_period no PausaMed vem em TEXTO livre ("21 dias",
// "Suspender 15 dias antes", "1 dia", "Não suspender"), nunca em número.
// Number(texto) sempre dava NaN aqui (virava null ao salvar, sem avisar
// ninguém) — toda regra vinda do PausaMed ficava sem prazo de verdade, por
// mais que a IA tivesse escrito um prazo claro no texto. Mesmo parser da
// migração da planilha (workflow n8n), para ler o mesmo tipo de texto.
function prazoEmDias(texto: string | number | null | undefined): number | null {
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null
  const t = String(texto || '').toLowerCase()
  if (!t.trim()) return null
  if (/n[aã]o suspender/.test(t)) return 0
  let m = t.match(/(\d+)\s*semanas?/)
  if (m) return parseInt(m[1], 10) * 7
  m = t.match(/(\d+)\s*dias?/)
  if (m) return parseInt(m[1], 10)
  m = t.match(/(\d+)\s*h(oras?)?\b/)
  if (m) { const h = parseInt(m[1], 10); return Math.max(1, Math.ceil(h / 24)) }
  return null
}

// v48.109 — nomeInformado quase nunca vem só o nome: vem "MOUNJARO 5MG 1X POR
// SEMANA", "AAS NO ALMOÇO". Antes só casava sinônimo quando o texto INTEIRO
// era exatamente igual a uma chave (então "mounjaro" batia, mas "mounjaro
// 5mg 1x por semana" não) — por isso remédios que a clínica claramente tem
// cadastrado (e o médico digitou com a dose/horário junto, como qualquer um
// faz) voltavam "não encontrado". Agora casa o sinônimo em qualquer parte do
// texto, como palavra inteira.
export function principioAtivoProvavel(nomeInformado: string): string | null {
  const chave = normalizar(nomeInformado)
  for (const [sinonimo, principio] of Object.entries(SINONIMOS)) {
    if (normalizar(sinonimo) === chave) return principio
  }
  const palavras = chave.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  for (const [sinonimo, principio] of Object.entries(SINONIMOS)) {
    const sinNorm = normalizar(sinonimo)
    if (sinNorm.includes(' ')) {
      if (chave.includes(sinNorm)) return principio
    } else if (palavras.includes(sinNorm)) {
      return principio
    }
  }
  return null
}

// v48.109 — Quando não é um sinônimo conhecido, ainda assim não dá pra jogar
// "MOUNJARO 5MG 1X POR SEMANA" inteiro num ilike — o Postgres só acha se o
// campo contiver essa frase INTEIRA, e a base só tem "Mounjaro®" ou
// "Tirzepatida" sozinhos. Cortamos o texto na primeira palavra que parece
// dose, frequência, horário ou refeição, e ficamos só com o nome do remédio
// (que pode ter mais de uma palavra — "Cloridrato de Metformina" continua
// inteiro, porque nenhuma das palavras dele é dessa lista).
const PARE_NO_NOME = /^(\d+([.,]\d+)?(mg|mcg|g|ml|ui|un|cp|cpr|x|gts?)?|mg|mcg|g|ml|ui|un|cp|cpr|comprimidos?|capsulas?|cápsulas?|gotas?|gts?|amp|ampolas?|vez|vezes|dia|dias|semana|semanas|mes|meses|mês|hora|horas|h|ao|aos|no|na|nos|nas|pela|pelo|de|do|da|com|sem|antes|apos|após|durante|junto|almoco|almoço|jantar|cafe|café|refeicao|refeição|manha|manhã|tarde|noite|madrugada|jejum|deitar|dormir)$/i

function nomeBase(nomeInformado: string): string {
  const palavras = String(nomeInformado || '').trim().split(/\s+/).filter(Boolean)
  const base: string[] = []
  for (const p of palavras) {
    if (base.length && PARE_NO_NOME.test(p)) break
    base.push(p)
  }
  const resultado = base.join(' ').trim()
  return resultado || nomeInformado
}

export type FonteConsultada = { titulo: string; url: string }

export type RegraMedicamento = {
  encontrado: boolean
  fonte: 'hospital' | 'clinica' | 'hospital_importada' | 'geral' | 'clinica_ia' | 'ia' | null
  fonteDetalhe: string | null
  principioAtivo: string | null
  nomesComerciais: string | null
  prazoSuspensaoDias: number | null
  explicacaoPaciente: string | null
  clinicalNotes: string | null
  // v48.144 — de onde veio a orientação (bula, diretriz de sociedade médica,
  // regra do PausaMed...), para a equipe conferir antes de aprovar. Ver
  // comentário grande na migração 20260930_referencia_medicamento_v48_144.sql
  // — isto NÃO é uma busca ao vivo na internet quando fonte é 'ia'.
  fonteReferencia: string | null

  // v48.172 — "Auditoria" (nome dado pelo Jorge): só vem preenchido quando
  // fonte === 'ia' (ou 'clinica_ia', reaproveitando uma pesquisa de IA salva
  // antes) — ver workflow "CRM - Pesquisar Remédio (IA)" no n8n, que agora
  // faz busca ao vivo (Google Search) antes de responder. Nos tiers do
  // PausaMed (hospital/clinica/geral) estes campos ficam no valor vazio
  // porque não se aplicam: são regras estruturadas, não uma pesquisa de IA.
  motivoSuspensao: string | null       // o PORQUÊ, em linguagem simples — para a equipe conferir antes de aprovar
  fontesConsultadas: FonteConsultada[] // o que a IA realmente abriu numa busca ao vivo agora
  confiabilidade: 'alta' | 'media' | 'baixa' | null
  auditado: boolean                    // true só quando uma fonte em fontesConsultadas veio de busca ao vivo real

  // v48.172 — correção automática de erro de digitação no nome (pedido do
  // Jorge: "COONDROFLEX" → "Condroflex" sem precisar digitar de novo). Quem
  // decide se aplica ao cadastro da cirurgia é o chamador (API route), nunca
  // esta função — aqui só repassamos o que a IA encontrou.
  nomeCorrigido: string | null
  correcaoAutomatica: boolean
  correcaoDetalhe: string | null

  erro?: string
}

const VAZIA: RegraMedicamento = {
  encontrado: false, fonte: null, fonteDetalhe: null, principioAtivo: null,
  nomesComerciais: null, prazoSuspensaoDias: null, explicacaoPaciente: null,
  clinicalNotes: null, fonteReferencia: null,
  motivoSuspensao: null, fontesConsultadas: [], confiabilidade: null, auditado: false,
  nomeCorrigido: null, correcaoAutomatica: false, correcaoDetalhe: null,
}

// Prioridade (nunca a regra geral por cima da do hospital):
//   1) hospital_protocol_standards — regra própria daquele hospital
//   2) clinic_protocol_variants    — personalização da NOSSA clínica para
//      aquele hospital (só entra se soubermos o nosso clinic_id no PausaMed —
//      ver PAUSAMED_CLINIC_ID abaixo; sem ele, esta camada é pulada)
//   3) clinic_clinical_rule_overrides — personalizações antigas (mesma regra
//      de clinic_id)
//   3.5) NOSSA base própria (cirurgia_medicamentos_clinica), SÓ a linha
//      específica do hospital da cirurgia — ver v48.125 logo abaixo
//   4) clinical_rules — regra padrão (SEM hospital) do PausaMed
//   5) NOSSA base própria de novo, agora só a linha SEM hospital (vale pra
//      qualquer um — fallback)
//
// v48.125 — "Mounjaro voltou com 21 dias, mas aqui é 14 ou 15 dependendo do
// hospital" (relato real do Jorge). Investigando: o PausaMed não tem
// hospital_protocol_standards para tirzepatida nos hospitais do Jorge, então
// caía direto no tier 4 (clinical_rules — genérico, sem noção de hospital,
// com um prazo conservador de 21 dias) ANTES de sequer olhar nossa própria
// base (tier antigo, sem hospital, ficava depois do tier 4). E mesmo se
// chegasse lá, cirurgia_medicamentos_clinica não tinha coluna hospital — uma
// correção salva para um hospital vazaria para os outros (ver migração
// 20260928_hospital_base_clinica_medicamentos_v48_125.sql).
//
// Decisão de ordem (documentada aqui porque afeta orientação clínica): o
// tier 3.5 SÓ entra quando existe hospitalNome E há uma linha da NOSSA base
// marcada especificamente para aquele hospital — nesse caso ela fura na
// frente do tier 4 genérico do PausaMed, porque um resultado hospital-
// específico e já revisado pela própria clínica é mais confiável que um
// "padrão geral" externo que nem menciona o hospital em questão. Isso NÃO
// mexe na prioridade do tier 1 (hospital_protocol_standards): quando o
// PausaMed TEM regra própria daquele hospital, ela continua vencendo de
// tudo, inclusive da nossa base — só usamos a nossa quando o PausaMed não
// tem nada hospital-específico. Já uma linha da nossa base SEM hospital
// (tier 5) continua depois do tier 4: um "vale pra qualquer hospital" nosso
// não é mais confiável que o padrão geral do PausaMed, só existe pra não
// gastar IA de novo quando nem o PausaMed nem uma regra hospital-específica
// nossa respondem.
export async function resolverMedicamento(opts: {
  nomeInformado: string
  hospitalNome?: string | null
}): Promise<RegraMedicamento> {
  const sb = clientePausaMed()
  if (!sb) return { ...VAZIA, erro: 'PAUSAMED_SUPABASE_URL / PAUSAMED_SUPABASE_KEY não configurados no servidor.' }

  const nome = String(opts.nomeInformado || '').trim()
  if (!nome) return { ...VAZIA, erro: 'Nome do medicamento vazio.' }
  const principioSugerido = principioAtivoProvavel(nome)
  const termoBusca = principioSugerido || nomeBase(nome)
  const clinicId = process.env.PAUSAMED_CLINIC_ID || ''
  const hospitalNome = (opts.hospitalNome || '').trim() || null

  // Busca por nome comercial OU princípio ativo — é o que faz Mounjaro e
  // Zepbound caírem na mesma linha quando a base já os tem cadastrados com o
  // mesmo active_ingredient.
  const orNome = (col1: string, col2: string) =>
    `${col1}.ilike.%${termoBusca}%,${col2}.ilike.%${termoBusca}%`

  // v48.130 — BUG DE VERDADE encontrado (não era falta de dado no PausaMed —
  // o Jorge estava certo ao contestar: "o mounjaro no pausamed é 14-15 dias
  // de acordo com o hospital... esta informação temos no supabase do
  // pausamed"). Conferindo o schema real do banco do PausaMed (leitura
  // autorizada pelo Jorge, projeto dele): hospital_protocol_standards,
  // clinic_protocol_variants e clinic_clinical_rule_overrides NÃO TÊM
  // colunas medication_name/active_ingredient — cada linha delas só
  // referencia a regra genérica por base_rule_id (uuid → clinical_rules.id).
  // Os tiers 1/2/3 abaixo faziam `.or(orNome('medication_name',
  // 'active_ingredient'))` direto nessas três tabelas — colunas que não
  // existem nelas — e o Postgres sempre devolvia erro 42703 (column does not
  // exist). Como o código só lia `data` e nunca conferia `error`, essa falha
  // ficava invisível: os três tiers sempre voltavam "nada encontrado" e a
  // busca caía direto no tier 4 (regra genérica do PausaMed, sem noção de
  // hospital) — por isso "Mounjaro" sempre voltava 21 dias, não importava o
  // hospital escolhido. Corrigido: primeiro resolve a regra base em
  // clinical_rules (onde medication_name/active_ingredient realmente
  // existem) para pegar o id; os tiers 1/2/3 então filtram por
  // base_rule_id = esse id, e o nome do remédio é copiado da regra base para
  // a linha final (essas três tabelas não guardam nome, só prazo/orientação
  // específicos do hospital/clínica). Erros do Postgres agora são conferidos
  // e propagados em vez de engolidos em silêncio.
  let base: any = null
  try {
    const { data: baseRows, error: erroBase } = await sb.from('clinical_rules')
      .select('*').or(orNome('medication_name', 'active_ingredient'))
      .eq('is_active', true).limit(1)
    if (erroBase) return { ...VAZIA, erro: 'Não consegui consultar o PausaMed: ' + erroBase.message }
    base = baseRows?.[0] || null

    if (base) {
      // 1) Regra específica do hospital selecionado
      if (hospitalNome) {
        const { data, error } = await sb.from('hospital_protocol_standards')
          .select('*').eq('base_rule_id', base.id)
          .ilike('hospital_name', `%${hospitalNome}%`).eq('is_active', true).limit(1)
        if (error) return { ...VAZIA, erro: 'Não consegui consultar o PausaMed: ' + error.message }
        const r = data?.[0]
        if (r) return linha({ ...r, medication_name: base.medication_name, active_ingredient: base.active_ingredient }, 'hospital', hospitalNome)
      }

      // 2) Personalização da clínica para aquele hospital
      if (clinicId && hospitalNome) {
        const { data, error } = await sb.from('clinic_protocol_variants')
          .select('*').eq('base_rule_id', base.id)
          .eq('clinic_id', clinicId).eq('status', 'active').limit(1)
        if (error) return { ...VAZIA, erro: 'Não consegui consultar o PausaMed: ' + error.message }
        const r = data?.[0]
        if (r) return linha({ ...r, medication_name: base.medication_name, active_ingredient: base.active_ingredient }, 'clinica', 'Personalização da clínica')
      }

      // 3) Regra hospitalar importada / personalização antiga da clínica
      if (clinicId) {
        const { data, error } = await sb.from('clinic_clinical_rule_overrides')
          .select('*').eq('base_rule_id', base.id)
          .eq('clinic_id', clinicId).limit(1)
        if (error) return { ...VAZIA, erro: 'Não consegui consultar o PausaMed: ' + error.message }
        const r = data?.[0]
        if (r) return linha({ ...r, medication_name: base.medication_name, active_ingredient: base.active_ingredient }, 'hospital_importada', 'Personalização antiga da clínica')
      }
    }
  } catch (e: any) {
    return { ...VAZIA, erro: 'Não consegui consultar o PausaMed: ' + (e?.message || e) }
  }

  // v48.125 — tier 3.5: NOSSA base, só a linha ESPECÍFICA deste hospital,
  // antes do padrão genérico do PausaMed (tier 4) — ver a explicação de
  // ordem no comentário grande acima.
  const admin = getSupabaseAdmin()
  if (admin && hospitalNome) {
    const daClinicaHospital = await buscarNaBaseClinica(admin, termoBusca, hospitalNome)
    if (daClinicaHospital) return daClinicaHospital
  }

  // 4) Regra padrão (sem hospital) do PausaMed — já resolvida no início desta
  // função (variável `base`), não precisa consultar de novo.
  if (base) return linha(base, 'geral', 'Base padrão PausaMed')

  // v48.101 — O PausaMed não tem: antes de pesquisar com IA de novo, olha a
  // base própria da clínica (o que já foi pesquisado antes fica aqui, nunca
  // é perguntado à IA duas vezes para o mesmo remédio). v48.125: aqui é só a
  // linha SEM hospital (fallback "vale pra qualquer um") — a específica do
  // hospital já foi tentada acima, antes do tier 4.
  if (admin) {
    const daClinicaGeral = await buscarNaBaseClinica(admin, termoBusca, null)
    if (daClinicaGeral) return daClinicaGeral
  }

  // Última tentativa: pesquisa por IA (workflow n8n, ver comentário no topo
  // do arquivo). Só chega aqui quando nada foi encontrado em lugar nenhum.
  const daIA = await pesquisarComIA(nome, hospitalNome)
  if (daIA.encontrado) return daIA
  // v48.118 — Se a IA nem chegou a rodar (erro de rede/timeout, ver acima),
  // isso sobe como erro de verdade em vez de virar "não encontrado" silencioso.
  if (daIA.erro) return { ...VAZIA, erro: daIA.erro }

  return { ...VAZIA }
}

// v48.125 — hospitalNome define o MODO da busca, nunca mistura os dois:
//   hospitalNome com valor  → só linhas gravadas ESPECIFICAMENTE para aquele
//                             hospital (coluna hospital ilike o nome)
//   hospitalNome null       → só linhas SEM hospital (coluna hospital NULL —
//                             "vale pra qualquer hospital")
// Antes desta coluna existir, uma resposta gravada para um hospital (ex.:
// Mounjaro/tirzepatida, 14 dias no Hospital A) valia para TODOS os hospitais
// (a busca era só por princípio ativo) — inclusive um Hospital B onde o
// certo é 15 dias. Era exatamente o bug relatado pelo Jorge.
async function buscarNaBaseClinica(admin: ReturnType<typeof getSupabaseAdmin>, termoBusca: string, hospitalNome: string | null): Promise<RegraMedicamento | null> {
  if (!admin) return null
  // v48.124 — "Mounjaro sempre volta sem orientação": achamos o motivo. Uma
  // pesquisa antiga por IA foi salva na base da clínica com o prazo (15 dias)
  // mas sem o texto de orientação ao paciente — e, como esta consulta pega
  // SEMPRE a linha mais recente, toda pesquisa nova de Mounjaro/tirzepatida
  // caía direto nessa linha incompleta e nunca mais chegava a perguntar de
  // novo pra IA. Busca mais de uma linha agora e pula qualquer uma sem
  // orientação preenchida — se todas as que baterem estiverem incompletas
  // (como a de hoje), a função devolve null e resolverMedicamento() segue
  // para pesquisarComIA(), que tem chance de vir completa desta vez (e, se o
  // médico confirmar salvar de novo, substitui a linha velha nas buscas
  // futuras — created_at mais novo vence).
  let consulta = admin.from('cirurgia_medicamentos_clinica')
    .select('*').eq('ativo', true)
    .or(`principio_ativo.ilike.%${termoBusca}%,nomes_comerciais.ilike.%${termoBusca}%`)
  consulta = hospitalNome ? consulta.ilike('hospital', `%${hospitalNome}%`) : consulta.is('hospital', null)
  const { data } = await consulta.order('created_at', { ascending: false }).limit(5)
  const r = (data as any[] | null)?.find(x => x.prazo_suspensao_dias != null && String(x.explicacao_paciente || '').trim())
  if (!r) return null
  return {
    encontrado: true, fonte: 'clinica_ia',
    fonteDetalhe: hospitalNome
      ? `Base própria da clínica (pesquisada por IA antes) — regra específica para ${r.hospital || hospitalNome}`
      : 'Base própria da clínica (pesquisada por IA antes)',
    principioAtivo: r.principio_ativo || null, nomesComerciais: r.nomes_comerciais || null,
    prazoSuspensaoDias: r.prazo_suspensao_dias != null ? Number(r.prazo_suspensao_dias) : null,
    explicacaoPaciente: r.explicacao_paciente || null, clinicalNotes: r.orientacao || null,
    // v48.144 — Antes lia r.prazo_texto aqui (o texto cru do prazo, tipo "21
    // dias" — não uma referência de verdade). A coluna certa é `referencia`
    // (nova, ver migração v48.144).
    fonteReferencia: r.referencia || null,
    // v48.172 — esta linha veio de uma pesquisa de IA já auditada antes (ver
    // migração 20261007_auditoria_medicamentos_ia_v48_172.sql) — repassa a
    // mesma auditoria em vez de descartá-la, já que é a mesma informação,
    // só reaproveitada para não gastar IA de novo.
    motivoSuspensao: r.motivo_suspensao || null,
    fontesConsultadas: Array.isArray(r.fontes_consultadas) ? r.fontes_consultadas : [],
    confiabilidade: r.confiabilidade || null,
    auditado: !!r.auditado,
    nomeCorrigido: null, correcaoAutomatica: false, correcaoDetalhe: null,
  }
}

// v48.118 — "Moujaro não está achando" (relato real, cirurgia do João Jorge):
// olhando as execuções do workflow no n8n, a chamada NUNCA chegou lá — zero
// rastro. Antes, qualquer falha de rede/timeout ao chamar o webhook virava
// silenciosamente "não encontrado" (catch vazio embaixo), e a tela mostrava a
// mesma frase de "não achei regra em lugar nenhum" — indistinguível de a IA
// ter pesquisado e realmente não saber o remédio. Ou seja: quando a chamada
// falhava, o usuário via a MESMA mensagem de "não encontrado" e não tinha
// como saber que a pesquisa nem rodou. Agora: 1) tenta de novo uma vez antes
// de desistir (a maioria desses casos é uma instabilidade de rede de alguns
// segundos entre o CRM e o n8n, não uma falha real), 2) loga o erro de
// verdade no servidor (console.error) em vez de engolir em silêncio, e 3)
// devolve um "erro" diferenciado quando a BUSCA em si falhou (rede/timeout)
// — resolverMedicamento() repassa isso para a tela, que agora consegue
// avisar "a pesquisa falhou, tente de novo" em vez de "não encontrado".
// v48.172 — "Erro 502" relatado pelo Jorge na Sinvastatina: o timeout aqui
// era 45s, mas uma pesquisa de verdade (agora com busca ao vivo no Google,
// ver comentário grande abaixo em pesquisarComIA) mede, em testes reais,
// entre ~55s e ~120s. Ou seja: o 502 muito provavelmente nunca foi um erro
// da IA — era o nosso PRÓPRIO código desistindo (AbortSignal.timeout) bem
// antes da resposta chegar, ou o proxy reverso na frente do n8n/CRM
// (EasyPanel/Traefik) cortando a conexão primeiro. Subindo para 170s aqui
// cobre com folga o pior caso já medido (~120s). IMPORTANTE: se o "Erro 502"
// persistir mesmo assim, o próximo lugar a verificar é o timeout do proxy
// reverso do EasyPanel na frente do CRM e/ou do n8n — um timeout de 170s
// aqui no código não adianta se o proxy na frente cortar a conexão antes
// disso (por exemplo, muitos ficam com um padrão de 60s).
function chamarWebhookIA(url: string, nomeInformado: string, hospitalNome: string | null) {
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: nomeInformado, hospital: hospitalNome || '' }),
    signal: AbortSignal.timeout(170000),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`Webhook da IA devolveu ${r.status}`)
    const j: any = await r.json().catch(() => null)
    if (!j) throw new Error('Resposta da IA não veio em JSON válido')
    return j
  })
}

// Workflow "CRM - Pesquisar Remédio (IA)" no n8n: recebe {nome, hospital},
// pesquisa com Gemini e já grava o resultado em cirurgia_medicamentos_clinica
// (para a próxima vez cair no tier acima, sem gastar IA de novo). Devolve o
// mesmo formato da linha gravada — ver PESQUISA_REMEDIO_IA_WEBHOOK_URL no
// EasyPanel para trocar o endereço sem reeditar código.
async function pesquisarComIA(nomeInformado: string, hospitalNome: string | null): Promise<RegraMedicamento> {
  const url = process.env.PESQUISA_REMEDIO_IA_WEBHOOK_URL
    || 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/pesquisar-remedio-ia'
  let ultimoErro: any = null
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const j = await chamarWebhookIA(url, nomeInformado, hospitalNome)

      // v48.172 — a IA agora corrige sozinha erro de digitação no nome (ex.:
      // "Coondroflex" -> "Condroflex") E explica mesmo quando NÃO encontrou
      // nada (ver correcao_detalhe/confiabilidade/auditado no workflow "CRM -
      // Pesquisar Remédio (IA)") — por isso repassamos esses três campos nos
      // dois casos (encontrado true ou false), não só quando acha o remédio.
      const auditoriaBase = {
        confiabilidade: (['alta', 'media', 'baixa'].includes(j.confiabilidade) ? j.confiabilidade : null) as RegraMedicamento['confiabilidade'],
        auditado: !!j.auditado,
        nomeCorrigido: j.nome_corrigido || null,
        correcaoAutomatica: !!j.correcao_automatica,
        correcaoDetalhe: j.correcao_detalhe || null,
      }

      if (!j.encontrado) {
        // IA rodou de verdade (inclusive buscou na internet) e não achou um
        // remédio confiável — "não encontrado" legítimo, mas ainda assim
        // explicado (ver correcaoDetalhe/observações na tela).
        return { ...VAZIA, ...auditoriaBase }
      }

      const fontes: FonteConsultada[] = Array.isArray(j.fontes_consultadas)
        ? j.fontes_consultadas
            .filter((f: any) => f && (f.url || f.titulo))
            .map((f: any) => ({ titulo: String(f.titulo || '').trim(), url: String(f.url || '').trim() }))
        : []

      return {
        encontrado: true, fonte: 'ia', fonteDetalhe: 'Pesquisado agora por IA — confira com atenção antes de aprovar',
        principioAtivo: j.principio_ativo || null, nomesComerciais: j.nomes_comerciais || null,
        prazoSuspensaoDias: j.prazo_suspensao_dias != null ? Number(j.prazo_suspensao_dias) : null,
        explicacaoPaciente: j.explicacao_paciente || null, clinicalNotes: j.orientacao || null,
        // v48.144 — Antes lia j.prazo_texto aqui (mesmo desencontro do
        // comentário acima). Agora vem do campo `referencia` que o workflow
        // "CRM - Pesquisar Remédio (IA)" devolve — descrição por extenso das
        // fontes usadas.
        fonteReferencia: j.referencia || null,
        // v48.172 — "auditoria" (nome dado pelo Jorge): motivo em linguagem
        // simples + as fontes reais que a IA abriu numa busca ao vivo agora.
        motivoSuspensao: j.motivo || null,
        fontesConsultadas: fontes,
        ...auditoriaBase,
      }
    } catch (e: any) {
      ultimoErro = e
      console.error(`[pausamed] pesquisarComIA falhou (tentativa ${tentativa}/2) para "${nomeInformado}":`, e?.name, e?.message || e)
      if (tentativa === 1) await new Promise(res => setTimeout(res, 1500))
    }
  }
  // Duas tentativas falharam sem nunca rodar a IA de verdade — isso é
  // diferente de "não encontrado", e a tela precisa saber a diferença. Ver
  // o comentário grande em chamarWebhookIA() sobre o timeout de 170s: se
  // isto continuar falhando com "ia_falhou" (não com um erro HTTP vindo do
  // n8n), o próximo lugar a olhar é o timeout do proxy reverso do EasyPanel.
  return { ...VAZIA, erro: 'ia_falhou: ' + (ultimoErro?.message || ultimoErro || 'motivo desconhecido') }
}

export type SugestaoMedicamento = { nome: string; principioAtivo: string | null; origem: 'pausamed' | 'clinica' }

// v48.144 — Autocomplete de medicamento, pedido do Jorge depois do caso
// "MOUJARO" (digitou errado de propósito para mostrar o problema: a IA não
// reconheceu o nome, não achou o remédio, e voltou um prazo genérico errado
// sem avisar que não tinha certeza). Antes o autocomplete de
// MedicamentosCirurgia.tsx só sugeria o que a PRÓPRIA clínica já tinha
// pesquisado antes (cirurgia_medicamentos_clinica) — um remédio nunca usado
// aqui não aparecia. Agora busca TAMBÉM no catálogo do PRÓPRIO PausaMed
// (clinical_rules — a base de nomes/princípios ativos que ele mantém), então
// cobre muito mais remédio, mesmo o primeiro a ser usado na clínica.
// Escolher da lista elimina o erro de digitação na raiz, em vez de tentar
// corrigi-lo depois — ver escolherSugestao() em MedicamentosCirurgia.tsx e
// em MedicamentosCirurgiao (app/agendar-cirurgia/[token]/page.tsx).
export async function sugerirMedicamentos(termoBruto: string): Promise<SugestaoMedicamento[]> {
  // Vírgula/parêntese quebram a sintaxe do filtro .or() do PostgREST.
  const limpo = String(termoBruto || '').replace(/[,()%]/g, ' ').replace(/\s+/g, ' ').trim()
  if (limpo.length < 2) return []

  const [doPausaMed, daClinica] = await Promise.all([
    buscarNoCatalogoPausaMed(limpo),
    buscarNaListaClinica(limpo),
  ])

  // PausaMed primeiro (catálogo maior e mais confiável); a base própria da
  // clínica entra depois, só o que ainda não apareceu — evita repetir o
  // mesmo nome duas vezes quando os dois lados conhecem o remédio.
  const vistos = new Set<string>()
  const resultado: SugestaoMedicamento[] = []
  for (const s of [...doPausaMed, ...daClinica]) {
    const chave = s.nome.toLowerCase()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    resultado.push(s)
    if (resultado.length >= 8) break
  }
  return resultado
}

async function buscarNoCatalogoPausaMed(termo: string): Promise<SugestaoMedicamento[]> {
  const sb = clientePausaMed()
  if (!sb) return []
  try {
    const { data, error } = await sb.from('clinical_rules')
      .select('medication_name, active_ingredient')
      .eq('is_active', true)
      .or(`medication_name.ilike.%${termo}%,active_ingredient.ilike.%${termo}%`)
      .limit(10)
    if (error) return []
    return ((data as any[]) || [])
      .map(r => ({
        nome: String(r.medication_name || r.active_ingredient || '').trim(),
        principioAtivo: r.active_ingredient || null,
        origem: 'pausamed' as const,
      }))
      .filter(s => s.nome)
  } catch { return [] }
}

async function buscarNaListaClinica(termo: string): Promise<SugestaoMedicamento[]> {
  const admin = getSupabaseAdmin()
  if (!admin) return []
  try {
    const { data, error } = await admin.from('cirurgia_medicamentos_clinica')
      .select('principio_ativo, nomes_comerciais').eq('ativo', true)
      .or(`principio_ativo.ilike.%${termo}%,nomes_comerciais.ilike.%${termo}%`)
      .order('created_at', { ascending: false }).limit(10)
    if (error) return []
    return ((data as any[]) || [])
      .map(r => ({
        nome: String(r.nomes_comerciais || r.principio_ativo || '').trim(),
        principioAtivo: r.principio_ativo || null,
        origem: 'clinica' as const,
      }))
      .filter(s => s.nome)
  } catch { return [] }
}

function linha(r: any, fonte: RegraMedicamento['fonte'], fonteDetalhe: string): RegraMedicamento {
  return {
    encontrado: true,
    fonte, fonteDetalhe,
    principioAtivo: r.active_ingredient || null,
    nomesComerciais: r.medication_name || null,
    prazoSuspensaoDias: prazoEmDias(r.interruption_period),
    explicacaoPaciente: r.patient_explanation || null,
    clinicalNotes: r.clinical_notes || null,
    fonteReferencia: r.source_reference || null,
    // v48.172 — regra estruturada do PausaMed, não uma pesquisa de IA agora
    // — estes campos de auditoria não se aplicam aqui (ver comentário no
    // tipo RegraMedicamento).
    motivoSuspensao: null, fontesConsultadas: [], confiabilidade: null, auditado: false,
    nomeCorrigido: null, correcaoAutomatica: false, correcaoDetalhe: null,
  }
}
