// v47.06 — Geração do "Pix Copia e Cola" (BR Code) dentro do próprio CRM.
//
// Por que isso existe: a cobrança PIX era feita abrindo o site do meuairgo, que
// monta o código no navegador do paciente a partir de uma chave estática. Não há
// API nem conciliação do lado deles — o pagamento simplesmente cai na conta. Como
// o padrão do BR Code é público (EMV®QRCPS-MPM, manual do Banco Central), o CRM
// gera exatamente o mesmo código, sem depender de site de terceiro.
//
// O formato é uma sequência de campos "ID + tamanho(2 dígitos) + valor".

export type PixDados = {
  chave: string          // chave PIX do recebedor
  tipo?: string          // telefone | cpf | cnpj | email | aleatoria
  nome: string           // nome do recebedor (máx. 25 caracteres no padrão)
  cidade: string         // cidade do recebedor (máx. 15 caracteres)
  valor?: number         // opcional: cobrança sem valor deixa o pagador digitar
  descricao?: string     // aparece para o pagador em alguns bancos
  txid?: string          // identificador da cobrança (padrão: ***)
}

// Remove acentos e caracteres que o padrão não aceita. Bancos rejeitam o código
// quando o nome do recebedor vem com acento — foi por isso que o site do
// meuairgo também limpa o nome antes de montar.
function limpar(texto: string, max: number): string {
  return (texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .trim()
    .slice(0, max)
    .trim()
}

// v47.08 — A chave precisa ir no formato que o DICT (o cadastro do Banco Central)
// reconhece, senão o app do banco acusa "código inválido" na hora de pagar.
// O caso real: a chave era um telefone guardado como 11 dígitos; no BR Code ela
// tem que ir como +55 seguido do DDD e do número.
export function normalizarChave(chave: string, tipo?: string): string {
  const bruta = (chave || '').trim()
  if (!bruta) return ''
  const digitos = bruta.replace(/\D/g, '')
  const t = (tipo || '').toLowerCase()

  if (t === 'email') return bruta.toLowerCase()
  if (t === 'aleatoria') return bruta.toLowerCase()
  if (t === 'cpf' || t === 'cnpj') return digitos
  if (t === 'telefone') {
    if (bruta.startsWith('+')) return '+' + digitos
    if (digitos.length === 11 || digitos.length === 10) return '+55' + digitos
    if (digitos.length === 13 && digitos.startsWith('55')) return '+' + digitos
    return '+' + digitos
  }

  // Sem tipo informado, deduz pelo formato.
  if (bruta.includes('@')) return bruta.toLowerCase()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bruta)) return bruta.toLowerCase()
  if (bruta.startsWith('+')) return '+' + digitos
  if (digitos.length === 14) return digitos            // CNPJ
  if (digitos.length === 11) return '+55' + digitos    // celular com DDD
  if (digitos.length === 10) return '+55' + digitos
  return bruta
}

// v47.12 — O "Identificador" que o paciente vê no app do banco (e que volta no
// extrato) é o txid. Leva o NOME COMPLETO do paciente: é o que a clínica
// reconhece de bate-pronto ao conferir o extrato. O código do MedX foi tirado
// a pedido — número não diz nada para quem está conferindo.
//
// O padrão é rígido aqui: só letras e números, no máximo 25 caracteres. Nada de
// espaço, acento, ponto ou hífen — com qualquer um deles o banco recusa o
// código. Por isso "José Antônio Pereira" vira "JOSEANTONIOPEREIRA".
//
// Quando o nome completo não cabe em 25, preservamos o primeiro nome inteiro e
// vamos encurtando o resto, em vez de cortar no meio de uma palavra: assim
// "Maria Fernanda Albuquerque Cavalcanti" fica "MARIAFERNANDAALBUQUERQUE" e não
// um pedaço sem sentido.
export function montarTxid(nome?: string | null): string {
  const limpar = (t: string) => (t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim()
    .toUpperCase()

  const partes = limpar(nome || '').split(/\s+/).filter(Boolean)
  if (!partes.length) return '***'

  let txid = ''
  for (const parte of partes) {
    if (txid.length + parte.length > 25) break
    txid += parte
  }
  // Nome cuja primeira palavra já passa de 25 caracteres: corta o que couber.
  if (!txid) txid = partes[0].slice(0, 25)
  return txid || '***'
}

function campo(id: string, valor: string): string {
  const tam = String(valor.length).padStart(2, '0')
  return `${id}${tam}${valor}`
}

// CRC16/CCITT-FALSE — polinômio 0x1021, valor inicial 0xFFFF. É o exigido pelo
// manual do BR Code e vai nos últimos 4 caracteres, em maiúsculas.
export function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function gerarBrCode(d: PixDados): string {
  const chave = normalizarChave(d.chave, d.tipo)
  if (!chave) throw new Error('Chave PIX não configurada')

  const nome = limpar(d.nome, 25) || 'RECEBEDOR'
  const cidade = limpar(d.cidade, 15) || 'SAO PAULO'
  // O txid já vem pronto de montarTxid; aqui é só a rede de segurança.
  const txid = (d.txid || '***').replace(/[^A-Za-z0-9*]/g, '').slice(0, 25) || '***'

  // Merchant Account Information: só GUI do Pix + chave.
  // v47.08 — antes a descrição ia aqui, no subcampo 02. Vários bancos recusam
  // esse subcampo em PIX estático e o pagamento não completava. A descrição
  // continua aparecendo na mensagem do WhatsApp e na página de pagamento, que
  // é onde o paciente realmente lê.
  const mai = campo('00', 'br.gov.bcb.pix') + campo('01', chave)

  let payload = ''
  payload += campo('00', '01')                    // payload format indicator
  payload += campo('26', mai)                     // conta do recebedor
  payload += campo('52', '0000')                  // categoria do estabelecimento
  payload += campo('53', '986')                   // moeda: real
  if (typeof d.valor === 'number' && d.valor > 0) {
    payload += campo('54', d.valor.toFixed(2))    // valor com 2 casas
  }
  payload += campo('58', 'BR')                    // país
  payload += campo('59', nome)                    // nome do recebedor
  payload += campo('60', cidade)                  // cidade do recebedor
  payload += campo('62', campo('05', txid))       // identificador da cobrança

  payload += '6304'                               // id + tamanho do CRC
  return payload + crc16(payload)
}
