# v47.03 — Painel MedX: consulta duplicada e destaque errado

Caso real: paciente **Johan Carlos**. O painel mostrava **três** agendamentos para
**duas** consultas reais, e destacava a de **21/09** quando a próxima era a de **02/09**.

## Causa 1 — o destaque não era o próximo

A tela monta assim (`components/ConversationSidePanel.tsx`):

```tsx
data.agendamentos[0]          // destaque
data.agendamentos.slice(1)    // lista "Outros"
```

O destaque era simplesmente **o primeiro item que o MedX devolveu** — não existia
ordenação por data em lugar nenhum. Por isso a consulta mais distante podia aparecer
em destaque e a mais próxima cair em "Outros".

## Causa 2 — a duplicação

A deduplicação existente comparava pelo `medx_agendamento_id`:

```tsx
const chave = a.medx_agendamento_id || `${a.data}|${a.hora}|${a.profissional_id || ...}`
```

No caso do Johan, o MedX devolveu **a mesma consulta de 21/09 duas vezes, com ids
diferentes** — e até com modalidades divergentes (uma PRESENCIAL, outra ONLINE). Como
os ids eram diferentes, as duas passavam pela dedup.

## O que mudou

1. **Dedup também por data + hora + profissional.** O mesmo paciente não pode ter duas
   consultas com o mesmo profissional no mesmo horário — quando isso aparece, é
   duplicidade da origem. Entre as duas, permanece a mais completa (a que tem id do
   MedX e/ou status de confirmação).

2. **Ordenação por data/hora crescente**, feita antes de a tela dividir entre destaque
   e "Outros". O destaque passa a ser sempre a consulta mais próxima.

Nenhuma outra parte do arquivo foi alterada: o destaque continua usando
`agendamentos[0]` e a lista continua usando `slice(1)` — a diferença é que agora a
lista chega ordenada e sem repetição.

## Resultado no caso do Johan

Antes:

```
PRÓXIMO AGENDAMENTO   21/09/2026 14:00   (PRESENCIAL)
Outros (2)            02/09/2026 14:00
                      21/09/2026 14:00   (ONLINE)   <- mesma consulta repetida
```

Depois:

```
PRÓXIMO AGENDAMENTO   02/09/2026 14:00
Outros (1)            21/09/2026 14:00
```

## Observação sobre a origem

A duplicidade vem do MedX, não do CRM — o CRM agora apenas a absorve sem exibir errado.
Se isso aparecer com frequência, vale investigar por que o MedX devolve o mesmo
agendamento com dois ids.
