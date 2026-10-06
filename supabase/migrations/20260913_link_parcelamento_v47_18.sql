-- v47.18 — Página própria onde o paciente escolhe o parcelamento.
-- Rode no editor SQL do Supabase antes de subir o zip. Só adiciona colunas.

-- Máximo de parcelas que a secretária liberou para o paciente escolher.
alter table public.cobrancas_cartao add column if not exists max_parcelas integer;

-- Quando o paciente abriu a nossa página e quando escolheu o parcelamento.
alter table public.cobrancas_cartao add column if not exists aberta_em timestamptz;
alter table public.cobrancas_cartao add column if not exists escolhida_em timestamptz;

-- Leitura pública da cobrança é feita pelo servidor (service role), então não
-- é preciso abrir nenhuma política nova aqui.
