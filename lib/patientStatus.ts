// Configuração central dos status do paciente (jornada bariátrica)
export type PatientStatus = 'novo' | 'acompanhamento' | 'pre_operatorio' | 'pos_cirurgico' | 'alta' | 'inativo'

export const PATIENT_STATUS_CONFIG: Record<PatientStatus, { label: string; color: string; bg: string; text: string; dot: string }> = {
  novo:           { label: 'Novo',            color: '#3b82f6', bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  acompanhamento: { label: 'Acompanhamento',  color: '#8b5cf6', bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500' },
  pre_operatorio: { label: 'Pré-operatório',  color: '#f59e0b', bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  pos_cirurgico:  { label: 'Pós-cirúrgico',   color: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  alta:           { label: 'Alta',            color: '#64748b', bg: 'bg-slate-100',  text: 'text-slate-600',   dot: 'bg-slate-400' },
  inativo:        { label: 'Inativo',         color: '#94a3b8', bg: 'bg-slate-50',   text: 'text-slate-400',   dot: 'bg-slate-300' },
}

export const PATIENT_STATUS_LIST: PatientStatus[] = ['novo', 'acompanhamento', 'pre_operatorio', 'pos_cirurgico', 'alta', 'inativo']

export function statusConfig(status?: string | null) {
  return PATIENT_STATUS_CONFIG[(status as PatientStatus) || 'novo'] || PATIENT_STATUS_CONFIG.novo
}
