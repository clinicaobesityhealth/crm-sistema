// Online ou presencial.
//
// O dado chega de lugares diferentes conforme quem criou a consulta — o
// agendamento pelo CRM grava `modalidade`, o que vem do MedX às vezes usa outro
// nome, e versões antigas gravaram só um número. Procurar em todos aqui, num
// lugar só, evita que uma tela mostre "online" e a outra não mostre nada.

export type Modalidade = 'online' | 'presencial' | null

export function modalidadeDaConsulta(a: any): Modalidade {
  if (!a) return null
  const bruto = a.modalidade ?? a.tipo_atendimento ?? a.atendimento_modalidade ?? a.tipo_consulta
  const texto = String(bruto ?? '').trim()

  if (/online|teleconsulta|telemedicina|remoto|v[ií]deo/i.test(texto)) return 'online'
  if (/presencial|consult[óo]rio|clinica|cl[íi]nica/i.test(texto)) return 'presencial'

  // Codificação antiga: 1 = presencial, 2 = online.
  if (texto === '1') return 'presencial'
  if (texto === '2') return 'online'

  return null
}

export function rotuloModalidade(m: Modalidade) {
  return m === 'online' ? 'Online' : m === 'presencial' ? 'Presencial' : null
}
