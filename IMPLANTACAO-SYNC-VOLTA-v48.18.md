# v48.18 — A volta: o CRM escreve na planilha

**1.** Suba o zip (o CRM mudou).
**2.** Reimporte `CRM - SINCRONIZAR CIRURGIAS - v48.08.json` no n8n.
**3.** Execute — **em simulação**. Nada é escrito ainda.
**4.** Confira a prévia. Só então ligue a escrita.

## Antes de tudo: a coluna AE

Na aba **CIRURGIAS**, escreva na célula **AE2** o título `CRM_ID`.

É onde o CRM grava o identificador de cada cirurgia, e é por ele que os dois
lados se reconhecem. Vai no fim de propósito: nenhuma coluna existente se
desloca, nenhuma fórmula da contabilidade quebra.

Se preferir, pode deixar a coluna oculta depois — ela é só para a máquina.

## A regra que protege a planilha

**O CRM não escreve a linha inteira.** Ele escreve só as colunas que são dele;
todas as outras são copiadas da própria planilha, célula por célula, como
estão.

Ficam **intocadas**:

| Coluna | Por quê |
|---|---|
| A — Carimbo | é do formulário, e é dele que a regra dos 30 dias conta |
| B — Alertas | fórmula da planilha |
| P — Foto da descrição | anexo posto à mão |
| U — Log da agenda | escrito pelo script do Google Agenda |
| V — Link forms | do formulário |
| W — Cartas geradas | do script de cartas, enquanto ele existir |
| AD — Agendamento de mensagem | resquício do fluxo antigo |

Sem essa separação, a primeira sincronização apagaria tudo isso de uma vez.

## Duas proteções a mais

**Linha que não mudou não é tocada.** O fluxo compara campo a campo e só grava
onde há diferença. Uma rodada em que nada mudou não escreve nada — e isso
importa, porque o fluxo roda a cada 15 minutos.

**Realizadas e canceladas não voltam para a CIRURGIAS.** As 30 importadas
daquelas abas têm número de linha de *outra* aba. Escrever por esse número na
CIRURGIAS sobrescreveria a linha errada, em silêncio. Elas ficam onde estão; só
voltam para a planilha as que vieram da CIRURGIAS e as que nascerem no CRM.

## O modo simulação

No alto do nó **Montar escrita** há uma linha:

```js
const ESCREVER_NA_PLANILHA = false;
```

Com `false`, o fluxo faz tudo **menos gravar**. O nó Resumo mostra:

- `ESCREVEU_NA_PLANILHA: false`
- `linhas_a_atualizar` e `linhas_a_incluir`
- `previa_das_mudancas` — linha por linha, com **de** e **para** de cada célula

Leia essa prévia com calma. Quando ela estiver do jeito que você espera, troque
para `true` e publique.

## O que eu testei

Simulei a mescla com uma linha real da sua planilha:

- carimbo, alertas, log da agenda e cartas geradas — **preservados**
- situação mudada no CRM — **atualizada** na planilha
- linha sem nenhuma diferença — **ignorada**, nenhuma escrita
- cirurgia nascida no CRM — **incluída** completa, com carimbo e identificador

## Depois disso

A planilha passa a ser alimentada pelo CRM sozinha, a cada 15 minutos, e a
contabilidade continua lendo a aba CIRURGIAS como sempre leu. Você lança no
CRM; a planilha acompanha.

Falta então só a última etapa: as cartas.
