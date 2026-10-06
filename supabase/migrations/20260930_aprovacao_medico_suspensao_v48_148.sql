-- v48.148 — Aprovação do CIRURGIÃO para a suspensão de medicamentos.
--
-- Pode rodar mais de uma vez.
--
-- POR QUE
-- Pedido do Jorge, verbatim: "TEMOS QUE TER UM BOTÃO APROVAR E FICAR
-- SINALIZADO NO CRM QUE O MÉDICO APROVOU A SUSPENSÃO DE REMÉDIOS".
--
-- Isto é um conceito NOVO e separado do status 'aprovado' que já existe em
-- cirurgia_medicamentos: aquele é travado em massa pela SECRETARIA, no
-- momento em que ela gera o PDF de suspensão (ver
-- app/api/cirurgias/[id]/documento/route.ts) — vem depois, e não muda aqui.
-- Este aqui é o próprio CIRURGIÃO, pelo link dele
-- (app/agendar-cirurgia/[token]/page.tsx), dizendo que já revisou e concorda
-- com o plano de suspensão — antes mesmo de a secretaria gerar qualquer
-- documento.
--
-- Se qualquer medicação for adicionada, removida, editada ou re-consultada
-- depois da aprovação, ela cai sozinha (ver
-- app/api/agendar-cirurgia/[token]/route.ts): o cirurgião precisa aprovar de
-- novo.

alter table public.cirurgias
  add column if not exists suspensao_medicamentos_aprovada boolean not null default false;

alter table public.cirurgias
  add column if not exists suspensao_medicamentos_aprovada_em timestamptz;

comment on column public.cirurgias.suspensao_medicamentos_aprovada is
  'true quando o PRÓPRIO CIRURGIÃO (pelo link dele) clicou em "Aprovar suspensão de medicamentos" na aba Medicações. Some (volta a false) sempre que alguma medicação é adicionada, removida, editada ou re-consultada depois — precisa aprovar de novo. Não confundir com cirurgia_medicamentos.status=''aprovado'', que é travado pela secretaria ao gerar o PDF de suspensão.';

comment on column public.cirurgias.suspensao_medicamentos_aprovada_em is
  'Quando o cirurgião aprovou a suspensão de medicamentos (ver suspensao_medicamentos_aprovada). Null enquanto não aprovado ou depois de cair por uma edição posterior.';

notify pgrst, 'reload schema';
