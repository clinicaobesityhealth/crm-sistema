# v47.20 — À vista sem acréscimo

Sem SQL novo.

## O que mudou

Nova chave em Configurações → Cobrança: **"Pagamento à vista sem nenhum
acréscimo"**, já ligada. Quem paga em 1x paga exatamente o valor digitado — sem
taxa de cartão e sem antecipação.

| | Antes | Agora |
|---|---|---|
| À vista | R$ 1.042,00 | **R$ 1.000,00** |
| 2x | R$ 1.057,81 | R$ 1.057,81 |
| 6x | R$ 1.103,82 | R$ 1.103,82 |
| 12x | R$ 1.187,58 | R$ 1.187,58 |

## Por que uma chave, e não zerar o campo

Zerar o campo de 1x na tabela **não teria resolvido**. A antecipação é somada por
cima da taxa do cartão: com o campo em zero, o à vista continuaria com 1,97% de
acréscimo, e ninguém perceberia. A chave zera as duas coisas de uma vez.

O campo de 1x fica desabilitado na tela enquanto a chave estiver ligada, para
deixar claro que ele não está em uso.

## Uma observação, não um conselho

Não sou advogado e não vou opinar sobre o enquadramento. Registro só o fato:
a **Lei 13.455/2017** autoriza preço diferente por meio de pagamento — é ela que
permite cobrar menos no Pix que no cartão. E o **art. 52 do CDC** exige, na venda
a prazo, informar o preço à vista, o acréscimo e o total — o que a página do
paciente já faz, mostrando cada opção com valor da parcela e total.

Se a orientação do seu contador ou advogado é não cobrar nada no à vista, a chave
faz exatamente isso. Ela existe para a decisão ser sua e reversível, não minha.
