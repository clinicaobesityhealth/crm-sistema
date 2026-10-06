# Implantação — confirmação automática de consultas v46.49

## O que foi preservado

- Os fluxos atuais de agendar, cancelar, remarcar e sincronizar paciente não tiveram sua lógica alterada.
- A configuração global e a pausa individual da Sofia continuam sendo a autoridade para decidir se ela responde.
- Mensagens manuais programadas continuam funcionando com o status antigo `pending`.

## O que foi acrescentado

- Um gatilho no Supabase cria o lembrete quando qualquer agendamento é criado ou atualizado na tabela `agendamentos`, independentemente de ter vindo do CRM ou do MedX.
- O padrão é 1 dia antes às 10:00 e pode ser alterado ou desativado em **Configurações → Agenda**.
- Consultas criadas depois do horário configurado não geram envio retroativo; a próxima sincronização não causa disparo tardio.
- A chave idempotente identifica o tipo `confirmar_consulta`, o ID MedX (ou ID interno) e a versão de data/hora. Um índice parcial garante no máximo uma confirmação ativa por consulta, inclusive sob concorrência.
- Ao mudar data, hora ou médico, o lembrete anterior vira `superseded` e um novo é criado.
- Ao cancelar antes do envio, o lembrete vira `cancelled`.
- O disparo salva o ID retornado pela Evolution em `message_id`, registra a mensagem no histórico e coloca o contato em `pending`, sem responsável e no setor cujo nome contenha "secret".
- A Sofia fica sem pausa individual, mas continua respeitando integralmente o liga/desliga global e o modo de atendimento configurado.

## Ordem segura de implantação

1. Faça export dos workflows ativos atuais no n8n e um backup do banco.
   Na conferência de 10/08/2026, os workflows `CRM - PRINCIPAL - v46.49-CONFIRMACAO-CONSULTAS`, `CRM - Mensagens Agendadas - v46.49-CONFIRMACAO-CONSULTAS`, `Sync MedX -> Agendamentos (Secretaria)` e `Sync MedX -> Supabase (Agenda)` já estavam publicados.
2. Execute no Supabase SQL Editor a migração `supabase/migrations/20260810_consulta_confirmation_reminders_v46_49.sql`.
   A carga inicial cria somente lembretes cujo horário ainda está no futuro; mensagens vencidas não são disparadas retroativamente.
3. Confirme na Agenda do CRM que os lembretes futuros apareceram como **Programadas**. Ainda não substitua workflows se os registros não aparecerem.
4. Não crie cópias dos workflows. Se os dois workflows v46.49 acima continuam publicados, mantenha-os. Use os JSONs do pacote apenas para substituir uma versão divergente ou restaurar um backup.
5. Mantenha os dois sincronizadores MedX existentes: o gatilho do banco atua sobre qualquer inclusão/alteração feita por eles em `agendamentos`.
6. Deixe `CRM - Lembrete de Consulta` desativado: ele é o lembrete antigo baseado em planilha e ativá-lo junto pode duplicar mensagens. Preserve `AVISO DE CONSULTAS AGENDADAS`, que é um aviso separado para equipe/profissionais.
7. Suba o ZIP do CRM v46.49 no EasyPanel.

## Testes obrigatórios

1. Crie uma consulta de terça-feira: deve surgir um lembrete para segunda às 10:00.
2. Altere dias/horário em Configurações → Agenda, crie outra consulta e confira o novo horário.
3. Sincronize novamente o mesmo agendamento: não deve surgir duplicidade.
4. Altere data, hora ou médico: o anterior deve ficar `superseded` e o novo, `scheduled`.
5. Cancele antes do envio: o lembrete deve ficar `cancelled` e não ser enviado.
6. Dispare um teste controlado: deve ficar `sent`, registrar `message_id`, aparecer no histórico e colocar o paciente em Pendentes/Secretaria.
7. Desative a Sofia globalmente e responda ao lembrete: a Sofia não deve responder.
8. Ative a Sofia globalmente e responda com confirmação, cancelamento e pedido de nova data, validando cada caminho.

## Reversão

Se for necessário interromper a automação imediatamente, desative o workflow de mensagens programadas e execute:

```sql
drop trigger if exists trg_sync_consulta_confirmation_reminder on public.agendamentos;
```

Depois, restaure os dois exports anteriores do n8n. Os campos acrescentados podem permanecer no banco sem afetar a versão anterior.
