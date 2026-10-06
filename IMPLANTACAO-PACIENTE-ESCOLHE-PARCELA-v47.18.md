# v47.18 — O paciente escolhe o parcelamento, com preço exato

## ⚠️ Rode o SQL primeiro

`supabase/migrations/20260913_link_parcelamento_v47_18.sql`. Só adiciona colunas.
Se ainda faltarem os SQLs da v47.14 e v47.17, rode-os antes, nessa ordem.

## Como fica

1. A secretária pergunta a **bandeira** ao paciente e escolhe na janela de
   cobrança, junto com o valor e o máximo de parcelas.
2. O paciente recebe **uma mensagem** com um link nosso.
3. Na nossa página ele vê cada opção já calculada — "À vista R$ 1.042,00",
   "6x de R$ 183,97", "12x de R$ 98,97" — e escolhe a que couber.
4. Só nesse instante o link da Safrapay é criado, com o **valor exato** daquele
   parcelamento, e o paciente é levado para lá para digitar o cartão.

Era o único jeito de ter as duas coisas ao mesmo tempo. O valor do link da
Safrapay é fixo e a taxa depende de quantas vezes o pagador escolhe: criando o
link só **depois** da escolha, cada opção sai pelo preço certo — em vez de
precificar pelo pior caso e fazer quem paga à vista arcar com o acréscimo de quem
parcela em 12x.

## Valores (Visa/Master, antecipação de 1,97% ao mês, R$ 1.000 líquidos)

| | Taxa efetiva | Paciente paga |
|---|---|---|
| À vista | 4,03% | R$ 1.042,00 |
| 2x | 5,46% | R$ 1.057,81 |
| 6x | 9,40% | R$ 1.103,82 |
| 12x | 15,79% | R$ 1.187,58 |

Elo e Amex têm tabela própria, e o preço muda conforme a bandeira escolhida.

## Detalhes de cuidado

- A página **não calcula preço**: as opções vêm prontas do servidor. Valor de
  cobrança não se calcula no navegador do paciente.
- Se o paciente escolher, voltar e abrir o link de novo, ele é mandado para o
  **mesmo** pagamento — não criamos uma segunda cobrança.
- Cobrança já paga mostra "pagamento já concluído" em vez de deixar pagar duas vezes.
- Se a Safrapay falhar na hora da escolha, o paciente vê um recado pedindo para
  tentar de novo, e o erro fica registrado na cobrança para a gente ver.
- A página cabe na tela do celular sem rolar — medi em 390×664, 375×600 e
  360×640. Com 12 opções, a lista rola por dentro e o botão continua à vista.

## Como configurar

Configurações → Cobrança → **"Paciente escolhe o parcelamento (recomendado)"**.

Nas descrições prontas, o número de parcelas passa a ser o **máximo** que o
paciente pode escolher: consulta 2x, cirurgia 12x, como você definiu.

## Como testar

1. Rode o SQL e suba o zip.
2. Marque o modo "Paciente escolhe o parcelamento" e salve.
3. Envie uma cobrança de R$ 100,00 para o seu WhatsApp, bandeira Visa/Master,
   máximo 12x.
4. Abra o link no celular: tem que listar de 1x a 12x com valores diferentes.
5. Escolha 2x e confira: R$ 105,78 no total, R$ 52,89 por parcela.
6. Continue até a página do Safra e veja se o valor bate.
