# v47.05 — Assistente de IA do composer parava de sugerir depois da primeira vez

## Sintoma

No Inbox, o botão do **Assistente de IA** ("Melhorar sua mensagem") funcionava na
primeira vez e, nas aberturas seguintes, mostrava a caixa de sugestão **em branco**,
com os botões "Anterior" e "Refazer" visíveis. Não aparecia mensagem de erro.

## Causa

O n8n estava certo: as quatro chamadas ao fluxo `CRM - IA Sugestoes Composer`
retornaram `sucesso: true` com uma sugestão cada. O problema era só no CRM.

A tela guardava a lista de sugestões e o índice da que está sendo exibida em
**dois estados separados**:

```js
const [aiImproveHistory, setAiImproveHistory] = useState([])
const [aiImproveIndex, setAiImproveIndex] = useState(-1)
```

`openAiModal()` zerava os dois e chamava `fetchAiImprove()` na sequência. Como
atualização de estado no React é assíncrona, a função ainda enxergava o índice
**antigo**:

```js
setAiImproveHistory(h => [...h.slice(0, aiImproveIndex + 1), nova]) // lista fica com 1 item
setAiImproveIndex(aiImproveIndex + 1)                               // índice vira 1
```

- 1ª abertura: índice anterior = -1 → vira 0 → `lista[0]` existe → funciona.
- 2ª em diante: índice anterior = 0 → vira 1, mas a lista tem 1 item → `lista[1]`
  é `undefined` → caixa em branco.

Por isso "funcionou uma vez e falhou nas três seguintes".

## Correção

Lista e índice passaram a viver num **único estado**, então não têm como discordar:

```js
const [aiImprove, setAiImprove] = useState<{ list: string[]; i: number }>({ list: [], i: -1 })
...
setAiImprove(s => { const list = [...s.list.slice(0, s.i + 1), nova]; return { list, i: list.length - 1 } })
```

O mesmo valia para o "Perguntar à IA como devo responder", que tinha exatamente o
mesmo par de estados — corrigido junto.

## Arquivo alterado

- `app/inbox/page.tsx`

## Implantação

Subir o zip no Easypanel (serviço **crm-obesity**). Sem migração de banco.
