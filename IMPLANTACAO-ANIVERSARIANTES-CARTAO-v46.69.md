# Implantação v46.69 — Cartões menores na página de Aniversariantes

## O que mudou

Na página "Aniversariantes do dia":

- Os cartões ficaram menores (grade com mais colunas: 2 no celular, até 4
  em telas largas, em vez de só 2 fixas).
- A imagem agora aparece inteira, no formato vertical 9:16 do cartão, sem
  cortar as bordas (antes a foto era cortada pra caber num quadro
  horizontal).
- Ao clicar na imagem do cartão, ela abre grande, centralizada na tela
  (clique fora ou no X pra fechar).

## Teste sugerido

Abra "Aniversariantes do dia" com pelo menos um cartão já enviado: os
cartões devem aparecer menores e lado a lado, mostrando a imagem inteira
(sem cortar), e clicar na imagem deve abrir ela em tamanho grande.

## Observação

Este pacote também inclui as correções de build já testadas antes (v46.66,
v46.67, v46.68) — algumas variáveis de ambiente e a pasta `public/` foram
reconstruídas aqui do zero porque o workspace foi reiniciado, mas testei o
`npm run build` de novo do início e tudo passou certinho.
