# Implantação das reações — v46.23

Esta versão parte integralmente do CRM v46.22 e adiciona reações como metadados,
sem criar registros na tabela `messages`.

## Ordem de implantação

1. Execute `supabase/migrations/20260803_message_reactions_v46_23.sql` no Supabase.
2. Importe e ative `n8n/CRM - REAGIR MENSAGEM WHATSAPP - v46.23.json`.
3. Substitua o flow principal pelo arquivo
   `n8n/CRM - PRINCIPAL - v46.23-REACOES.json`, preservando as credenciais do n8n.
4. Publique o CRM deste pacote.
5. Faça os testes de aceite abaixo em uma conversa de teste.

## Testes de aceite

- Paciente reage a uma mensagem: o emoji aparece sem nova mensagem no CRM.
- Paciente troca o emoji: o anterior é substituído.
- Paciente remove o emoji: ele desaparece no CRM.
- Atendente reage a mensagem recebida e enviada: a reação aparece no WhatsApp e no CRM.
- Atendente clica no mesmo emoji novamente: a reação é removida.
- Em todos os casos, a conversa não muda de fila/status, a última mensagem permanece
  igual e a Sofia não responde.

## Decisões técnicas

- Chave de vínculo: `messages.id` + `messages.external_id`.
- Uma reação atual por ator em cada mensagem; `upsert` implementa troca e `DELETE`
  implementa remoção.
- A tabela `message_reactions` é separada de `messages`, portanto os gatilhos e
  assinaturas que alimentam a Sofia e a lista de conversas não recebem reações.
- A gravação de reações é feita pelo n8n com a chave de serviço. O navegador tem
  apenas leitura autenticada e recebe atualizações pelo Supabase Realtime.

## Observação operacional

O flow principal fornecido é a cópia completa da versão de referência recebida,
com alteração apenas no nó de roteamento dos eventos da Evolution. Antes de ativar,
confirme no n8n que a instância Evolution usada continua sendo `recados` e que as
credenciais importadas estão associadas corretamente.
