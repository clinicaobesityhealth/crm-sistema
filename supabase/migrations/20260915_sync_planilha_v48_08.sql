-- v48.08 — Sincronização com a planilha CIRURGIAS OBESITY.
--
-- Rode depois da v48.07. Pode rodar mais de uma vez.
--
-- A regra combinada: o CRM é o dono. Linha nova que aparece na planilha (vinda
-- do formulário que o médico preenche) é adotada pelo CRM e, a partir daí, é o
-- CRM que manda nela. Nada que já existe no CRM é sobrescrito pela planilha.
--
-- A linha NÃO muda de aba. A contabilidade lê a aba CIRURGIAS, então cirurgia
-- realizada e cancelada continuam lá, com a situação dizendo o que houve. Mover
-- linha entre abas é justamente onde sincronização quebra.

-- Identidade estável entre os dois lados. A planilha ganha uma coluna com este
-- id; sem ele o casamento dependeria do número da linha, que muda toda vez que
-- alguém insere ou apaga uma linha no meio.
alter table public.cirurgias add column if not exists planilha_uuid uuid;
alter table public.cirurgias add column if not exists planilha_aba text;
alter table public.cirurgias add column if not exists sincronizado_em timestamptz;

-- Carimbo original do formulário. Na planilha é a coluna A, e é dele que a
-- regra das pendências de 30 dias conta o prazo — por isso precisa vir junto na
-- carga inicial, em vez de todas as cirurgias nascerem com a data de hoje.
alter table public.cirurgias add column if not exists carimbo_origem timestamptz;

create unique index if not exists idx_cirurgias_planilha_uuid
  on public.cirurgias (planilha_uuid) where planilha_uuid is not null;

-- Toda rodada de sincronização deixa registro: quantas linhas entraram, quantas
-- voltaram, o que falhou. Sem isso, "a planilha está desatualizada" vira
-- investigação às cegas.
create table if not exists public.cirurgia_sync_log (
  id uuid primary key default gen_random_uuid(),
  direcao text not null,              -- 'importar' | 'exportar'
  recebidas integer not null default 0,
  criadas   integer not null default 0,
  ignoradas integer not null default 0,
  devolvidas integer not null default 0,
  erros jsonb,
  duracao_ms integer,
  created_at timestamptz not null default now()
);

alter table public.cirurgia_sync_log enable row level security;
drop policy if exists "cirurgia_sync_log_leitura" on public.cirurgia_sync_log;
create policy "cirurgia_sync_log_leitura" on public.cirurgia_sync_log
  for select to authenticated using (true);

create index if not exists idx_cirurgia_sync_log_data on public.cirurgia_sync_log (created_at desc);
