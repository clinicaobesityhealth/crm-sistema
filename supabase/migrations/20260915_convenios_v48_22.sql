-- v48.22 — Convênios, planos e tabela de preços por convênio.
--
-- Rode depois da v48.15. Pode rodar mais de uma vez.
--
-- Hoje cada cirurgia tem um preço só, o particular. Quando a clínica passar a
-- atender convênio, o mesmo procedimento vale valores diferentes conforme o
-- convênio e, às vezes, o plano dentro dele.
--
-- O desenho segue essa realidade em três níveis, do mais específico para o
-- mais geral — e é nessa ordem que o preço é procurado na hora de cobrar:
--
--   1. preço daquele procedimento naquele convênio E naquele plano
--   2. preço daquele procedimento naquele convênio (qualquer plano)
--   3. preço particular, o que já existe no cadastro do procedimento
--
-- Assim dá para cadastrar só o que foge à regra: um convênio inteiro com um
-- preço, e a exceção de um plano específico.

-- ===========================================================================
-- 1) Convênios e planos
-- ===========================================================================
create table if not exists public.cirurgia_convenios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  registro_ans text,                 -- o número que vai na guia TISS
  observacao text,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_cir_convenios_nome on public.cirurgia_convenios (lower(nome));

create table if not exists public.cirurgia_planos (
  id uuid primary key default gen_random_uuid(),
  convenio_id uuid not null references public.cirurgia_convenios(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  ordem integer not null default 0
);
create index if not exists idx_cir_planos_convenio on public.cirurgia_planos(convenio_id);
-- Dois planos com o mesmo nome no mesmo convênio seriam indistinguíveis na
-- tela; em convênios diferentes, "Master" e "Master" são coisas distintas.
create unique index if not exists idx_cir_planos_nome
  on public.cirurgia_planos (convenio_id, lower(nome));

-- ===========================================================================
-- 2) Tabela de preços
-- ===========================================================================
create table if not exists public.cirurgia_precos (
  id uuid primary key default gen_random_uuid(),
  procedimento_id uuid not null references public.cirurgia_procedimentos(id) on delete cascade,
  convenio_id     uuid not null references public.cirurgia_convenios(id) on delete cascade,
  -- Nulo significa "vale para todo o convênio". É o caso comum: cadastra-se o
  -- convênio inteiro e só depois a exceção de um plano.
  plano_id        uuid references public.cirurgia_planos(id) on delete cascade,

  valor_equipe      numeric(10,2) not null default 0,
  valor_anestesista numeric(10,2) not null default 0,
  observacao text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_cir_precos_busca
  on public.cirurgia_precos (convenio_id, procedimento_id);

-- Um preço por combinação. O coalesce com um UUID fixo resolve o caso do plano
-- nulo, que de outro modo escaparia da unicidade — em SQL, nulo nunca é igual a
-- nulo, e dois "preço geral do convênio" poderiam conviver.
create unique index if not exists idx_cir_precos_unico
  on public.cirurgia_precos (
    procedimento_id, convenio_id,
    coalesce(plano_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ===========================================================================
-- 3) O convênio do paciente e o da cirurgia
-- ===========================================================================
-- No paciente, porque é dele o convênio e ele não muda a cada cirurgia.
alter table public.contacts add column if not exists convenio_id uuid references public.cirurgia_convenios(id) on delete set null;
alter table public.contacts add column if not exists plano_id    uuid references public.cirurgia_planos(id)    on delete set null;
alter table public.contacts add column if not exists carteirinha text;

-- Na cirurgia, porque o que valeu naquele dia tem que ficar registrado: o
-- paciente pode trocar de convênio depois, e a guia antiga não muda por isso.
alter table public.cirurgias add column if not exists convenio_id uuid references public.cirurgia_convenios(id) on delete set null;
alter table public.cirurgias add column if not exists plano_id    uuid references public.cirurgia_planos(id)    on delete set null;
alter table public.cirurgias add column if not exists convenio    text;
alter table public.cirurgias add column if not exists plano       text;
alter table public.cirurgias add column if not exists carteirinha text;

-- ===========================================================================
-- 4) Permissões
-- ===========================================================================
do $perm$
declare t text;
begin
  foreach t in array array['cirurgia_convenios','cirurgia_planos','cirurgia_precos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_rw" on public.%I', t, t);
    execute format('create policy "%s_rw" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end
$perm$;

notify pgrst, 'reload schema';

-- ===========================================================================
-- 5) Quem enxerga a agenda cirúrgica
-- ===========================================================================
-- A agenda de cirurgias não é para toda a equipe: nutricionista, psicólogo e
-- clínico não têm o que fazer nela, e ver valores e dados de convênio de todos
-- os pacientes é informação a mais sem necessidade.
--
-- Fica por CARGO, e não por nome de pessoa: assim, quando alguém entra na
-- equipe, o acesso vem do cargo e ninguém precisa lembrar de configurar.
alter table public.job_titles add column if not exists ve_cirurgias boolean not null default false;

-- Liga para os cargos administrativos e de secretaria, que são quem opera a
-- agenda. Médicos ficam de fora por padrão de propósito: o cargo "Médico(a)"
-- não distingue cirurgião de clínico. Ligue na tela para os cargos certos, ou
-- crie um cargo "Cirurgião(ã)".
update public.job_titles
   set ve_cirurgias = true
 where lower(name) like '%administra%'
    or lower(name) like '%secret%'
    or lower(name) like '%recep%'
    or lower(name) like '%cirurgi%';

notify pgrst, 'reload schema';

-- ===========================================================================
-- 6) Dados da carteirinha
-- ===========================================================================
-- O número sozinho não basta na hora de solicitar: o convênio pede o nome como
-- está na carteirinha (que nem sempre é o nome do cadastro) e a validade.
alter table public.contacts   add column if not exists carteirinha_nome     text;
alter table public.contacts   add column if not exists carteirinha_validade date;
alter table public.cirurgias  add column if not exists carteirinha_nome     text;
alter table public.cirurgias  add column if not exists carteirinha_validade date;

notify pgrst, 'reload schema';
