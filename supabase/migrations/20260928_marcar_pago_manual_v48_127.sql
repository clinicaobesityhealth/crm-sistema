-- v48.127 — Registrar pagamento manualmente na aba Recibos.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- Por que: a cobrança no cartão só vira "Pago" sozinha pelo webhook da
-- InfinitePay/Safra. Quando isso falha ou não roda (ex.: Sofia desligada na
-- hora, paciente pagou por fora), não existia como corrigir na tela — só
-- excluir e perder o registro do pagamento. Espelha as colunas que
-- cobrancas_pix já tinha desde o início (baixa_por / baixa_por_nome), para
-- os dois tipos de cobrança guardarem, do mesmo jeito, quem confirmou o
-- pagamento manualmente.

alter table public.cobrancas_cartao add column if not exists baixa_por uuid references public.agents(id) on delete set null;
alter table public.cobrancas_cartao add column if not exists baixa_por_nome text;

notify pgrst, 'reload schema';

select 'ok' as marcar_pago_manual;
