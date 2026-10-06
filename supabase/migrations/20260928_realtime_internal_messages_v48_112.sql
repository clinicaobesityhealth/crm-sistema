-- v48.112 — Garante que internal_messages (chat interno entre atendentes)
-- está na publicação supabase_realtime.
--
-- POR QUE
-- O popup "Nova mensagem da equipe" (components/InternalChat.tsx) já existe
-- no código — mostra remetente, prévia da mensagem e um botão para abrir o
-- chat e responder — mas depende de um listener `postgres_changes` em
-- INSERT na tabela internal_messages. Sem a tabela na publicação
-- supabase_realtime, o evento nunca chega ao navegador e o popup nunca
-- aparece, o que looks exactly like the feature not existing. A tabela em si
-- não está em nenhuma migração deste repositório (foi criada direto no
-- Supabase antes do controle de versão dos arquivos .sql começar) — este
-- arquivo só garante a publicação, sem mexer na tabela. Pode rodar mais de
-- uma vez: erro de "já existe" é ignorado.
do $$
begin
  alter publication supabase_realtime add table public.internal_messages;
exception when others then null;
end $$;
