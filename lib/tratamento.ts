// v47.19 — Tratamento formal nas mensagens de cobrança.
//
// Os nomes chegam do MedX em caixa alta ("JOÃO JORGE DE BARROS NETO"), e escrever
// "Olá, JOÃO!" numa cobrança soa como grito e como intimidade que a clínica não
// pediu. Aqui o nome é normalizado e recebe o tratamento.
//
// As partículas ("de", "da", "dos", "e") ficam em minúscula, como se escreve em
// português — "João de Barros", não "João De Barros".

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'di', 'du', 'la', 'van', 'von'])

export function capitalizarNome(nome?: string | null): string {
  const bruto = (nome || '').trim()
  if (!bruto) return ''
  return bruto
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((palavra, i) => {
      if (i > 0 && PARTICULAS.has(palavra)) return palavra
      // Nomes com hífen ou apóstrofo ganham maiúscula nos dois pedaços:
      // "maria-clara" → "Maria-Clara", "d'avila" → "D'Avila".
      return palavra.replace(/(^|[-'])([a-zà-ÿ])/g, (_m, sep, letra) => sep + letra.toLocaleUpperCase('pt-BR'))
    })
    .join(' ')
}

export function primeiroNome(nome?: string | null): string {
  return capitalizarNome(nome).split(' ')[0] || ''
}

// "Prezado(a) Sr(a). João," — ou só "Prezado(a)," quando não sabemos o nome.
export function saudacaoFormal(nome?: string | null): string {
  const pn = primeiroNome(nome)
  return pn ? `Prezado(a) Sr(a). ${pn},` : 'Prezado(a),'
}
