-- v46.80: corrige o "Sincronizar agendamentos agora" (e o próprio ciclo automático
-- de 15 minutos) do workflow n8n "Sync MedX -> Agendamentos (Secretaria)".
--
-- DIAGNÓSTICO (achado ao investigar o caso do paciente Jesse, agendado direto no
-- MedX pra 04/09 14h e que não aparecia no CRM mesmo após rodar a sincronização
-- manual): o node "Sincronizar Avulsos MedX -> Supabase" faz um upsert em
-- /rest/v1/agendamentos?on_conflict=medx_agendamento_id — só que a tabela NUNCA
-- teve um índice único na coluna medx_agendamento_id. Sem esse índice, o Postgres/
-- PostgREST rejeita QUALQUER upsert com "on_conflict" (HTTP 400) — confirmado ao
-- inspecionar a execução do n8n: "erro_agendamentos": "Request failed with status
-- code 400". Resultado: nenhum agendamento novo feito direto no MedX (sem passar
-- pelo agendamento do CRM) jamais foi gravado no Supabase por esse caminho — não é
-- um problema específico do Jesse, é estrutural.
--
-- Isso também explica as linhas duplicadas que já existem na tabela hoje: outro
-- caminho (a busca de agenda) grava sem on_conflict, então o mesmo
-- medx_agendamento_id foi inserido de novo a cada ciclo em vez de atualizar a
-- linha existente — inclusive com status desatualizado (ex.: uma cópia antiga
-- ainda "Confirmada" enquanto a consulta já foi cancelada na cópia mais recente).
--
-- FIX: 1) limpa as duplicatas mantendo a linha mais recente (updated_at) de cada
-- medx_agendamento_id; 2) cria o índice único que faltava, permitindo o upsert
-- funcionar dali pra frente.
--
-- IMPORTANTE: aplique este SQL no Supabase ANTES de publicar o deploy do CRM
-- que acompanha esta versão.

with dups as (
  select id,
         row_number() over (partition by medx_agendamento_id order by updated_at desc, id) as rn
  from public.agendamentos
  where medx_agendamento_id is not null
)
delete from public.agendamentos
where id in (select id from dups where rn > 1);

create unique index if not exists agendamentos_medx_agendamento_id_unique
  on public.agendamentos (medx_agendamento_id)
  where medx_agendamento_id is not null;

notify pgrst, 'reload schema';
