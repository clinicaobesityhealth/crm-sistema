// Comparação de texto do jeito que as pessoas esperam.
//
// Quem procura um paciente digita "jose", não "José" — e quase nunca acerta o
// acento de "Conceição" ou "Muñoz". Comparar as letras cruas faz a busca
// falhar justamente nos nomes mais comuns do Brasil.
//
// normalize('NFD') separa a letra do acento; o replace remove os acentos e
// deixa a letra. "José" e "jose" viram a mesma coisa.

export function semAcento(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// v48.153 — variações de grafia comuns em nome próprio brasileiro que a
// pessoa que atende digita diferente de como o cadastro guarda (Xavier /
// Chavier, Xeila / Cheila). Canoniza "ch" para "x" só para efeito de
// comparação de BUSCA (contemTermo) — nunca mexe em semAcento sozinho, que
// serve pra ordenação e checagem de igualdade em outras telas, onde um nome
// digitado com "ch" e outro com "x" continuam sendo nomes diferentes.
function semVariante(s: string): string {
  return s.replace(/ch/g, 'x')
}

// Procura um termo dentro de um ou mais campos, ignorando acento, caixa e as
// variações de grafia tratadas em semVariante.
export function contemTermo(termo: string, ...campos: (string | null | undefined)[]): boolean {
  const t = semVariante(semAcento(termo))
  if (!t) return true
  return campos.some(c => semVariante(semAcento(c)).includes(t))
}
