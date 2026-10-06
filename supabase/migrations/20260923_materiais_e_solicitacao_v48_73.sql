-- v48.73 — Listas de materiais por cirurgia e a solicitação de procedimento.
--
-- Rode depois da 20260923_cartas_orcamento_v48_69.sql. Pode rodar de novo.
--
-- POR QUE UMA TABELA, E NÃO UM CAMPO
--
-- Hoje cada cirurgia tem UM texto de materiais. Mas a mesma cirurgia tem mais
-- de um padrão: hérnia com tela Parietex e hérnia com tela Bard levam material
-- diferente, e quem escolhe é o cirurgião no dia. Com um campo só, a secretária
-- apagava e reescrevia a lista toda vez — e o que foi apagado não voltava.
--
-- Com listas nomeadas, ela ESCOLHE. O que já estava escrito no campo antigo
-- vira a lista "Padrão", então ninguém perde nada e ninguém precisa redigitar.

create table if not exists public.cirurgia_material_listas (
  id uuid primary key default gen_random_uuid(),
  procedimento_id uuid not null references public.cirurgia_procedimentos(id) on delete cascade,

  nome text not null,                 -- "Padrão", "Com tela Bard", "Robótica"
  itens text not null default '',     -- uma linha por material
  empresas text,                      -- vão junto: a empresa é de quem é o material

  -- A lista que já vem marcada quando a secretária abre a solicitação.
  padrao boolean not null default false,

  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cirurgia_material_listas_proc_idx
  on public.cirurgia_material_listas (procedimento_id, ordem);

alter table public.cirurgia_material_listas enable row level security;
drop policy if exists "cirurgia_material_listas_rw" on public.cirurgia_material_listas;
create policy "cirurgia_material_listas_rw" on public.cirurgia_material_listas
  for all to authenticated using (true) with check (true);

-- Traz o que já existe no campo antigo, uma vez só.
insert into public.cirurgia_material_listas (procedimento_id, nome, itens, empresas, padrao, ordem)
select p.id, 'Padrão', coalesce(p.materiais, ''), p.empresas, true, 0
  from public.cirurgia_procedimentos p
 where coalesce(btrim(p.materiais), '') <> ''
   and not exists (select 1 from public.cirurgia_material_listas l where l.procedimento_id = p.id);

-- ===========================================================================
-- A carta
-- ===========================================================================
insert into public.cirurgia_cartas (tipo, titulo, corpo, ordem)
select * from (values
  ('solicitacao', 'SOLICITAÇÃO DE PROCEDIMENTO CIRÚRGICO',
$T$SR(A) {paciente}

Solicito os procedimento(s) abaixo relacionado(s) com data prevista para o dia {data} no hospital {hospital}.

Procedimento(s):
{procedimentos}

Diagnóstico(s):
{diagnosticos}

MATERIAIS:

{materiais}

Empresas: {empresas}$T$, 2)
) as novos(tipo, titulo, corpo, ordem)
where not exists (select 1 from public.cirurgia_cartas c where c.tipo = novos.tipo);

notify pgrst, 'reload schema';
