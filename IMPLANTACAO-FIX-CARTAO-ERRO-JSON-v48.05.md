# v48.05 — Correção do erro no pagamento com cartão

**Não tem SQL.** É só subir o zip.

## O que aquele erro significava

`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

A página do paciente pediu o link de pagamento e recebeu de volta uma **página
HTML**, não a resposta que esperava. Isso não acontece quando o programa
responde — acontece quando ele **não chega a responder**, e quem responde no
lugar é a camada de servidor, com a página de erro dela.

A causa mais provável: a chamada à Safrapay ficou pendurada. Os dois pedidos
que a rota faz (autenticar e criar o link) não tinham tempo limite. Se a
Safrapay demora ou não responde, a requisição fica esperando até o servidor
desistir — e aí é o servidor que responde ao paciente, em HTML.

Repare que a lista de parcelas apareceu certinha: aquela parte não conversa com
a Safrapay. Só o botão Continuar conversa. É exatamente o recorte do problema.

## As três correções

**1. Tempo limite de 12 segundos em toda chamada à Safrapay.** Agora quem
desiste primeiro somos nós, com uma mensagem em português, em vez de o servidor
desistir com uma página de erro.

**2. A página do paciente nunca mais mostra erro de JSON.** A resposta é lida
como texto antes de ser interpretada. Se não vier JSON, o paciente lê
*"O sistema de pagamento demorou para responder. Tente de novo em alguns
instantes."* e o código do erro fica registrado no console para investigação.
Erro de infraestrutura não pode chegar ao paciente disfarçado de erro de
programa.

**3. O motivo real fica gravado.** Toda falha agora entra na cobrança (campo
`erro`) e em `safrapay_eventos`, com o código HTTP e o começo do que a Safrapay
respondeu. Assim dá para descobrir o que houve depois, sem depender de alguém
ter visto a tela na hora.

## O que eu preciso que você faça agora

Em **Configurações → Cobrança**, abaixo do Merchant Token, tem um botão novo:
**Testar conexão com a Safrapay**.

Ele faz só a autenticação — não cria cobrança, não gera link, não mexe em
dinheiro. Clique e me diga o que aparece. A resposta distingue as três
possibilidades que eu não consigo separar daqui:

- **credencial recusada** — token errado, ou token de homologação sendo usado em produção
- **ambiente errado** — produção ainda não liberada pela Safrapay
- **Safrapay lenta ou fora do ar** — aparece o tempo em milissegundos

Se der certo mas o pagamento continuar falhando, o tempo em milissegundos já
diz muito: uma autenticação que leva vários segundos é o aviso de que a criação
do link vai estourar o limite depois.

## Sobre a cobrança que falhou

O paciente não foi cobrado. A cobrança ficou registrada no CRM com o motivo da
falha; é só reenviar o link depois que a conexão estiver de pé.
