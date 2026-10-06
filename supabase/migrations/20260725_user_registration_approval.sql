-- Cadastro público com aprovação administrativa.
-- Executar uma única vez no SQL Editor do Supabase antes do deploy da v40.

create table if not exists public.user_registration_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  provider text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

alter table public.user_registration_requests enable row level security;
revoke all on public.user_registration_requests from anon;
grant select, update on public.user_registration_requests to authenticated;

create or replace function public.is_crm_admin(check_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.agents where id = check_user and role = 'admin') $$;

drop policy if exists "registration_read_own_or_admin" on public.user_registration_requests;
create policy "registration_read_own_or_admin" on public.user_registration_requests
for select to authenticated using (user_id = auth.uid() or public.is_crm_admin());

drop policy if exists "registration_admin_update" on public.user_registration_requests;
create policy "registration_admin_update" on public.user_registration_requests
for update to authenticated using (public.is_crm_admin()) with check (public.is_crm_admin());

-- Garante que o administrador possa criar o perfil que libera o acesso.
drop policy if exists "agents_admin_insert" on public.agents;
create policy "agents_admin_insert" on public.agents
for insert to authenticated with check (public.is_crm_admin());

create or replace function public.create_crm_registration_request()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.agents where id = new.id) then
    insert into public.user_registration_requests(user_id, email, full_name, provider)
    values (
      new.id,
      coalesce(new.email, ''),
      coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email, ''), '@', 1)),
      coalesce(new.raw_app_meta_data->>'provider', new.raw_user_meta_data->>'registration_source', 'email')
    ) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_crm_registration on auth.users;
create trigger on_auth_user_created_crm_registration
after insert on auth.users for each row execute function public.create_crm_registration_request();

do $$ begin
  alter publication supabase_realtime add table public.user_registration_requests;
exception when duplicate_object then null;
end $$;

-- Privacidade por setor: a mensagem guarda o setor exclusivo em que nasceu.
-- Assim ela continua privada mesmo se o atendimento for transferido depois.
alter table public.messages add column if not exists visibility_sector_id uuid references public.sectors(id) on delete set null;
create index if not exists messages_visibility_sector_idx on public.messages(visibility_sector_id);

create or replace function public.mark_message_exclusive_sector()
returns trigger language plpgsql security definer set search_path = public
as $$
declare current_sector uuid;
begin
  if new.visibility_sector_id is null then
    select c.sector_id into current_sector
    from public.contacts c join public.sectors s on s.id = c.sector_id
    where c.id = new.contact_id and s.is_exclusive = true;
    new.visibility_sector_id := current_sector;
  end if;
  return new;
end;
$$;

drop trigger if exists before_message_mark_exclusive_sector on public.messages;
create trigger before_message_mark_exclusive_sector before insert on public.messages
for each row execute function public.mark_message_exclusive_sector();

-- Conversas que já estão hoje em setor exclusivo recebem a marca de privacidade
-- em todo o histórico, evitando exposição de conteúdo antigo na primeira implantação.
update public.messages m set visibility_sector_id = c.sector_id
from public.contacts c join public.sectors s on s.id = c.sector_id
where m.contact_id = c.id and s.is_exclusive = true and m.visibility_sector_id is null;
