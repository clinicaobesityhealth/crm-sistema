-- v48.98 — Corrige "scheduled_messages_origin_check": faltava 'cirurgia'.
--
-- Rode antes/independente da v48.97. Pode rodar mais de uma vez.
--
-- BUG (não é do PausaMed nem de hoje): desde a v48.07, o gatilho de cirurgias
-- grava origin = 'cirurgia' em scheduled_messages (pré-operatório, pós-
-- operatório, retorno). Mas a constraint que valida esse campo nunca foi
-- atualizada para aceitar esse valor — só aceitava o que já existia antes
-- (confirmação de consulta, manual, broadcast). Toda cirurgia com paciente do
-- CRM + data marcada, ao entrar numa situação que dispara um desses modelos
-- "de rotina" (não os que viram aviso — esses vão para cirurgia_avisos, outra
-- tabela), quebrava aqui. É o erro "new row for relation scheduled_messages
-- violates check constraint scheduled_messages_origin_check".
--
-- A correção: reconstruir a constraint com todos os valores que o CRM usa de
-- verdade hoje (levantado no código, não só o que a constraint original tinha).

alter table public.scheduled_messages drop constraint if exists scheduled_messages_origin_check;

alter table public.scheduled_messages add constraint scheduled_messages_origin_check
  check (origin in (
    'appointment_confirmation',  -- lembrete/confirmação de consulta (v46.49 e segs.)
    'manual',                    -- mensagem agendada à mão (agenda, inbox)
    'broadcast',                 -- disparo em massa
    'retorno_followup',          -- acompanhamento de retorno (ConversationSidePanel)
    'cirurgia'                   -- pré-operatório, pós-operatório, retorno de cirurgia (v48.07+)
  ));

notify pgrst, 'reload schema';
