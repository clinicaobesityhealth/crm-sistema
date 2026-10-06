-- v48.25 — Procedimentos conjugados, via de acesso e exclusão que chega na planilha.
--
-- Rode depois da v48.22. Pode rodar mais de uma vez.
--
-- Três coisas que a prática pediu, e que só agora dava para fazer juntas
-- porque as três mexem na mesma cirurgia:
--
--   1. Uma cirurgia quase nunca é uma só. "BP, HH, BX HEPÁTICA" numa célula da
--      planilha é um lançamento com três procedimentos — e hoje o CRM guarda um
--      só, o primeiro que reconhece. O valor sai errado e a guia sai incompleta.
--
--   2. A mesma cirurgia muda de nome, de preço e de material conforme a via:
--      robótica, videolaparoscopia ou convencional. Estava embutido na
--      abreviação (HIEr é robótica, HIE é vídeo), o que só quem já sabe entende.
--
--   3. Cirurgia apagada no CRM voltava na sincronização seguinte. A linha
--      continuava na planilha, o CRM não a reconhecia mais, e adotava de novo —
--      fazendo exatamente o que foi mandado fazer, com o resultado oposto ao
--      esperado.

-- ===========================================================================
-- 1) Procedimentos conjugados
-- ===========================================================================
-- Cada procedimento do lançamento vira uma linha. A cirurgia continua guardando
-- procedimento_id/sigla/nome do PRINCIPAL — o primeiro da lista — porque é o que
-- a lista, a planilha e as cartas já leem. A sigla combinada ("BP, HH") vai em
-- procedimento_sigla, no mesmo formato que a planilha sempre usou.
--
-- Os valores ficam congelados na linha: a tabela de preços muda com o tempo, e
-- uma cirurgia de dois anos atrás não pode mudar de valor sozinha.
create table if not exists public.cirurgia_itens (
  id uuid primary key default gen_random_uuid(),
  cirurgia_id uuid not null references public.cirurgias(id) on delete cascade,

  procedimento_id uuid references public.cirurgia_procedimentos(id) on delete set null,
  sigla text,
  nome text,

  -- O que foi usado na conta deste lançamento. Vem da tabela do convênio, do
  -- plano ou da particular — e pode ser corrigido à mão, que é o que acontece
  -- no segundo procedimento, normalmente cobrado por menos.
  valor_equipe numeric(10,2) not null default 0,
  valor_anestesista numeric(10,2) not null default 0,
  valor_manual boolean not null default false,

  ordem integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists idx_cirurgia_itens_cirurgia on public.cirurgia_itens(cirurgia_id, ordem);
create index if not exists idx_cirurgia_itens_proc on public.cirurgia_itens(procedimento_id);

alter table public.cirurgia_itens enable row level security;
do $$ begin
  create policy cirurgia_itens_all on public.cirurgia_itens for all using (true) with check (true);
exception when duplicate_object then null; end $$;

-- ===========================================================================
-- 2) Via de acesso
-- ===========================================================================
-- Lista editável, como hospitais e situações: amanhã aparece "endoscópica" e
-- ninguém precisa de uma versão nova do sistema para incluir.
create table if not exists public.cirurgia_vias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_cirurgia_vias_nome on public.cirurgia_vias (lower(nome));

alter table public.cirurgia_vias enable row level security;
do $$ begin
  create policy cirurgia_vias_all on public.cirurgia_vias for all using (true) with check (true);
exception when duplicate_object then null; end $$;

insert into public.cirurgia_vias (nome, ordem) values
  ('VIDEOLAPAROSCOPIA', 1),
  ('ROBÓTICA', 2),
  ('CONVENCIONAL', 3)
on conflict do nothing;

-- Guardada na cirurgia como texto, pela mesma razão do convênio: o nome do dia
-- da cirurgia é o que vale na guia, mesmo que a lista mude depois.
alter table public.cirurgias      add column if not exists via_acesso text;
alter table public.cirurgia_itens add column if not exists via_acesso text;

-- Via padrão da cirurgia cadastrada: BP é vídeo, HIEr é robótica. Preenche o
-- campo sozinho no lançamento, e continua editável.
alter table public.cirurgia_procedimentos add column if not exists via_padrao text;

-- Deduz a via das cirurgias já cadastradas pelo nome, uma vez só. Nome que diz
-- "por videolaparoscopia" não deixa dúvida; o resto fica em branco de propósito,
-- para ninguém herdar um chute.
update public.cirurgia_procedimentos
   set via_padrao = 'ROBÓTICA'
 where via_padrao is null and (nome ilike '%robótic%' or nome ilike '%robotic%');

update public.cirurgia_procedimentos
   set via_padrao = 'VIDEOLAPAROSCOPIA'
 where via_padrao is null and (nome ilike '%videolaparoscop%' or nome ilike '%laparoscop%');

