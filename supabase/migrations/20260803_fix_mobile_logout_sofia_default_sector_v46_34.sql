-- v46.34: corrige atendimentos ativos antigos sem setor (ou apontando para setor excluído).
-- Novos atendimentos já recebem o setor Atendimento pelo CRM.
do $$
declare
  atendimento_id uuid;
begin
  select id into atendimento_id
  from public.sectors
  where lower(trim(name)) = 'atendimento'
  order by created_at asc
  limit 1;

  if atendimento_id is not null then
    update public.contacts c
       set sector_id = atendimento_id,
           updated_at = now()
     where c.conversation_status = 'active'
       and (
         c.sector_id is null
         or not exists (select 1 from public.sectors s where s.id = c.sector_id)
       );
  end if;
end $$;
