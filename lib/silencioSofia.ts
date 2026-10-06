// Quando a assistente NÃO deve responder.
//
// v48.34 — O caso que pediu isso: uma lista de transmissão de notícias de
// futebol caiu no número da clínica, e a Sofia respondeu educadamente a cada
// manchete — "Olá! Vi o link que você me enviou. Como posso te ajudar?".
//
// Isso não é a Sofia entendendo mal. É que ela nunca teve a opção de ficar
// calada: toda mensagem que chega vira uma resposta. Nenhum prompt conserta
// isso sozinho — por melhor que seja a instrução, o modelo sempre gera algum
// texto. O que falta é um portão ANTES dela.
//
// E responder é pior do que parecer bobo: cada resposta mantém a janela de
// conversa aberta e confirma para quem disparou que o número está vivo e
// atende. É assim que a lista mantém você nela.
//
// Estas regras ficam guardadas em clinic_settings.sofia_config e são lidas
// pelo fluxo do n8n, que decide chamar ou não a assistente. Ficam aqui, em
// texto editável, para a clínica acrescentar um tipo de lixo novo sem depender
// de uma versão nova do sistema.

export const REGRAS_SILENCIO_PADRAO = `NÃO RESPONDER quando a mensagem não for alguém falando com a clínica:

- notícia, manchete ou reportagem encaminhada (esporte, política, celebridades)
- mensagem que é só um link, sem pergunta nem pedido
- propaganda, promoção, sorteio, "clique aqui", cupom, catálogo
- corrente, mensagem de bom dia com imagem, corrente religiosa
- disparo de lista de transmissão ou canal de notícias
- cobrança automática, código de verificação, aviso de banco ou operadora
- mensagem sem texto: só figurinha, só emoji, só "oi" repetido de um número que nunca foi paciente

RESPONDER SEMPRE, mesmo que a mensagem seja curta ou confusa:

- qualquer menção a consulta, cirurgia, exame, remédio, dor, sintoma, peso
- qualquer pergunta sobre horário, endereço, valores, convênio, retorno
- paciente que já tem cadastro ou já conversou com a clínica antes
- mensagem que pede ajuda, mesmo sem dizer do quê

Na dúvida, responder. Deixar um paciente sem resposta é pior do que responder a um anúncio.`

// Um palpite rápido, sem IA, para a tela do Atendimento marcar a mensagem como
// provável ruído. Não decide nada sozinho — quem decide é o fluxo. Serve para
// a secretária bater o olho e entender por que a Sofia ficou quieta.
export function pareceRuido(texto: string | null | undefined): boolean {
  const t = String(texto || '').trim()
  if (!t) return false

  const semLink = t.replace(/https?:\/\/\S+/gi, '').trim()
  const temLink = /https?:\/\//i.test(t)

  // Link sem nenhuma palavra em volta: o caso mais claro de todos.
  if (temLink && semLink.length < 12) return true

  // Manchete encaminhada: link com texto longo e nenhuma pergunta.
  if (temLink && semLink.length > 60 && !/\?/.test(semLink)) return true

  const marcas = /(promo[çc][ãa]o|desconto|cupom|sorteio|clique aqui|assine|newsletter|confira|saiba mais|ao vivo|escala[çc][õo]es|rodada|campeonato|s[ée]rie [ab])/i
  if (temLink && marcas.test(t)) return true

  return false
}
