export const MEDX_REGISTER_ENDPOINT = '/api/medx/register'

export type MedxRegistrationData = {
  contact_id: string
  nome: string
  nome_social?: string
  sexo: string
  nascimento: string
  cpf: string
  celular: string
  cep?: string
  endereco_residencial?: string
  complemento?: string
  numero?: string
  bairro?: string
  cidade?: string
  estado?: string
  email?: string
}

export function validateMedxRegistration(data: MedxRegistrationData) {
  const missing: string[] = []
  if (!data.nome.trim()) missing.push('nome')
  if (!data.cpf.replace(/\D/g, '')) missing.push('CPF')
  if (!data.celular.replace(/\D/g, '')) missing.push('telefone')
  if (!data.nascimento) missing.push('data de nascimento')
  if (!data.sexo) missing.push('sexo')
  return missing
}

export function extractMedxId(value: any): string | null {
  const normalized = Array.isArray(value) ? value[0] : value
  const candidates = [
    normalized?.medx_id, normalized?.id_medx, normalized?.Id_do_Cliente, normalized?.id,
    normalized?.data?.medx_id, normalized?.data?.id_medx, normalized?.data?.Id_do_Cliente, normalized?.data?.id,
    normalized?.paciente?.medx_id, normalized?.paciente?.Id_do_Cliente,
  ]
  const found = candidates.find(v => v !== undefined && v !== null && String(v).trim())
  return found === undefined ? null : String(found)
}

export async function registerPatientInMedx(data: MedxRegistrationData) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)
  let response: Response
  try {
    response = await fetch(MEDX_REGISTER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal,
    })
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('O MedX demorou mais de 45 segundos para responder. Tente novamente.')
    throw new Error(error?.message || 'Falha de comunicação com o MedX.')
  } finally {
    clearTimeout(timeout)
  }
  const result = await response.json().catch(() => ({}))
  const normalized = Array.isArray(result) ? (result[0] ?? {}) : result
  const explicitlyFailed = normalized?.success === false || normalized?.sucesso === false || normalized?.ok === false || normalized?.error
  if (!response.ok || explicitlyFailed) {
    throw new Error(normalized?.message || normalized?.mensagem || normalized?.error || 'Não foi possível cadastrar o paciente no MedX.')
  }
  const medxId = extractMedxId(result)
  if (!medxId) throw new Error('O MedX não confirmou o identificador do paciente. O cadastro não foi marcado como concluído.')
  return { medxId, result }
}
