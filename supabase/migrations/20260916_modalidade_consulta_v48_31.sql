-- v48.31 — Online ou presencial na agenda de consultas.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- A v48.24 já mostrava o selo de online/presencial no cartão da agenda, mas ele
-- nunca aparecia — por um motivo simples: a informação não existia em lugar
-- nenhum. A tabela de agendamentos não tem esse campo, e o que vem do MedX
-- também não traz.
--
-- Então o campo passa a existir aqui, e quem sabe da consulta é que responde:
-- a secretária marca no próprio cartão, em dois cliques. Se um dia o MedX
-- passar a mandar essa informação, ela cai neste mesmo campo e o selo aparece
-- sozinho.
alter table public.agendamentos add column if not exists modalidade text;

-- Aceita só o que a tela usa. Texto livre aqui vira "ONLINE", "on-line",
-- "Online " e três selos diferentes para a mesma coisa.
do $$ begin
  alter table public.agendamentos
    add constraint agendamentos_modalidade_check
    check (modalidade is null or modalidade in ('online', 'presencial'));
exception when duplicate_object then null; end $$;

create index if not exists idx_agendamentos_modalidade
  on public.agendamentos(data, modalidade) where modalidade is not null;

notify pgrst, 'reload schema';

select
  count(*) filter (where modalidade = 'online')     as online,
  count(*) filter (where modalidade = 'presencial') as presencial,
  count(*) filter (where modalidade is null)        as ainda_sem_marcar
  from public.agendamentos;
