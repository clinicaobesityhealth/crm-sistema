-- v47.14 — Cobrança no cartão de crédito/débito via Link de Pagamentos da Safrapay.
--
-- Rode este SQL no editor do Supabase ANTES de subir o zip.
-- Ele só cria coisas novas: não altera nem apaga nada que já existe.

-- 1) Registro das cobranças no cartão -----------------------------------------
create table if not exists public.cobrancas_cartao (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,

  -- valor_liquido: o que a clínica quer receber (digitado pela secretária)
  -- valor_total:   o que o paciente paga, já com a taxa do cartão embutida
  valor_liquido numeric(10,2) not null,
  valor_total   numeric(10,2) not null,
  taxa_aplicada numeric(6,3) not null default 0,
  parcelas      integer not null default 1,

  descricao text,
  ambiente  text not null default 'homologacao',

  -- criando | enviada | paga | negada | cancelada | expirada | erro
  status text not null default 'criando',
  erro   text,

  safra_link_id text,
  url text,

  criado_por uuid references public.agents(id) on delete set null,
  criado_por_nome text,
  confirmado_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_cobrancas_cartao_contact on public.cobrancas_cartao(contact_id);
create index if not exists idx_cobrancas_cartao_status  on public.cobrancas_cartao(status);
create index if not exists idx_cobrancas_cartao_link    on public.cobrancas_cartao(safra_link_id);

alter table public.cobrancas_cartao enable row level security;

drop policy if exists "cobrancas_cartao_leitura" on public.cobrancas_cartao;
create policy "cobrancas_cartao_leitura" on public.cobrancas_cartao
  for select to authenticated using (true);

-- A escrita acontece pelo servidor (service role), que não passa por RLS.

-- 2) Eventos crus recebidos da Safrapay ---------------------------------------
-- Guardamos o payload inteiro. No primeiro pagamento real vemos o formato
-- exato e ajustamos a baixa automática com dado na mão, não por suposição.
create table if not exists public.safrapay_eventos (
  id uuid primary key default gen_random_uuid(),
  payload jsonb,
  recebido_em timestamptz not null default now()
);

alter table public.safrapay_eventos enable row level security;

drop policy if exists "safrapay_eventos_leitura" on public.safrapay_eventos;
create policy "safrapay_eventos_leitura" on public.safrapay_eventos
  for select to authenticated using (true);

-- 3) Configuração da Safrapay na configuração da clínica ----------------------
-- Guarda ambiente, Merchant ID, Merchant Token, meios aceitos, e a tabela de
-- taxas por número de parcelas. O token NUNCA vai no código — é digitado na
-- tela de Configurações.
alter table public.clinic_settings add column if not exists safra_config jsonb default '{}'::jsonb;
