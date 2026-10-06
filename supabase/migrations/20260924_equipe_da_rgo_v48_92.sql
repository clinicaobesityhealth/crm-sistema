-- v48.92 — Quem realmente participou desta cirurgia, por papel.
--
-- Rode depois da 20260924_cirurgiao_na_mensagem_v48_83.sql. Pode rodar de novo.
--
-- POR QUE
-- A divisão de honorários (orçamento) e, em breve, a solicitação de reembolso
-- precisam dos nomes exatamente como saíram na descrição cirúrgica — mas até
-- aqui o sistema "adivinhava" auxiliares e instrumentadores pegando os
-- primeiros do cadastro em ordem, não quem de fato esteve na sala. Agora quem
-- sobe a RGO (o cirurgião, pelo link) escolhe cada papel, e essa escolha vale
-- mais que o palpite.
--
-- Fica em branco funciona: só quem for preenchido entra na divisão, como
-- sempre foi.

alter table public.cirurgias add column if not exists rgo_cirurgiao_id        uuid references public.cirurgia_equipe(id);
alter table public.cirurgias add column if not exists rgo_auxiliar1_id       uuid references public.cirurgia_equipe(id);
alter table public.cirurgias add column if not exists rgo_auxiliar2_id       uuid references public.cirurgia_equipe(id);
alter table public.cirurgias add column if not exists rgo_instrumentador1_id uuid references public.cirurgia_equipe(id);
alter table public.cirurgias add column if not exists rgo_instrumentador2_id uuid references public.cirurgia_equipe(id);
alter table public.cirurgias add column if not exists rgo_anestesista_id    uuid references public.cirurgia_equipe(id);
