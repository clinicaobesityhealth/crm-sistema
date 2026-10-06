// v48.51 — CEP: formatar e buscar o endereço.
//
// A busca roda no navegador de quem está cadastrando, direto no ViaCEP (e, se
// ele não responder, na BrasilAPI). Os dois são públicos, gratuitos e aceitam
// chamada de qualquer site. Nenhum dado do paciente vai junto — só o CEP.

export type EnderecoDoCep = { logradouro: string; bairro: string; cidade: string; uf: string }

export function soDigitosCep(v: string) { return String(v || '').replace(/\D/g, '').slice(0, 8) }

export function formatarCep(v: string) {
  const d = soDigitosCep(v)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

export async function buscarCep(cep: string): Promise<EnderecoDoCep | null> {
  const d = soDigitosCep(cep)
  if (d.length !== 8) return null
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: AbortSignal.timeout(6000) })
    const j = await r.json()
    if (r.ok && !j?.erro) return { logradouro: j.logradouro || '', bairro: j.bairro || '', cidade: j.localidade || '', uf: j.uf || '' }
    if (j?.erro) return null
  } catch {}
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${d}`, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const j = await r.json()
    return { logradouro: j.street || '', bairro: j.neighborhood || '', cidade: j.city || '', uf: j.state || '' }
  } catch { return null }
}
