-- v47.17 — Guarda a bandeira escolhida pela secretária na cobrança do cartão.
-- Rode no editor SQL do Supabase antes de subir o zip. Só adiciona uma coluna.

alter table public.cobrancas_cartao add column if not exists bandeira text;
