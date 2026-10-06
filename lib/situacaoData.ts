// Qual data cada situação carimba.
//
// Quando a cirurgia muda de situação, a data daquele passo é hoje — é o que a
// secretária faria à mão, e é o que ela esquece de fazer quando está correndo.
// Deixar o sistema carimbar é o que mantém o prazo dos 21 dias úteis confiável,
// porque ele conta a partir dessas datas.

export const CAMPO_DATA_POR_SITUACAO: Record<string, string> = {
  'PRE-OPERATORIO': 'data_pre_operatorio',
  'SOLICITADO AO HOSPITAL': 'data_solicitado_hospital',
  'SOLICITADO AO CONVENIO': 'data_solicitado_hospital',
  'AUTORIZADA': 'data_autorizacao',
}

function norm(s: string) {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
}

export function campoDeData(situacao: string): string | null {
  return CAMPO_DATA_POR_SITUACAO[norm(situacao)] ?? null
}

export function hojeISO() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Devolve o que precisa ser gravado junto com a mudança de situação.
//
// Só preenche data que está VAZIA. Voltar para uma situação pela qual a
// cirurgia já passou não deve apagar a data original — ela é o marco do prazo,
// e reescrevê-la daria mais 21 dias úteis de graça ao convênio.
export function datasDaSituacao(
  situacao: string,
  atual: { data_pre_operatorio?: string | null; data_solicitado_hospital?: string | null; data_autorizacao?: string | null },
): Record<string, string> {
  const campo = campoDeData(situacao)
  if (!campo) return {}
  const jaTem = (atual as any)[campo]
  if (jaTem) return {}
  return { [campo]: hojeISO() }
}
