-- v48.77 — Espelho do cadastro de contatos do MedX.
--
-- Pode rodar de novo sem problema.
--
-- POR QUE COPIAR
-- O cadastro vive no MedX, e vai continuar vivendo. O que não dá é depender
-- dele para toda pergunta rápida: a página do cirurgião precisa procurar um
-- paciente sem credencial de prontuário num link público, o CRM precisa criar
-- o contato quando ele existe lá e não aqui, e os aniversariantes ainda leem
-- uma planilha do Google que alguém tem de manter.
--
-- Então guardamos aqui só o que identifica e o que a operação usa: nome,
-- telefones, e-mail, CPF, nascimento e convênio. Nada de prontuário, nada de
-- evolução — isso não sai do MedX.
--
-- A cópia pode envelhecer, e envelhece de propósito: quem manda é o MedX. Por
-- isso cada linha guarda quando foi atualizada, e quem for agir sobre um dado
-- sensível relê a ficha antes.

create table if not exists public.medx_contatos (
  id_cliente       text primary key,          -- Id_do_Cliente no MedX
  nome             text,
  nome_social      text,
  telefone         text,
  telefone_1       text,
  celular          text,
  email            text,
  cpf              text,
  nascimento       date,
  id_convenio      text,
  convenio         text,

  -- A data de nascimento não vem na listagem: só na ficha, uma chamada por
  -- pessoa. Buscar a ficha de todo mundo a cada sincronização derrubaria o
  -- MedX — então a listagem entra primeiro e a ficha é preenchida aos poucos,
  -- e estes dois campos dizem de quem já se tentou.
  ficha_em        timestamptz,
  ficha_erro      text,

  atualizado_em   timestamptz not null default now(),
  criado_em       timestamptz not null default now()
);

create index if not exists medx_contatos_nome_idx
  on public.medx_contatos using gin (public.chave_nome(nome) gin_trgm_ops);

create index if not exists medx_contatos_celular_idx
  on public.medx_contatos (regexp_replace(coalesce(celular, ''), '[^0-9]', '', 'g'));

-- Para os aniversariantes: dia e mês, sem o ano.
create index if not exists medx_contatos_aniversario_idx
  on public.medx_contatos ((extract(month from nascimento)), (extract(day from nascimento)))
  where nascimento is not null;

-- Quem ainda não tem ficha buscada, do mais novo para o mais antigo: é a fila
-- que a sincronização consome aos poucos.
create index if not exists medx_contatos_sem_ficha_idx
  on public.medx_contatos (criado_em desc)
  where ficha_em is null;

alter table public.medx_contatos enable row level security;
drop policy if exists "medx_contatos_leitura" on public.medx_contatos;
create policy "medx_contatos_leitura" on public.medx_contatos
  for select to authenticated using (true);

-- Busca de paciente que olha os dois lados: o contato do CRM (que já tem
-- conversa) e o cadastro do MedX (que tem todo mundo). O do CRM vem primeiro —
-- é nele que a cirurgia vai se apoiar.
create or replace function public.buscar_pacientes(p_termo text, p_limite integer default 8)
returns table (
  origem text, id text, nome text, telefone text, id_medx text, nascimento date
)
language sql
stable
security definer
set search_path = public
as $bp$
  with digitos as (select regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') as d),
  crm as (
    select 'crm'::text as origem, c.id::text, c.full_name as nome, c.phone as telefone,
           null::text as id_medx, null::date as nascimento
      from public.contacts c, digitos
     where (btrim(public.chave_nome(p_termo)) <> ''
            and public.chave_nome(c.full_name) like '%' || public.chave_nome(p_termo) || '%')
        or (digitos.d <> '' and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || digitos.d || '%')
     limit greatest(coalesce(p_limite, 8), 1)
  ),
  medx as (
    select 'medx'::text as origem, m.id_cliente as id, m.nome, coalesce(m.celular, m.telefone) as telefone,
           m.id_cliente as id_medx, m.nascimento
      from public.medx_contatos m, digitos
     where (btrim(public.chave_nome(p_termo)) <> ''
            and public.chave_nome(m.nome) like '%' || public.chave_nome(p_termo) || '%')
        or (digitos.d <> '' and regexp_replace(coalesce(m.celular, ''), '[^0-9]', '', 'g') like '%' || digitos.d || '%')
     limit greatest(coalesce(p_limite, 8), 1)
  )
  select * from crm
  union all
  -- Quem já está no CRM não aparece duas vezes: o telefone é o que amarra.
  select * from medx
   where not exists (
     select 1 from crm
      where regexp_replace(coalesce(crm.telefone, ''), '[^0-9]', '', 'g') <> ''
        and regexp_replace(coalesce(crm.telefone, ''), '[^0-9]', '', 'g')
            = regexp_replace(coalesce(medx.telefone, ''), '[^0-9]', '', 'g'))
$bp$;

grant execute on function public.buscar_pacientes(text, integer) to authenticated;

notify pgrst, 'reload schema';
