-- v48.160 — Corrige o link das fotos da RGO (descrição cirúrgica) que
-- aparecia na tela mas ficava inacessível ao abrir.
--
-- A migração original (20260922_agenda_google_e_rgo_v48_59.sql) criava o
-- bucket 'rgo' como público, mas com "on conflict (id) do nothing" — ou
-- seja, só agia se o bucket ainda não existisse. Se esse bucket já existia
-- antes (por qualquer motivo) como privado, aquela linha nunca corrigiu, e
-- o link público (usado tanto na tela do cirurgião quanto em qualquer lugar
-- do CRM que mostra a foto da RGO) ficou sempre retornando erro.
--
-- Esta aqui força o bucket a ficar público de verdade, existindo antes ou não.
insert into storage.buckets (id, name, public) values ('rgo', 'rgo', true)
on conflict (id) do update set public = true;
