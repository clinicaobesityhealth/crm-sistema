# v47.14 — Cobrança no cartão (Safrapay), menu de cobrança e finalizar pelo inbox

## ⚠️ Antes de subir o zip: rode o SQL

Abra o editor SQL do Supabase e rode `supabase/migrations/20260913_cobranca_cartao_v47_14.sql`.
Ele **só cria** coisas novas (duas tabelas e uma coluna) — não altera nem apaga nada.

---

## 1. Cobrança no cartão de crédito e débito

O paciente recebe um link e paga numa **página hospedada pelo Banco Safra**.
Nenhum número de cartão passa pelo CRM, pelo servidor ou por mim. O CRM só diz
"cobre R$ X, em até N vezes, com esta descrição" e recebe um endereço para enviar.

**O parcelamento já sai com a taxa calculada.** A secretária digita quanto a
clínica precisa *receber* e o sistema mostra, para cada parcelamento, quanto o
paciente vai pagar e de quanto fica cada parcela.

Uma observação importante sobre a conta, porque é fácil errar: a taxa **não** se
soma por cima do valor. Com 10% de taxa sobre R$ 1.000,00:

| | Conta | Paciente paga | Clínica recebe |
|---|---|---|---|
| Somar por cima (errado) | 1000 + 10% | R$ 1.100,00 | R$ 990,00 |
| Dividir pelo complemento (certo) | 1000 ÷ 0,90 | R$ 1.111,11 | **R$ 1.000,00** |

O sistema usa a segunda. As taxas são as **do seu contrato**, digitadas por você
em Configurações — eu não tenho como saber quais são, e chutar seria errar o
caixa da clínica todo mês.

Repassar a taxa ao paciente é permitido (Lei 13.455/2017) desde que a diferença
seja informada — e ela aparece na tela da secretária e na mensagem do paciente.
Se preferir absorver o custo, basta desligar a chave "Repassar a taxa".

## 2. Onde configurar

**Configurações → Cobrança** (o menu antes se chamava "Cobrança PIX"). Agora tem:

- **PIX** — como antes.
- **Cartão** — ambiente, Merchant ID, Merchant Token, meios aceitos, máximo de
  parcelas, repasse de taxa e a tabela de taxas por parcela.
- **Descrições prontas** — agora cada uma carrega o parcelamento sugerido:
  "Consulta presencial · 2x", "Cirurgia · 12x". Ao escolher a descrição na hora
  da cobrança, o parcelamento já vem certo, e a equipe ainda pode mudar.

O **Merchant Token** é digitado ali, com o campo mascarado. Ele nunca entra no
código nem em conversa.

**Comece em Homologação.** Nesse ambiente nada é cobrado de verdade. A Safrapay
só libera produção depois da homologação aprovada e emite credenciais próprias
para ela — por isso a tela tem o seletor de ambiente.

## 3. Baixa automática

Cadastre no portal Safrapay o endereço de aviso de pagamento:

```
https://crm.obesityhealth.com.br/api/safrapay/webhook
```

Quando o pagamento é aprovado, a Safrapay avisa e a cobrança fica como **paga**
sozinha — algo que hoje nem o PIX tem.

Uma honestidade sobre isso: o formato exato do aviso não está na documentação
pública. Então essa rota **guarda o aviso inteiro** numa tabela e já tenta dar a
baixa pelos identificadores mais prováveis. No primeiro pagamento real a gente
olha o que chegou e, se precisar, eu ajusto com o dado na mão em vez de supor.

## 4. O menu do paciente

PIX e cartão saíram do meio da lista e viraram um **bloco "Cobrança" com fundo
próprio**, logo acima de Bloquear contato e Finalizar atendimento — as duas ações
que envolvem dinheiro, juntas e separadas visualmente do resto.

## 5. Finalizar atendimento direto do inbox

Antes, finalizar exigia assumir a conversa primeiro: a trava dizia "você não está
mais neste atendimento". Agora, quando a conversa está no inbox **sem dono e sem
participante**, qualquer atendente encerra direto — é o caso do número errado, do
vendedor, da mensagem por engano.

A trava continua valendo para conversa que tem dono: ela existe desde o episódio
de 04/08 em que um link de avaliação foi enviado indevidamente, e eu não a
enfraqueci. Nesses encerramentos sem dono, o link de avaliação **não** é oferecido
— não houve atendimento para avaliar.

## Como testar

1. Rode o SQL.
2. Suba o zip no **crm-obesity**.
3. Configurações → Cobrança: ambiente **Homologação**, Merchant ID, Merchant
   Token, marque Débito e Crédito, preencha as taxas do seu contrato. Salve.
4. No menu de um paciente (use o seu WhatsApp), **Cobrança → Enviar no cartão**.
   Confira na tela que o valor que o paciente paga bate com a sua tabela.
5. Abra o link no celular: tem que aparecer a página do Safra com o valor.
6. Teste também **Finalizar atendimento** numa conversa parada no inbox, sem assumir.

## Arquivos

- `lib/safrapay.ts` (novo) — autenticação, criação do link e a conta do repasse
- `app/api/cobranca-cartao/route.ts` (novo)
- `app/api/safrapay/webhook/route.ts` (novo)
- `app/pagamento-confirmado/page.tsx` (novo) — retorno do paciente após pagar
- `app/settings/pagamentos/page.tsx` — PIX + cartão + descrições com parcelas
- `app/inbox/page.tsx` — bloco de cobrança, janela do cartão, finalizar pelo inbox
- `lib/AuthContext.tsx` — nova rota pública
- `supabase/migrations/20260913_cobranca_cartao_v47_14.sql`