-- ===========================================================================
-- 3) Exclusão que a planilha respeita
-- ===========================================================================
-- Quando uma cirurgia é apagada no CRM, fica aqui a lembrança de que ela foi
-- apagada de propósito. A sincronização lê esta tabela por dois motivos:
--
--   para NÃO adotar de novo a linha que ainda está na planilha; e
--   para mandar o n8n apagar aquela linha.
--
-- É um registro, não uma lixeira: guarda o suficiente para reconhecer a linha
-- (id, nome, data, aba) e para explicar depois quem apagou e quando.
create table if not exists public.cirurgia_exclusoes (
  id uuid primary key default gen_random_uuid(),
  cirurgia_id uuid not null,
  paciente_nome text,
  data_cirurgia date,
  planilha_aba text,
  planilha_linha integer,
  status text,
  motivo text,
  excluida_por uuid,
  excluida_por_nome text,
  -- Carimbado quando a sincronização mandou apagar a linha. Serve para saber o
  -- que já foi resolvido na planilha e o que ainda está pendente.
  removida_da_planilha_em timestamptz,
  -- Desligar a linha aqui é o caminho para RE-IMPORTAR a cirurgia da planilha,
  -- caso a exclusão tenha sido engano.
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_cirurgia_exclusoes_id on public.cirurgia_exclusoes(cirurgia_id);
create index if not exists idx_cirurgia_exclusoes_nome on public.cirurgia_exclusoes(lower(paciente_nome), data_cirurgia);

alter table public.cirurgia_exclusoes enable row level security;
do $$ begin
  create policy cirurgia_exclusoes_all on public.cirurgia_exclusoes for all using (true) with check (true);
exception when duplicate_object then null; end $$;

-- O registro é feito por gatilho, e não pela tela, de propósito: assim vale
-- também para a exclusão feita pelo SQL, por outra tela ou por um fluxo do n8n.
-- Uma exclusão que escapasse do registro voltaria da planilha na hora seguinte.
create or replace function public.registrar_exclusao_cirurgia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cirurgia_exclusoes (
    cirurgia_id, paciente_nome, data_cirurgia, planilha_aba, planilha_linha,
    status, motivo, excluida_por, excluida_por_nome
  ) values (
    old.id, old.paciente_nome, old.data_cirurgia, old.planilha_aba, old.planilha_linha,
    old.status, old.motivo_cancelamento, old.criado_por, old.criado_por_nome
  )
  on conflict (cirurgia_id) do update set
    ativo = true,
    removida_da_planilha_em = null,
    paciente_nome = excluded.paciente_nome,
    data_cirurgia = excluded.data_cirurgia,
    planilha_aba = excluded.planilha_aba,
    planilha_linha = excluded.planilha_linha,
    created_at = now();
  return old;
end $$;

drop trigger if exists trg_exclusao_cirurgia on public.cirurgias;
create trigger trg_exclusao_cirurgia
  before delete on public.cirurgias
  for each row execute function public.registrar_exclusao_cirurgia();

-- ===========================================================================
-- 4) Itens das cirurgias que já existem
-- ===========================================================================
-- Toda cirurgia lançada até hoje tem um procedimento só. Criar a linha
-- correspondente agora deixa a tela com um caminho único: quem lê itens sempre
-- encontra itens, e não precisa de um "se não tiver, use o campo antigo".
--
-- As que vieram da planilha com mais de uma sigla na mesma célula ficam com o
-- texto inteiro na sigla do item — a separação em vários itens acontece na
-- próxima sincronização, que sabe casar sigla por sigla com o cadastro.
insert into public.cirurgia_itens (cirurgia_id, procedimento_id, sigla, nome, valor_equipe, valor_anestesista, ordem)
select c.id, c.procedimento_id, c.procedimento_sigla, c.procedimento_nome,
       coalesce(p.valor_equipe, 0), coalesce(p.valor_anestesista, 0), 1
  from public.cirurgias c
  left join public.cirurgia_procedimentos p on p.id = c.procedimento_id
 where coalesce(c.procedimento_sigla, c.procedimento_nome) is not null
   and not exists (select 1 from public.cirurgia_itens i where i.cirurgia_id = c.id);

notify pgrst, 'reload schema';

-- ===========================================================================
-- Conferência
-- ===========================================================================
select
  (select count(*) from public.cirurgia_itens)                                    as itens_criados,
  (select count(*) from public.cirurgia_vias where ativo)                         as vias_disponiveis,
  (select count(*) from public.cirurgia_procedimentos where via_padrao is not null) as cirurgias_com_via,
  (select count(*) from public.cirurgia_exclusoes)                                as exclusoes_registradas;
