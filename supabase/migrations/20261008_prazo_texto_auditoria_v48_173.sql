-- v48.173 — Prazo de suspensão (texto da IA, com variantes) na Auditoria.
--
-- Pode rodar mais de uma vez.
--
-- POR QUE
-- Pedido do Jorge, depois de ver a Auditoria da IA funcionando: "a auditoria
-- não está trazendo o prazo de suspensão ou prazos encontrados (variantes
-- quando houver), apenas está explicando o motivo e a referência". A IA
-- sempre devolveu um texto de prazo (prazoTexto, ex.: "14 dias" ou "10-14
-- dias dependendo da dose") além do número de dias (prazoSuspensaoDias, já
-- salvo em prazo_suspensao_dias) — mas esse texto nunca era guardado, só o
-- número. prazo_texto guarda o texto por extenso, do jeito que a IA
-- encontrou (inclusive variantes), para mostrar na janela roxa.

alter table public.cirurgia_medicamentos
  add column if not exists prazo_texto text;

comment on column public.cirurgia_medicamentos.prazo_texto is
  'Prazo de suspensão por extenso, do jeito que a IA (ou o PausaMed) descreveu — ex.: "14 dias" ou "10 a 14 dias, dependendo da dose". Pode trazer variantes que o número sozinho (prazo_suspensao_dias) não mostra. Mostrado na Auditoria da IA.';

alter table public.cirurgia_medicamentos_clinica
  add column if not exists prazo_texto text;

comment on column public.cirurgia_medicamentos_clinica.prazo_texto is
  'Mesmo sentido de cirurgia_medicamentos.prazo_texto — guardado aqui para reaproveitar em outras cirurgias sem pesquisar de novo.';

notify pgrst, 'reload schema';
