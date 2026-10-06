# CRM Obesity v46.48 — corrige agendamento duplicado na aba MedX

## Problema

Na aba MedX do atendimento, a mesma consulta às vezes aparecia duas vezes:
uma vez em destaque ("Próximo agendamento") e de novo na lista "Outros",
com a mesma data/hora. Confirmado que no MedX em si só existe uma consulta
— a duplicação acontecia na resposta que o CRM recebe do fluxo que busca no
MedX (webhook `buscar_agendamento`).

## Correção

Em vez de tentar consertar o fluxo do n8n (mais arriscado, é usado pela
Sofia também), a lista de agendamentos agora é deduplicada direto no CRM,
logo depois de vir da busca: se dois itens têm o mesmo
`medx_agendamento_id` (ou, na falta dele, a mesma combinação de
data+hora+profissional), só o primeiro fica. Isso garante que, mesmo se o
MedX ou o fluxo do n8n devolver algo repetido de novo no futuro, o CRM não
mostra a mesma consulta duas vezes.

## Arquivo alterado
- `components/ConversationSidePanel.tsx` (função `buscar()` da aba MedX)
