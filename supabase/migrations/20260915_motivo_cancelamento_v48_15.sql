-- v48.15 — Motivo do cancelamento.
--
-- Rode depois da v48.08b. Pode rodar mais de uma vez.
--
-- O histórico de situações já registra QUE a cirurgia foi cancelada, quando e
-- por quem. O que faltava é o porquê — e é justamente o que alguém pergunta
-- meses depois, quando o paciente volta.
--
-- Fica em campo próprio, e não dentro da observação, porque precisa ser
-- obrigatório na hora do cancelamento e precisa aparecer no cartão da lista.
-- Informação enterrada numa observação livre não dá para exigir nem exibir.
alter table public.cirurgias add column if not exists motivo_cancelamento text;

notify pgrst, 'reload schema';
