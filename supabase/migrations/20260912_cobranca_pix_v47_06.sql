-- v47.06 — Cobrança PIX enviada pelo CRM
--
-- O CRM passa a gerar o "Pix Copia e Cola" (BR Code) por conta própria, sem
-- depender do site do meuairgo. Esta tabela guarda o histórico: quanto foi
-- cobrado, de quem, por quem e quando — o que hoje não existe em lugar nenhum.
--
-- Rode no SQL Editor do Supabase. É seguro rodar mais de uma vez.

create table if not exists public.cobrancas_pix (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  valor numeric(10,2) not null check (valor > 0),
  descricao text,
  brcode text not null,              -- o copia e cola gerado
  qr_url text,                       -- imagem do QR no storage
  status text not null default 'enviada',  -- enviada | paga | cancelada
  criado_por uuid references public.agents(id),
  criado_por_nome text,
  created_at timestamptz not null default now(),
  pago_em timestamptz,
  baixa_por uuid references public.agents(id),
  baixa_por_nome text
);

create index if not exists cobrancas_pix_contact_idx on public.cobrancas_pix (contact_id, created_at desc);
create index if not exists cobrancas_pix_status_idx on public.cobrancas_pix (status, created_at desc);

alter table public.cobrancas_pix enable row level security;

-- Mesma política das outras tabelas do CRM: quem está autenticado no app enxerga.
drop policy if exists cobrancas_pix_todos on public.cobrancas_pix;
create policy cobrancas_pix_todos on public.cobrancas_pix
  for all using (true) with check (true);

-- A chave PIX e os dados do recebedor ficam em clinic_settings.pix_config,
-- preenchidos pela tela Configurações -> Cobrança PIX. Não ficam no código.
alter table public.clinic_settings add column if not exists pix_config jsonb default '{}'::jsonb;

comment on table public.cobrancas_pix is 'Cobranças PIX geradas e enviadas pelo CRM (v47.06)';
