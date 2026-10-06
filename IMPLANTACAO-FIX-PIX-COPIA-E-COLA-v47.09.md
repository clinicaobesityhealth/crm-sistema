# v47.09 — Correção do PIX: link caindo no login, código recusado pelo banco e copia e cola sozinho

## O que estava errado

**1. O banco recusava o código.**
A chave PIX cadastrada é um telefone e estava sendo gravada como 11 dígitos secos
(`11988887777`). No BR Code, uma chave do tipo telefone precisa ir no formato do
cadastro do Banco Central: `+55` + DDD + número. Como ia sem o `+55`, o app do
banco não encontrava a chave e mostrava "código inválido".

Junto com isso, o código carregava a descrição dentro do campo da conta do
recebedor (subcampo `02` da tag 26). Vários bancos recusam esse subcampo em PIX
estático. Foram as duas coisas ao mesmo tempo — a mudança de nome na
configuração **não** teve relação com o problema.

**2. O link do pagamento abria a tela de login.**
A lista de rotas públicas do CRM (as que o paciente abre no celular, sem login)
tinha só o `/confirmar/[id]` da confirmação de consulta. O `/pagar/[id]` não foi
acrescentado, então quem clicava no link caía na tela de login. Erro meu na
v47.06 — o próprio comentário no código avisava para incluir rotas novas ali.

**3. O copia e cola vinha grudado no texto.**
Como a instrução e o código iam na mesma mensagem, ao segurar o balão o WhatsApp
copiava tudo junto e o app do banco recusava o que era colado.

## O que mudou

- `lib/AuthContext.tsx`: `/pagar/` entrou na lista de rotas públicas, agora numa
  constante `ROTAS_PUBLICAS` para não esquecer da próxima vez.
- `lib/pixBrCode.ts`: nova função `normalizarChave()`. Telefone vira `+55…`
  automaticamente (aceita `11988887777`, `(11) 98888-7777` ou já com `+55`);
  CPF/CNPJ ficam só com números; e-mail e chave aleatória em minúsculas.
- A descrição saiu de dentro do código PIX. Ela continua aparecendo na mensagem
  do WhatsApp e na página de pagamento, que é onde o paciente de fato lê.
- `app/api/cobranca-pix/route.ts`: o paciente passa a receber **quatro**
  mensagens em sequência — o link, o QR Code, a frase "Se preferir, copie o
  código abaixo e cole no aplicativo do seu banco:" e, **sozinho numa mensagem
  limpa**, o copia e cola.
- `app/settings/pagamentos/page.tsx`: logo abaixo do campo da chave aparece agora
  como ela entra no código (`+5511…`), para conferir antes de cobrar. A prévia de
  R$ 1,00 também passou a usar o tipo da chave.

## Como testar

1. Suba o zip no serviço **crm-obesity** do EasyPanel (não no n8n).
2. Configurações → Cobrança PIX: confira que embaixo da chave aparece
   `No código PIX ela entra como +55...`. Se não aparecer o `+55`, o tipo da
   chave está errado no seletor.
3. Abra o link de uma cobrança **numa janela anônima** — tem que mostrar a página
   de pagamento, não o login.
4. No menu do paciente (use o seu próprio WhatsApp), envie uma cobrança de
   **R$ 1,00**.
5. No celular: o QR deve abrir no app do banco com o nome e o valor certos; e
   segurar a última mensagem → Copiar deve colar um código que o banco aceita.
6. Só depois de pagar esse R$ 1,00 use com paciente.

## Banco de dados

Nenhuma migração nova. O SQL da v47.06 (`cobrancas_pix` + `pix_config`) continua
valendo — se já rodou, não precisa rodar de novo.

## Ainda em aberto

- Não existe conciliação: a cobrança fica como "enviada" e a baixa é conferida no
  extrato. Se quiser, o próximo passo é uma tela de cobranças com baixa manual.
- Cartão de crédito via API do Safra segue para depois.
