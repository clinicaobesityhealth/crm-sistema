-- v48.02 — Catálogos oficiais de CID-10 e TUSS dentro do CRM.
--
-- Rode DEPOIS do arquivo 20260914_cadastros_cirurgia_v48_01.sql.
-- Como todos os outros, pode ser rodado mais de uma vez sem estragar nada.
--
-- Por que isto existe: até agora o TUSS e o CID eram digitados à mão, e um
-- dígito trocado só aparece quando o convênio devolve a guia. Com o catálogo
-- dentro do banco, a secretária busca pelo nome ("hemorroidectomia") e o código
-- vem junto, conferido. São os mesmos arquivos oficiais que você já usa no
-- PausaMed: CID-10 do DATASUS (V2008) e TUSS 22 da ANS.
--
-- As linhas em si NÃO vêm neste arquivo — são 18 mil. Elas entram pelo
-- Table Editor do Supabase, importando os dois CSV. O passo a passo está no
-- guia de implantação.

-- ===========================================================================
-- 1) As duas tabelas de catálogo
-- ===========================================================================
-- Mesmos nomes de coluna dos CSV, para o importador do Supabase casar sozinho.

create table if not exists public.cid_catalog (
  code text primary key,
  description text not null,
  synonyms text,
  chapter text,
  source_name text,
  source_version text,
  published_at date,
  is_active boolean not null default true
);

create table if not exists public.tuss_catalog (
  code text primary key,
  procedure_name text not null,
  synonyms text,
  specialty text,
  chapter text,
  source_name text,
  source_version text,
  published_at date,
  is_active boolean not null default true
);

-- Busca por nome: sem isto, procurar "hemorroidectomia" varre 6 mil linhas a
-- cada tecla digitada.
create extension if not exists pg_trgm;
create index if not exists idx_cid_catalog_desc  on public.cid_catalog  using gin (description gin_trgm_ops);
create index if not exists idx_tuss_catalog_nome on public.tuss_catalog using gin (procedure_name gin_trgm_ops);

-- Catálogo é leitura para quem está logado. Ele só muda quando uma versão nova
-- é publicada pelo DATASUS ou pela ANS, e isso é importação, não digitação.
alter table public.cid_catalog  enable row level security;
alter table public.tuss_catalog enable row level security;

drop policy if exists "cid_catalog_leitura" on public.cid_catalog;
create policy "cid_catalog_leitura" on public.cid_catalog for select to authenticated using (true);

drop policy if exists "tuss_catalog_leitura" on public.tuss_catalog;
create policy "tuss_catalog_leitura" on public.tuss_catalog for select to authenticated using (true);

-- ===========================================================================
-- 2) Correção dos CID incompletos herdados da planilha
-- ===========================================================================
-- Cinco cirurgias estavam com o CID de três caracteres (E66, K76, L05, K43,
-- K60). Esses cinco não existem como código faturável: a CID-10 exige o quarto
-- caractere quando a categoria tem subdivisões, e o convênio devolve a guia
-- quando recebe só a categoria. Confirmei um por um contra o arquivo oficial
-- do DATASUS.
--
-- A escolha do subcódigo é decisão clínica, não de programa. Deixei abaixo a
-- opção mais provável para cada caso, e no guia está a lista das alternativas
-- para você conferir. Só altera quem ainda está no código curto — se você já
-- corrigiu na tela, nada aqui encosta.

update public.cirurgia_proc_cid set codigo = 'E66.0', descricao = 'Obesidade devida a excesso de calorias'
  where codigo = 'E66';
update public.cirurgia_proc_cid set codigo = 'K76.0', descricao = 'Degeneração gordurosa do fígado não classificada em outra parte'
  where codigo = 'K76';
update public.cirurgia_proc_cid set codigo = 'L05.9', descricao = 'Cisto pilonidal sem abscesso'
  where codigo = 'L05';
update public.cirurgia_proc_cid set codigo = 'K43.9', descricao = 'Hérnia ventral sem obstrução ou gangrena'
  where codigo = 'K43';
update public.cirurgia_proc_cid set codigo = 'K60.1', descricao = 'Fissura anal crônica'
  where codigo = 'K60';

-- Descrições oficiais nos que já estavam certos, para a carta não sair com o
-- texto de casa e a guia com o texto da tabela.
update public.cirurgia_proc_cid set descricao = 'Colecistite crônica'                                          where codigo = 'K81.1';
update public.cirurgia_proc_cid set descricao = 'Plicomas hemorroidários residuais'                            where codigo = 'I84.6';
update public.cirurgia_proc_cid set descricao = 'Doença de refluxo gastroesofágico com esofagite'              where codigo = 'K21.0';
update public.cirurgia_proc_cid set descricao = 'Hérnia inguinal bilateral, sem obstrução ou gangrena'         where codigo = 'K40.2';
update public.cirurgia_proc_cid set descricao = 'Hérnia inguinal unilateral ou não especificada, sem obstrução ou gangrena' where codigo = 'K40.9';
update public.cirurgia_proc_cid set descricao = 'Hérnia umbilical sem obstrução ou gangrena'                   where codigo = 'K42.9';
update public.cirurgia_proc_cid set descricao = 'Hérnia ventral sem obstrução ou gangrena'                     where codigo = 'K43.9';

-- ===========================================================================
-- 3) Descrições oficiais dos TUSS
-- ===========================================================================
-- Os treze códigos da planilha foram conferidos contra a tabela da ANS e todos
-- existem. O que muda aqui é só o texto: passa a ser o nome oficial do
-- procedimento, que é o que o convênio espera ler na guia.
update public.cirurgia_proc_tuss set descricao = 'Gastroplastia para obesidade mórbida por videolaparoscopia'                        where codigo = '31002390';
update public.cirurgia_proc_tuss set descricao = 'Biópsia hepática por videolaparoscopia'                                            where codigo = '31005675';
update public.cirurgia_proc_tuss set descricao = 'Colecistectomia com colangiografia por videolaparoscopia'                          where codigo = '31005470';
update public.cirurgia_proc_tuss set descricao = 'Cisto sacro-coccígeo - tratamento cirúrgico'                                       where codigo = '31009042';
update public.cirurgia_proc_tuss set descricao = 'Extensos ferimentos, cicatrizes ou tumores - excisão e retalhos cutâneos da região' where codigo = '30101522';
update public.cirurgia_proc_tuss set descricao = 'Herniorrafia epigástrica'                                                          where codigo = '31009093';
update public.cirurgia_proc_tuss set descricao = 'Hemorroidectomia aberta ou fechada, com ou sem esfincterotomia, sem grampeador'     where codigo = '31004202';
update public.cirurgia_proc_tuss set descricao = 'Fissurectomia com ou sem esfincterotomia'                                          where codigo = '31004105';
update public.cirurgia_proc_tuss set descricao = 'Excisão de plicoma'                                                                where codigo = '31004091';
update public.cirurgia_proc_tuss set descricao = 'Refluxo gastroesofágico - tratamento cirúrgico (Hérnia de hiato) por videolaparoscopia' where codigo = '31001360';
update public.cirurgia_proc_tuss set descricao = 'Herniorrafia inguinal - unilateral por videolaparoscopia'                          where codigo = '31009336';
update public.cirurgia_proc_tuss set descricao = 'Herniorrafia umbilical'                                                            where codigo = '31009166';
update public.cirurgia_proc_tuss set descricao = 'Herniorrafia recidivante por videolaparoscopia'                                    where codigo = '31009344';
