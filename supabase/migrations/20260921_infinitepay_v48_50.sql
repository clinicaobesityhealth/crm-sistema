-- v48.50 — InfinitePay como segunda opção de cartão, com chave para escolher.
--
-- Rode ANTES de subir o zip. Pode rodar mais de uma vez.
-- Só ACRESCENTA colunas e uma tabela; não altera nem apaga nada do Safra.

-- 1) Qual empresa de cartão o CRM usa ao cobrar ------------------------------
--    'safra' continua sendo o padrão até alguém trocar na tela de Cobrança.
alter table public.clinic_settings add column if not exists cartao_provedor text not null default 'safra';
alter table public.clinic_settings add column if not exists infinitepay_config jsonb;

do $$ begin
  alter table public.clinic_settings add constraint clinic_settings_cartao_provedor_ck
    check (cartao_provedor in ('safra', 'infinitepay', 'desligado'));
exception when duplicate_object then null; end $$;

-- 2) Cada cobrança lembra por onde foi criada --------------------------------
--    Assim, trocar a chave não bagunça cobranças que já estão na rua: uma
--    cobrança do Safra continua sendo tratada como do Safra até o fim.
alter table public.cobrancas_cartao add column if not exists provedor         text not null default 'safra';
alter table public.cobrancas_cartao add column if not exists infinitepay_slug text;
alter table public.cobrancas_cartao add column if not exists transaction_nsu  text;
alter table public.cobrancas_cartao add column if not exists receipt_url      text;
alter table public.cobrancas_cartao add column if not exists valor_pago       numeric(10,2);
alter table public.cobrancas_cartao add column if not exists parcelas_pagas   integer;
alter table public.cobrancas_cartao add column if not exists forma_pagamento  text;   -- credit_card | pix
alter table public.cobrancas_cartao add column if not exists pago_em          timestamptz;
-- Quando o paciente paga num parcelamento diferente do que foi precificado
-- (na InfinitePay quem escolhe as parcelas é ele, na página deles).
alter table public.cobrancas_cartao add column if not exists divergencia      text;

create index if not exists idx_cobrancas_cartao_provedor on public.cobrancas_cartao(provedor);

-- 3) Avisos crus recebidos da InfinitePay ------------------------------------
create table if not exists public.infinitepay_eventos (
  id uuid primary key default gen_random_uuid(),
  origem text,
  payload jsonb,
  recebido_em timestamptz not null default now()
);

alter table public.infinitepay_eventos enable row level security;

drop policy if exists "infinitepay_eventos_leitura" on public.infinitepay_eventos;
create policy "infinitepay_eventos_leitura" on public.infinitepay_eventos
  for select to authenticated using (true);

notify pgrst, 'reload schema';

select cartao_provedor, infinitepay_config is not null as tem_infinitepay from public.clinic_settings limit 1;
