// Tradução entre a planilha CIRURGIAS OBESITY e o CRM.
//
// Fica separado das rotas porque é a parte que mais erra: a planilha guarda
// tudo como texto digitado por gente — data em dd/mm/aaaa, dinheiro com "R$" e
// ponto de milhar, "✔️" no lugar de sim. Cada conversão dessas tem um jeito de
// dar errado, e todas estão aqui, num lugar só, onde dá para testar.

// A ordem das colunas na aba CIRURGIAS. O índice é a posição (A=0).
// AE é nova: guarda o id do CRM, e por isso vai no fim — assim nenhuma coluna
// existente se desloca e nenhuma fórmula da contabilidade quebra.
export const COLUNAS = {
  carimbo: 0,           // A
  alertas: 1,           // B
  nome: 2,              // C
  telefone: 3,          // D
  data: 4,              // E
  hora: 5,              // F
  situacao: 6,          // G
  condicao: 7,          // H
  cirurgia: 8,          // I  (a abreviação)
  hospital: 9,          // J
  cirurgiao: 10,        // K
  equipe: 11,           // L
  ajuste: 12,           // M
  msgPreop: 13,         // N
  documentos: 14,       // O
  foto: 15,             // P
  observacao: 16,       // Q
  dataPreop: 17,        // R
  dataSolicitado: 18,   // S
  dataAutorizacao: 19,  // T
  logAgenda: 20,        // U
  linkForms: 21,        // V
  cartas: 22,           // W
  medicacoes: 23,       // X
  valorPrevia: 24,      // Y
  valorCobrado: 25,     // Z
  formaPagamento: 26,   // AA
  parcelas: 27,         // AB
  pago: 28,             // AC
  agendamentoMsg: 29,   // AD
  crmId: 30,            // AE — coluna nova
} as const

export const TOTAL_COLUNAS = 31

// --- leitura ---------------------------------------------------------------

export function texto(v: any): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

// Datas chegam como "26/09/2026", como "2026-09-26" ou como um objeto de data
// já convertido pelo n8n. Aceita os três e devolve sempre ISO, que é o que o
// banco entende.
export function paraData(v: any): string | null {
  const s = texto(v)
  if (!s) return null

  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (br) {
    const [, d, m, a] = br
    return `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]

  return null
}

export function paraDataHora(v: any): string | null {
  const s = texto(v)
  if (!s) return null
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (br) {
    const [, d, m, a, h, min, seg] = br
    return `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:${seg || '00'}-03:00`
  }
  const data = paraData(s)
  return data ? `${data}T00:00:00-03:00` : null
}

export function paraHora(v: any): string | null {
  const s = texto(v)
  if (!s) return null
  const m = s.match(/(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

// "R$ 13.000,00" → 13000. O ponto é milhar e a vírgula é decimal: trocar a
// ordem dessas duas substituições transforma treze mil em treze.
export function paraNumero(v: any): number | null {
  const s = texto(v)
  if (!s) return null
  const limpo = s.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

export function paraInteiro(v: any): number | null {
  const s = texto(v).replace(/\D/g, '')
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

// A planilha marca "sim" com ✔️, ✔, x, SIM, TRUE — depende de quem preencheu.
// Qualquer coisa escrita na célula, exceto um "não" explícito, vale como sim.
export function paraMarcado(v: any): boolean {
  const s = texto(v).toLowerCase()
  if (!s) return false
  if (['não', 'nao', 'n', 'false', '0', '-'].includes(s)) return false
  return true
}

// "2 AUXILIARES, 1 INSTRUMENTADOR" → números, para o cálculo do valor.
export function lerEquipe(v: any) {
  const s = texto(v).toUpperCase()
  const num = (re: RegExp) => {
    const m = s.match(re)
    return m ? parseInt(m[1], 10) : 0
  }
  return {
    auxiliares: num(/(\d+)\s*AUXILIAR/),
    instrumentadores: num(/(\d+)\s*INSTRUMENTADOR/),
    temAnestesista: /ANESTESISTA/.test(s),
  }
}

// --- escrita ---------------------------------------------------------------

export function dataBr(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

export function moedaBr(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// --- quem manda em cada coluna ------------------------------------------------
//
// A planilha não é só do CRM. Algumas colunas são escritas por scripts dela, por
// fórmulas, ou à mão pela equipe. Escrever a linha inteira apagaria tudo isso —
// e o carimbo do formulário, que é a coluna A, sumiria na primeira sincronização.
//
// Então o CRM declara o que é dele. Todo o resto é preservado como está na
// planilha, célula por célula.
export const COLUNAS_DO_CRM: number[] = [
  COLUNAS.nome, COLUNAS.telefone, COLUNAS.data, COLUNAS.hora,
  COLUNAS.situacao, COLUNAS.condicao, COLUNAS.cirurgia, COLUNAS.hospital,
  COLUNAS.cirurgiao, COLUNAS.equipe, COLUNAS.ajuste, COLUNAS.msgPreop,
  COLUNAS.documentos, COLUNAS.observacao,
  COLUNAS.dataPreop, COLUNAS.dataSolicitado, COLUNAS.dataAutorizacao,
  COLUNAS.medicacoes, COLUNAS.valorPrevia, COLUNAS.valorCobrado,
  COLUNAS.formaPagamento, COLUNAS.parcelas, COLUNAS.pago,
  COLUNAS.crmId,
]

// Não mexidas de propósito:
//   A  carimbo        — do formulário; é dele que a regra dos 30 dias conta
//   B  alertas        — fórmula da planilha
//   P  foto           — anexo posto à mão
//   U  log da agenda  — escrito pelo script do Google Agenda
//   V  link forms     — do formulário
//   W  cartas geradas — do script de cartas, enquanto ele existir
//   AD agendamento de mensagem — resquício do fluxo antigo
