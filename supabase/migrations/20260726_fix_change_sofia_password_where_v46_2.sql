-- Corrige o erro "UPDATE requires a WHERE clause" ao trocar a senha do Agente de IA.
-- A função passa a atualizar somente o registro de configuração que foi validado.
create extension if not exists pgcrypto;

create or replace function public.change_sofia_admin_password(current_password text, new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_id public.clinic_settings.id%type;
  stored_hash text;
begin
  if not public.is_crm_admin(auth.uid()) then
    raise exception 'Acesso negado';
  end if;

  if length(coalesce(new_password, '')) < 8 then
    raise exception 'A nova senha deve ter pelo menos 8 caracteres';
  end if;

  select id, sofia_admin_password_hash
    into target_id, stored_hash
    from public.clinic_settings
   order by id
   limit 1;

  if target_id is null then
    raise exception 'Configuração da clínica não encontrada';
  end if;

  if stored_hash is null or stored_hash <> crypt(current_password, stored_hash) then
    return false;
  end if;

  update public.clinic_settings
     set sofia_admin_password_hash = crypt(new_password, gen_salt('bf', 12))
   where id = target_id;

  return found;
end;
$$;

revoke all on function public.change_sofia_admin_password(text, text) from public, anon;
grant execute on function public.change_sofia_admin_password(text, text) to authenticated;
