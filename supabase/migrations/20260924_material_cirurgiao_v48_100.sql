-- v48.100 — O cirurgião já escolhe o material ao agendar pelo link.
--
-- Rode depois da 20260924_pausamed_suspensao_v48_97.sql. Pode rodar de novo.
--
-- Hoje a lista de materiais (Padrão, Com tela Bard...) só é escolhida na hora
-- de gerar a solicitação — e quem gera nem sempre sabe qual foi combinada na
-- sala. Se o cirurgião já marca no link, ao agendar, a solicitação nasce com
-- a lista certa: a secretária só confere e gera, em vez de adivinhar.

alter table public.cirurgias
  add column if not exists material_listas_ids jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
