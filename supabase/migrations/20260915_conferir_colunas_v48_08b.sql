-- v48.08b — Conserto do erro "Could not find the 'equipe_auxiliares' column".
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. Ele não apaga nada.
--
-- O erro vem de uma de duas causas, e este arquivo resolve as duas sem você
-- precisar descobrir qual foi:
--
--   1. O SQL da v48.04 não chegou a rodar, e as colunas de equipe e de valores
--      não existem.
--   2. As colunas existem, mas o Supabase ainda serve uma lista de colunas
--      antiga. Ele guarda um retrato do banco para responder rápido, e esse
--      retrato às vezes demora a ser refeito depois de um ALTER TABLE. Para
--      quem chama de fora, o efeito é idêntico ao da coluna não existir.

-- --- 1) Garante as colunas (não faz nada se já existirem) -------------------
alter table public.cirurgias add column if not exists equipe_auxiliares        integer not null default 0;
alter table public.cirurgias add column if not exists equipe_instrumentadores  integer not null default 0;
alter table public.cirurgias add column if not exists tem_anestesista          boolean not null default false;
alter table public.cirurgias add column if not exists anestesista_cobra_direto boolean not null default false;
alter table public.cirurgias add column if not exists valor_cobrado_manual     boolean not null default false;
alter table public.cirurgias add column if not exists valor_previa_manual      boolean not null default false;

alter table public.cirurgias add column if not exists planilha_uuid   uuid;
alter table public.cirurgias add column if not exists planilha_aba    text;
alter table public.cirurgias add column if not exists planilha_linha  integer;
alter table public.cirurgias add column if not exists sincronizado_em timestamptz;
alter table public.cirurgias add column if not exists carimbo_origem  timestamptz;

alter table public.cirurgia_modalidades
  add column if not exists percentual_previa numeric(5,2) not null default 0;

update public.cirurgia_modalidades
   set percentual_previa = 30
 where percentual_previa = 0
   and (upper(nome) like '%CONVÊNIO%' or upper(nome) like '%CONVENIO%');

-- --- 2) Manda o Supabase reler o banco --------------------------------------
notify pgrst, 'reload schema';

-- --- 3) Confirmação ---------------------------------------------------------
-- Deve listar as 11 colunas abaixo. Se faltar alguma, me diga qual.
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'cirurgias'
   and column_name in (
     'equipe_auxiliares','equipe_instrumentadores','tem_anestesista',
     'anestesista_cobra_direto','valor_cobrado_manual','valor_previa_manual',
     'planilha_uuid','planilha_aba','planilha_linha','sincronizado_em','carimbo_origem')
 order by column_name;
