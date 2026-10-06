# v48.13 — Importar também REALIZADAS e CANCELADAS

**1.** Suba o zip (tem uma correção no CRM).
**2.** Importe de novo o fluxo `CRM - SINCRONIZAR CIRURGIAS - v48.08.json` no n8n
— ele mudou.
**3.** Execute.

## A conferência que eu tinha prometido

Antes de importar às cegas, comparei o layout das três abas. Resultado:

**As colunas estão na mesma ordem nas três.** Mesma posição para nome,
telefone, data, situação, cirurgia, hospital, cirurgião, valores — tudo.

A única diferença está na coluna N: em CIRURGIAS ela é
"ENVIADO MSG PREOP >30 DIAS"; nas outras duas é "COLUNA DISPONIVEL NAO MOVER".
Como nessas abas ela está vazia, a importação simplesmente não marca nada ali.
Sem efeito.

**As situações também batem:** todas as 16 linhas de REALIZADAS estão como
"CIRURGIA REALIZADA" e todas as 18 de CANCELADAS como "CANCELADA" — dois nomes
que já existem no cadastro do CRM, com as categorias certas. Elas vão cair
direto nos filtros Realizadas e Canceladas.

## O que mudou

**O fluxo lê as três abas numa chamada só** e manda tudo junto, marcando de
qual aba cada linha veio.

**Rede de proteção no CRM:** se alguma situação vier escrita de um jeito que o
cadastro não reconhece, a **aba de origem** decide a categoria. Sem isso, uma
cirurgia realizada com a situação grafada diferente cairia na lista de "em
andamento" e ficaria lá para sempre, sem ninguém notar.

## O que esperar no Resumo

- `linhas_lidas_na_planilha`: por volta de **38** (4 + 16 + 18)
- `cirurgias_criadas_no_crm`: por volta de **34**
- `ja_existiam_ignoradas`: **4** — as de CIRURGIAS, que já entraram antes

Se `criadas` vier bem menor que 34, me avise com os erros.

## Um detalhe honesto sobre duplicatas

O CRM reconhece uma cirurgia já conhecida por **nome + data**. Se o mesmo
paciente tiver uma linha em CANCELADAS e outra em CIRURGIAS com a **mesma
data** — caso de cirurgia cancelada e remarcada para o mesmo dia — só a
primeira entra, e a segunda é ignorada.

Como as de CIRURGIAS já estão no CRM, elas têm precedência: a versão ativa
vence, e o registro de cancelamento daquele dia não entra. É a escolha certa
entre as duas, mas vale saber que existe. Se achar alguma assim, dá para
lançar à mão.
