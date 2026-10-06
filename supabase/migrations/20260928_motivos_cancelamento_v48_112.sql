-- v48.112 — Motivos de cancelamento viram lista fixa (Configurações →
-- Cirurgias → Motivos de cancelamento), em vez de texto livre.
--
-- Texto livre não dá estatística: "paciente desistiu", "Paciente desistiu."
-- e "desistência da paciente" são três linhas diferentes num relatório, e o
-- Dashboard de Cirurgias (v48.112) precisa contar motivos de cancelamento
-- de forma confiável. A coluna de texto (motivo_cancelamento) continua
-- existindo — é o que aparece no cartão e no histórico, com o detalhe que a
-- secretária digitar — mas quem alimenta a estatística agora é este id.
--
-- Cirurgia cancelada antes desta versão fica sem motivo_cancelamento_id
-- (só o texto antigo) — o Dashboard soma essas num balde "não categorizado"
-- em vez de quebrar ou inventar uma categoria.

create table if not exists public.cirurgia_motivos_cancelamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  ordem integer not null default 0
);

create unique index if not exists idx_cirurgia_motivos_cancelamento_nome
  on public.cirurgia_motivos_cancelamento (lower(nome));

alter table public.cirurgia_motivos_cancelamento enable row level security;

drop policy if exists "cirurgia_motivos_cancelamento_rw" on public.cirurgia_motivos_cancelamento;
create policy "cirurgia_motivos_cancelamento_rw" on public.cirurgia_motivos_cancelamento
  for all to authenticated using (true) with check (true);

insert into public.cirurgia_motivos_cancelamento (nome, ordem)
select * from (values
  ('Paciente desistiu', 1),
  ('Convênio negou', 2),
  ('Problema clínico/pré-operatório', 3),
  ('Remarcação por indisponibilidade do hospital', 4),
  ('Remarcação por indisponibilidade da equipe', 5),
  ('Falta de documentação', 6),
  ('Outro', 99)
) as novos(nome, ordem)
where not exists (
  select 1 from public.cirurgia_motivos_cancelamento where lower(nome) = lower(novos.nome)
);

alter table public.cirurgias
  add column if not exists motivo_cancelamento_id uuid references public.cirurgia_motivos_cancelamento(id);

comment on column public.cirurgias.motivo_cancelamento_id is
  'Categoria fixa do cancelamento (cirurgia_motivos_cancelamento), para estatística do Dashboard de Cirurgias. motivo_cancelamento (texto) continua sendo o que aparece no cartão/histórico.';

notify pgrst, 'reload schema';
