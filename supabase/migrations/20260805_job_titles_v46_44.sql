-- v46.44: cadastro de cargos (job_titles), pra Configurações -> Cargos
-- funcionar como lista fixa (igual "Setores" já funciona) em vez de texto
-- livre no cadastro de atendente -- evita erro de digitação (ex: "Médico"
-- vs "Médico(a)", que hoje coexistem nos dados reais).
--
-- Não força integridade referencial em agents.job_title (permanece texto
-- livre na coluna, sem FK) para não quebrar nada que já exista -- a tela
-- de cadastro/edição de atendente passa a oferecer só os valores desta
-- tabela como opção, o texto livre no banco continua funcionando como
-- sempre funcionou pros valores já gravados.

create table if not exists public.job_titles (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default '00000000-0000-0000-0000-000000000001',
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists job_titles_name_unique on public.job_titles (lower(name));

-- Semeia com os valores que já existem de verdade nos dados (evita qualquer
-- atendente cadastrado hoje "sumir" da lista ao trocar pra dropdown) mais
-- alguns cargos comuns de clínica já prontos pro Jorge editar depois.
insert into public.job_titles (name)
select distinct trim(job_title) from public.agents
where job_title is not null and trim(job_title) <> ''
on conflict do nothing;

insert into public.job_titles (name) values
  ('Médico(a)'),
  ('Secretária'),
  ('Secretário'),
  ('Nutricionista'),
  ('Administrador(a)'),
  ('Recepção')
on conflict do nothing;
