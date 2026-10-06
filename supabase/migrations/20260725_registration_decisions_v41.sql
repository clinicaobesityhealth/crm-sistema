-- Decisões administrativas dos cadastros da v41.
-- As funções só executam para um administrador já autenticado no CRM.

create or replace function public.admin_reject_registration(p_request_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_crm_admin(auth.uid()) then
    raise exception 'Apenas administradores podem recusar cadastros';
  end if;

  update public.user_registration_requests
  set status = 'rejected',
      rejection_reason = coalesce(nullif(trim(p_reason), ''), 'Cadastro não autorizado pelo administrador.')
  where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'Cadastro pendente não encontrado';
  end if;
end;
$$;

create or replace function public.admin_prepare_existing_link(p_request_id uuid, p_existing_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  pending_user_id uuid;
begin
  if not public.is_crm_admin(auth.uid()) then
    raise exception 'Apenas administradores podem preparar vinculações';
  end if;

  if not exists (select 1 from public.agents where id = p_existing_agent_id) then
    raise exception 'Usuário existente não encontrado';
  end if;

  select user_id into pending_user_id
  from public.user_registration_requests
  where id = p_request_id and status = 'pending'
  for update;

  if pending_user_id is null then
    raise exception 'Cadastro pendente não encontrado';
  end if;

  if pending_user_id = p_existing_agent_id then
    raise exception 'O cadastro selecionado já pertence a este usuário';
  end if;

  -- A FK da solicitação usa ON DELETE CASCADE. Excluir o auth.users pendente
  -- remove somente a solicitação correspondente e libera a identidade Google.
  delete from auth.users where id = pending_user_id;
end;
$$;

revoke all on function public.admin_reject_registration(uuid, text) from public, anon;
revoke all on function public.admin_prepare_existing_link(uuid, uuid) from public, anon;
grant execute on function public.admin_reject_registration(uuid, text) to authenticated;
grant execute on function public.admin_prepare_existing_link(uuid, uuid) to authenticated;
