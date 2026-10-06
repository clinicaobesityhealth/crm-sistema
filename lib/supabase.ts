import { createClient } from '@supabase/supabase-js'

// Fallback só existe para não quebrar o "next build" (etapa "Collecting page
// data"), que executa código de páginas como app/manifest.ts e app/layout.tsx
// durante a construção da imagem Docker — momento em que as variáveis de
// ambiente reais (definidas no EasyPanel) ainda não estão disponíveis, só em
// tempo de execução do container. Em produção, com as variáveis reais
// configuradas, este fallback nunca é usado.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key-build-only'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Contact = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  avatar_url: string | null
  tags: string[] | null
  source: string | null
  assigned_to: string | null
  notes: string | null
  last_contacted_at: string | null
  created_at: string
  updated_at: string
  whatsapp_lid: string | null
  conversation_status: 'active' | 'closed' | 'inactive' | 'pending' | null
  sector_id: string | null
  sofia_paused: boolean | null
  patient_status: 'novo' | 'acompanhamento' | 'pre_operatorio' | 'pos_cirurgico' | 'alta' | 'inativo' | null
  medx_id: string | null
  cpf: string | null
  custom_fields: Record<string, any> | null
  // v48.106 — Alergia do paciente, em destaque na lista de cirurgias, no
  // lançamento e no link do cirurgião.
  alergico: boolean | null
  alergia_obs: string | null
}

export type Message = {
  id: string
  contact_id: string
  channel: string
  direction: 'inbound' | 'outbound' | 'internal'
  content: string | null
  media_type: string | null
  media_url: string | null
  status: string
  created_at: string
  sender_id: string | null
  reply_to_id: string | null
  external_id: string | null
  send_via?: 'whatsapp' | 'instagram' | null
  visibility_sector_id?: string | null
  // v48.137 — Mensagem apagada do WhatsApp do paciente (nunca some do CRM —
  // ver handleDeleteMessage em app/inbox/page.tsx).
  apagado_em?: string | null
  apagado_por?: string | null
}

export type MessageReaction = {
  id: string
  message_id: string
  external_message_id: string
  contact_id: string
  emoji: string
  reactor_type: 'patient' | 'agent'
  reactor_id: string
  created_at: string
  updated_at: string
}

export type Conversation = {
  contact: Contact
  last_message: Message | null
  unread_count: number
}

// Regra única de privacidade por setor exclusivo: usada em toda tela que
// exibe mensagens (Inbox, painel lateral, histórico em Contatos) para que
// nenhuma delas "esqueça" de aplicar a mesma proteção.
// - Se a mensagem já nasceu marcada (visibility_sector_id), só quem tem
//   acesso àquele setor pode ler, para sempre — mesmo que a conversa seja
//   transferida depois para outro setor.
// - Se não tem marca (mensagem antiga ou setor não exclusivo na hora do
//   envio), cai no setor ATUAL do contato só como proteção extra.
export function canReadPrivateMessage(
  message: Pick<Message, 'visibility_sector_id'>,
  contactSectorId: string | null | undefined,
  sectors: Sector[],
  agentSectorIds: string[],
): boolean {
  const visibilitySectorId = message.visibility_sector_id
  if (visibilitySectorId) return agentSectorIds.includes(visibilitySectorId)
  const currentSector = sectors.find(sector => sector.id === contactSectorId)
  if (currentSector?.is_exclusive) return agentSectorIds.includes(currentSector.id)
  return true
}

export type Agent = {
  id: string
  clinic_id: string
  name: string
  email: string
  role: 'admin' | 'usuario'
  photo_url: string | null
  job_title: string | null
  sees_all_sectors: boolean
  is_online: boolean
  last_seen_at: string | null
}

export type Sector = {
  id: string
  clinic_id: string
  name: string
  color: string
  is_exclusive: boolean
  created_at: string
}

export type DiaSemana = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab'

export type Professional = {
  id: string
  id_medx: number
  nome: string
  especialidade: string | null
  areas_de_atuacao: string[] | null
  duracao_min: number
  modalidade: string[]
  ativo: boolean
  valor_consulta_com_retorno: number | null
  valor_consulta_sem_retorno: number | null
  // E-mail de login (agents.email) do médico dono deste cadastro, quando ele
  // acessa o CRM diretamente. Usado só para filtrar a Agenda Médica pra "só
  // a minha agenda". Nulo = profissional sem login próprio vinculado ainda.
  email: string | null
  created_at: string
  updated_at: string
}

// Cargos cadastráveis em Configurações -> Cargos, usados como lista fixa no
// cadastro de atendente (evita erro de digitação, ex: "Médico" vs "Médico(a)").
export type JobTitle = {
  id: string
  clinic_id: string
  name: string
  created_at: string
}

export type ProfessionalScheduleBlock = {
  id: string
  professional_id: string
  dia_semana: DiaSemana
  hora_inicio: string
  hora_fim: string
  almoco_inicio: string | null
  almoco_fim: string | null
  duracao_min: number | null
  quinzenal: boolean
  semana_quinzenal: 'A' | 'B' | null
  valor_consulta_com_retorno: number | null
  valor_consulta_sem_retorno: number | null
  ativo: boolean
  created_at: string
  updated_at: string
}

export type AgendaSlot = {
  id: string
  slot_id: string
  professional_id: string
  id_medx: number
  profissional_nome: string
  data: string
  hora_inicio: string
  hora_fim: string
  disponivel: boolean
  especialidade: string | null
  agendamento_id: string | null
  id_tipo_consulta: string | null
  bloqueado: boolean
  motivo_bloqueio: string | null
  bloqueado_em: string | null
}

export type Agendamento = {
  id: string
  slot_id: string
  professional_id: string | null
  paciente_nome: string
  paciente_telefone: string
  profissional_nome: string
  data: string
  hora: string
  duracao_min: number
  status: 'Confirmada' | 'Cancelada' | 'Realizada'
  medx_agendamento_id: string | null
  origem: string
  motivo_cancelamento?: string | null
  contact_id?: string | null
  // v46.86: indicador de confirmação/recusa pelo próprio paciente (via link no
  // WhatsApp) — só isso, NUNCA o `status` acima, que continua exclusivamente
  // sob controle do sync automático com o MedX.
  patient_confirmed_at?: string | null
  patient_declined_at?: string | null
}

export type ClinicBranding = {
  id: string
  clinic_id: string
  primary_color: string
  logo_url: string | null
  updated_at: string
  clinic_name: string | null
  bubble_out_bg: string | null
  bubble_out_color: string | null
  bubble_in_bg: string | null
  bubble_in_color: string | null
  bubble_private_bg: string | null
  bubble_private_color: string | null
}
