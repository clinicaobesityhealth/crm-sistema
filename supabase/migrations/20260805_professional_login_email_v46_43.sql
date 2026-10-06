-- v46.43: liga o login do médico (tabela agents/auth) ao cadastro dele em
-- professionals, pra Agenda Médica poder filtrar "usuário comum" pra ver só
-- a própria agenda. Vínculo por e-mail (mesmo e-mail de login do agente).
-- Coluna opcional: profissionais que não têm login próprio no CRM (ou que
-- ainda não foram vinculados) simplesmente ficam com email = null, sem
-- quebrar nada do que já existe.

alter table public.professionals
  add column if not exists email text;

comment on column public.professionals.email is
  'E-mail de login (agents.email) do médico dono deste cadastro, quando ele acessa o CRM diretamente. Usado para filtrar a Agenda Médica para "só a minha agenda". Nulo = profissional sem login próprio vinculado ainda.';

create index if not exists professionals_email_idx on public.professionals (lower(email)) where email is not null;
