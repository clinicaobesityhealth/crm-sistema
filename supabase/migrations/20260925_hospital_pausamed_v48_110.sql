-- v48.110 — Hospital da cirurgia passa a vir da base nacional de hospitais
-- do PausaMed (cidade/estado + nome exatamente como o PausaMed usa), em vez
-- da lista própria do CRM (cirurgia_hospitais). Isso garante bater 100% com
-- a busca de remédio depois (ver lib/pausamed.ts, resolverMedicamento).
--
-- Os campos antigos (hospital, hospital_id) continuam existindo — cirurgia
-- já lançada não muda; só o formulário novo passa a preencher também
-- cidade/estado/id do PausaMed.

alter table public.cirurgias
  add column if not exists hospital_estado text,
  add column if not exists hospital_cidade text,
  add column if not exists hospital_pausamed_id uuid;

comment on column public.cirurgias.hospital_estado is 'UF do hospital, vindo da base nacional do PausaMed (hospital_directory).';
comment on column public.cirurgias.hospital_cidade is 'Cidade do hospital, vinda da base nacional do PausaMed (hospital_directory).';
comment on column public.cirurgias.hospital_pausamed_id is 'id do hospital na tabela hospital_directory do PausaMed — referência externa (outro banco), não é FK local.';
