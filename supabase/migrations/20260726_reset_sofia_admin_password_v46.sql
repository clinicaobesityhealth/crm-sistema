-- Corrige a troca de senha e redefine temporariamente a senha adicional para 12345678.
create extension if not exists pgcrypto;

update public.clinic_settings
set sofia_admin_password_hash = crypt('12345678', gen_salt('bf', 12));

create or replace function public.change_sofia_admin_password(current_password text, new_password text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare stored_hash text;
begin
  if not public.is_crm_admin(auth.uid()) then raise exception 'Acesso negado'; end if;
  if length(coalesce(new_password, '')) < 8 then raise exception 'A nova senha deve ter pelo menos 8 caracteres'; end if;
  select sofia_admin_password_hash into stored_hash from public.clinic_settings limit 1;
  if stored_hash is null or stored_hash <> crypt(current_password, stored_hash) then return false; end if;
  update public.clinic_settings set sofia_admin_password_hash = crypt(new_password, gen_salt('bf', 12));
  return true;
end;
$$;

revoke all on function public.change_sofia_admin_password(text, text) from public, anon;
grant execute on function public.change_sofia_admin_password(text, text) to authenticated;
