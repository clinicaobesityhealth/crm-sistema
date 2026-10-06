# v47.15 — Taxas do contrato, antecipação e parcelamento travado

Complementa a v47.14 (que trouxe a cobrança no cartão). **Se você ainda não rodou
o SQL da v47.14, rode antes de subir este zip.** Não há SQL novo aqui.

## 1. As taxas já vêm preenchidas

A tela de Configurações → Cobrança abre com as taxas do **seu** contrato, coluna
**online** — não a da maquininha física. Basta conferir e salvar.

Um detalhe que contraria a intuição e vale registrar: **online, a AMEX não é a
mais cara em tudo**. De 7 a 12 parcelas quem pesa mais é a ELO.

| Faixa | AMEX | ELO | Visa/Master | Usada |
|---|---|---|---|---|
| À vista | 2,66% | 2,56% | 2,06% | **2,66%** |
| 2 a 6x | 2,76% | 2,76% | 2,51% | **2,76%** |
| 7 a 12x | 2,96% | **3,26%** | 2,99% | **3,26%** |

Usamos a mais cara de cada faixa porque **a bandeira quem escolhe é o paciente**,
na página do Safra, e o valor do link é fixado antes. A API não tem campo para
restringir bandeira — conferi todos os parâmetros do endpoint. Assim a clínica
nunca recebe menos do que a secretária digitou; quem pagar com Visa ou Master
deixa até R$ 6,56 a mais por R$ 1.000, o que sobra para a clínica.

Se o Safra permitir desabilitar Elo e Amex na sua conta, me avise: troco pelas
taxas de Visa/Master e a conta fica exata.

## 2. A antecipação entrou na conta

Antecipação não é um percentual fixo — custa por tempo de espera. Numa venda em
N parcelas, a primeira chega em 1 mês e a última em N; o prazo médio é (N+1)/2.

Com 1,97% ao mês, por R$ 1.000 que a clínica quer receber:

| Parcelas | Prazo médio | Cartão | Antecipação | Efetiva | Paciente paga |
|---|---|---|---|---|---|
| 1x | 1,0 mês | 2,66% | 1,97% | 4,63% | R$ 1.048,55 |
| 2x | 1,5 mês | 2,76% | 2,96% | 5,71% | R$ 1.060,61 |
| 6x | 3,5 meses | 2,76% | 6,89% | 9,65% | R$ 1.106,87 |
| 12x | 6,5 meses | 3,26% | 12,80% | 16,06% | R$ 1.191,40 |

Repare que em 12x a antecipação sozinha responde por quase 13 dos 16 pontos. Ela
pesa muito mais que a taxa do cartão.

**O campo é editável.** Está com 1,97% ao mês e uma chave para desligar a
antecipação. Quando você confirmar com o Safra se é ao mês ou única sobre a
venda, ajusta ali — se for única, 12x cai de 16% para cerca de 5%.

## 3. Parcelamento travado quando há repasse

Este era um furo da v47.14. O link ia com um *máximo* de parcelas, e quem escolhe
o parcelamento é o paciente, na página do Safra. Se a cobrança fosse calculada
para 2x e o paciente escolhesse 12x, a taxa maior sairia do caixa da clínica.

Agora, com o repasse ligado, o link vai **travado** no parcelamento escolhido
pela secretária (`installmentNumber` em vez de `maxInstallmentNumber`). A tela
avisa isso, e a mensagem ao paciente diz "em 6x", não "em até 6x".

Com o repasse desligado, o máximo volta a valer — a taxa é da clínica de qualquer
jeito, e dar liberdade de parcelamento só ajuda a fechar.

## Como testar

1. Configurações → Cobrança: confira as taxas e a antecipação. Salve.
2. Na simulação de R$ 1.000 da própria tela, confira se os números batem com a
   tabela acima.
3. Envie uma cobrança no cartão para o seu WhatsApp, em homologação.
4. Abra o link: a página do Safra deve mostrar o valor com o acréscimo e o
   parcelamento fixo.
