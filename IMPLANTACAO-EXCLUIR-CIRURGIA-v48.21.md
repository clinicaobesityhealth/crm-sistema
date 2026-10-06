# v48.21 — Excluir cirurgia, e por que reimportar não trazia de volta

**Sem SQL.** É só subir o zip.

## O que realmente aconteceu

Fui ver as execuções do n8n. A última leu **35 linhas** — antes eram 38. Ou
seja: **as 3 linhas que você apagou saíram da planilha, não do CRM.**

E as 35 restantes vieram todas como `ja_existiam_ignoradas: 35`. Isso confirma
que **o CRM continua com todas as cirurgias**, inclusive as duplicadas.

Por isso reimportar não trouxe nada: o CRM reconhece o que já conhece e ignora.
Ele estava funcionando como combinado — o problema é que faltava a peça do
outro lado.

## A peça que faltava: excluir

Não havia como apagar uma cirurgia no CRM. Sem isso, um lançamento duplicado ou
errado ficava para sempre, e reimportar nunca ia resolver.

Agora, ao abrir uma cirurgia, há um **botão vermelho de lixeira** no rodapé.
Pede confirmação duas vezes, porque somem junto o histórico de situações e as
mensagens ainda não enviadas.

**Depois de apagar no CRM, reimportar traz de volta** — desde que a linha ainda
exista na planilha.

Atenção às 3 linhas que você apagou da planilha: essas não voltam por
sincronização, porque a origem sumiu. Se foram apagadas por engano, dá para
recuperar pelo histórico de versões do Google Planilhas (Arquivo → Histórico de
versões).

## Sobre a Maria Juliana

Olhei a linha dela na REALIZADAS. Está completa — o que pode ter estranhado:

- **coluna M (ajuste de valor) = 🤝** — é um emoji onde o CRM espera número,
  então o ajuste entrou como zero
- **coluna AC (pago) = 💵** — emoji também; o CRM entendeu como "pago", que
  está certo
- prévia R$ 20.540 e cobrado R$ 15.800 vieram normalmente

Se o que ficou errado na tela dela foi outra coisa, me diga qual campo que eu
olho direto.

## Um problema que achei sozinho e corrigi

Quatro linhas de REALIZADAS têm **mais de uma cirurgia na mesma célula**:
"BP, HH, BX HEPÁTICA", "HIEr, HINCISIONALr, HU", "HU, HIB", "CCC, HU".

Nenhuma dessas combinações existe como sigla cadastrada, então elas entraram
**sem procedimento vinculado** — sem valores de tabela, sem materiais, sem
TUSS. Silenciosamente.

Duas mudanças:

**Na importação**, quando a célula traz várias siglas, o CRM casa a **primeira
que reconhece** e guarda o texto inteiro. Assim a cirurgia principal traz
valores e TUSS, e ninguém perde de vista que houve mais de uma.

**No cartão da lista**, sigla que não corresponde a nenhuma cirurgia cadastrada
aparece em **âmbar com um ⚠**. Melhor gritar do que fingir que está certo.

## Duas respostas rápidas

**"O CRM_ID não preencheu na planilha"** — correto, e é esperado: a escrita
ainda está em **simulação** (`ESCREVER_NA_PLANILHA = false`). Nada é gravado na
planilha, nem o identificador. Ele só aparece quando você ligar a escrita.

**"Mudei o valor do Wladimir na planilha e o CRM não mudou"** — isso não é
falha, é a regra que combinamos: **o CRM é o dono**. A planilha só serve para
trazer cirurgias que o CRM ainda não conhece; linha já conhecida é ignorada na
entrada. Editar na planilha não muda o CRM — e, quando a escrita for ligada, o
CRM vai gravar o valor dele por cima do que você digitou lá.

**A partir de agora, edite no CRM.** A planilha é a cópia, não o original.

Se preferir que a planilha também possa corrigir o CRM, dá para fazer — é a
"mão dupla" que a gente descartou no início, e o motivo continua valendo: com os
dois lados podendo escrever, duas pessoas editando ao mesmo tempo fazem uma
sobrescrever a outra sem aviso.
