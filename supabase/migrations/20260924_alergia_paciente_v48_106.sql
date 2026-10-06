-- v48.106 — Alergia do paciente, em destaque.
--
-- Pode rodar de novo.
--
-- Hoje não existe nenhum jeito de marcar "este paciente é alérgico" — a
-- informação, quando existe, fica perdida em observação de texto livre, e
-- ninguém vê antes de prescrever ou de escolher medicação para suspender.
-- Este campo é por CONTATO (não por cirurgia): a alergia é da pessoa, vale
-- para qualquer cirurgia ou consulta dela.

alter table public.contacts
  add column if not exists alergico boolean not null default false,
  add column if not exists alergia_obs text;

notify pgrst, 'reload schema';
