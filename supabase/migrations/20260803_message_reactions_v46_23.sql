-- Reações são metadados da mensagem: nunca entram em public.messages.
-- Assim não abrem conversa, não alteram last_contacted_at e não acionam a Sofia.
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  external_message_id text not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 32),
  reactor_type text not null check (reactor_type in ('patient', 'agent')),
  reactor_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_reactions_one_per_reactor unique (message_id, reactor_type, reactor_id)
);

create index if not exists message_reactions_contact_id_idx
  on public.message_reactions(contact_id);
create index if not exists message_reactions_external_message_id_idx
  on public.message_reactions(external_message_id);

alter table public.message_reactions enable row level security;

drop policy if exists "authenticated can read message reactions" on public.message_reactions;
create policy "authenticated can read message reactions"
  on public.message_reactions for select to authenticated using (true);

-- Escritas do CRM e do WhatsApp passam pelo n8n com service_role.
-- Nenhuma policy de INSERT/UPDATE/DELETE é aberta ao navegador.

do $$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception
  when duplicate_object then null;
end $$;
