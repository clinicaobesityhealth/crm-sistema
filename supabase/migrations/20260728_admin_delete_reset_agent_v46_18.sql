-- v46.18: permite que um administrador do CRM remova um atendente
-- ou redefina a senha dele direto pela tela de Atendentes, sem precisar
-- entrar no Supabase manualmente.
-- Segue o mesmo padrão de segurança já usado em admin_reject_registration /
-- admin_prepare_existing_link (só executa se quem chamou for admin).

create extension if not exists pgcrypto;

-- Remove completamente um atendente: apaga o perfil (public.agents, que em
-- cascata já limpa agent_sectors, agent_ui_prefs, access_requests e
-- desvincula scheduled_messages.created_by) e também o login dele
-- (auth.users), para o e-mail ficar livre para um novo cadastro.
create or replace function public.admin_delete_agent(p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_crm_admin(auth.uid()) then
    raise exception 'Apenas administradores podem remover atendentes';
  end if;

  if auth.uid() = p_agent_id then
    raise exception 'Você não pode remover seu próprio usuário';
  end if;

  if not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'Atendente não encontrado';
  end if;

  delete from public.agents where id = p_agent_id;
  delete from auth.users where id = p_agent_id;
end;
$$;

-- Redefine a senha de login de um atendente (padrão 12345678, mas aceita
-- outra senha se for chamada com o segundo parâmetro).
create or replace function public.admin_reset_agent_password(p_agent_id uuid, p_new_password text default '12345678')
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_crm_admin(auth.uid()) then
    raise exception 'Apenas administradores podem redefinir senhas';
  end if;

  if not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'Atendente não encontrado';
  end if;

  if not exists (select 1 from auth.users where id = p_agent_id) then
    raise exception 'Este atendente não tem login ativo. Peça para ele se cadastrar novamente pela tela de login.';
  end if;

  if length(coalesce(p_new_password, '')) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf', 12)),
      updated_at = now()
  where id = p_agent_id;
end;
$$;

revoke all on function public.admin_delete_agent(uuid) from public, anon;
revoke all on function public.admin_reset_agent_password(uuid, text) from public, anon;
grant execute on function public.admin_delete_agent(uuid) to authenticated;
grant execute on function public.admin_reset_agent_password(uuid, text) to authenticated;
