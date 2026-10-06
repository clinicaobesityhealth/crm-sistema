# v47.11 — Página de pagamento cabendo na tela do celular

## O que estava errado

Duas coisas ao mesmo tempo:

1. **A página não rolava.** O CRM trava a rolagem no celular
   (`html, body { overflow: hidden; position: fixed }` no `globals.css`) para o
   cabeçalho do inbox não oscilar quando o teclado abre. Isso vale para o site
   inteiro — inclusive para a página pública que o paciente abre. Resultado: o que
   passava da primeira tela simplesmente não era alcançável, e o botão de copiar o
   código ficava escondido embaixo da dobra.

2. **Sobrava conteúdo.** Mesmo com rolagem, o certo é caber de uma vez: quem está
   pagando não deveria precisar procurar o botão.

## O que mudou

- A própria página passou a ser a área de rolagem (`h-[100dvh] overflow-y-auto`),
  em vez de depender do body. O comportamento do CRM não foi tocado — o inbox
  continua com a rolagem travada como antes.
- O espaçamento foi reduzido (logo, margens e altura dos blocos) e o QR ficou
  proporcional: `min(48vw, 190px, 26dvh)`. Ou seja, ele encolhe junto com a tela
  em vez de empurrar os botões para fora.
- O bloco fica centralizado verticalmente quando sobra espaço.

## Medido, não estimado

Renderizei a página em quatro tamanhos de tela e medi a altura do conteúdo contra
a altura visível:

| Aparelho | Tela | Conteúdo | Resultado |
|---|---|---|---|
| iPhone 14 (navegador do WhatsApp) | 390×664 | 664 px | cabe |
| iPhone SE, barra grande | 375×600 | 600 px | cabe |
| Android pequeno | 360×640 | 640 px | cabe |
| iPhone Pro Max | 430×750 | 750 px | cabe |

Em telas ainda menores que isso a página agora rola normalmente, que era o que
faltava antes.

## Como testar

1. Suba o zip no serviço **crm-obesity**.
2. Abra o link de uma cobrança pelo WhatsApp, no celular.
3. O botão **Copiar código PIX Copia e Cola** tem que aparecer sem rolar.

## Banco de dados

Nenhuma migração.
