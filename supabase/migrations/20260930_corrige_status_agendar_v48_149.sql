-- v48.149 — Corrige o mapeamento do botão "Agendar" do link do cirurgião.
--
-- A migração 20260924_agenda_cirurgiao_v48_76.sql tentou achar a situação
-- "AGENDAR" para o botão "Agendar" usando o padrão upper(nome) like
-- '%SOLICITAD%' — mas isso bateu com "SOLICITADO ORÇAMENTO" (que também
-- contém "SOLICITAD"), não com "AGENDAR" (que não tem esse trecho no nome).
-- Resultado: toda cirurgia agendada/atualizada pelo link do médico ficava
-- marcada com a situação "SOLICITADO ORÇAMENTO" em vez de "AGENDAR" — é
-- o que aparecia na lista do CRM. Pedido do Jorge: "AGENDAR TEM QUE FICAR
-- AGENDAR".
--
-- Esta correção só mexe em quem está com o mapeamento errado hoje (aponta
-- para uma situação cujo nome não é "AGENDAR"); se alguém já tiver
-- corrigido isso manualmente em Configurações → Cirurgias → "Agendamento
-- pelo cirurgião", não faz nada.

update public.clinic_settings s
   set agenda_cirurgiao = s.agenda_cirurgiao || jsonb_build_object(
     'status_agendar',
     (select id::text from public.cirurgia_status where ativo and upper(nome) = 'AGENDAR' order by ordem limit 1)
   )
 where exists (
   select 1 from public.cirurgia_status cs
   where cs.id::text = s.agenda_cirurgiao->>'status_agendar'
     and upper(cs.nome) <> 'AGENDAR'
 )
 and exists (
   select 1 from public.cirurgia_status where ativo and upper(nome) = 'AGENDAR'
 );
