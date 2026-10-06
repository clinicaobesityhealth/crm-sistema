-- v46.59 — Preparação para futura migração Evolution -> WAHA
--
-- Este migration é 100% aditivo e não altera nenhum comportamento existente:
-- apenas cria colunas novas (todas opcionais / com default seguro) na tabela
-- clinic_settings para guardar a configuração de uma instância WAHA de
-- preparação (padrão: "obesitycrm"). Os fluxos do n8n continuam usando a
-- Evolution normalmente até serem atualizados manualmente no dia da migração.
--
-- IMPORTANTE: aplique este SQL no Supabase ANTES de publicar o deploy do CRM
-- que acompanha esta versão (a tela de Configurações > WhatsApp passa a
-- selecionar estas colunas; se elas não existirem, a tela quebra).

alter table clinic_settings
  add column if not exists waha_url text;

alter table clinic_settings
  add column if not exists waha_key text;

alter table clinic_settings
  add column if not exists waha_instance text default 'obesitycrm';
