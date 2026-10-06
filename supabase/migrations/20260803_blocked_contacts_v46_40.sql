-- v46.40: bloqueio de contatos sem nova tabela.
-- O estado fica em contacts.custom_fields para preservar compatibilidade com
-- todas as versões anteriores do CRM.

create or replace function public.crm_keep_blocked_contact_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((new.custom_fields ->> 'crm_blocked')::boolean, false) then
    new.conversation_status := 'closed';
    new.assigned_to := null;
    new.sofia_paused := true;
    new.custom_fields := coalesce(new.custom_fields, '{}'::jsonb)
      || jsonb_build_object('sofia_never_respond', true);
  end if;
  return new;
exception
  when invalid_text_representation then
    -- Um valor antigo não booleano nunca deve impedir a atualização do contato.
    return new;
end;
$$;

drop trigger if exists trg_crm_keep_blocked_contact_closed on public.contacts;
create trigger trg_crm_keep_blocked_contact_closed
before insert or update on public.contacts
for each row execute function public.crm_keep_blocked_contact_closed();

create index if not exists contacts_custom_fields_gin_idx
  on public.contacts using gin (custom_fields);

comment on function public.crm_keep_blocked_contact_closed() is
  'Impede que integrações reabram atendimento ou reativem Sofia para contatos bloqueados pelo CRM.';

create or replace function public.crm_prevent_outbound_to_blocked_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  contact_is_blocked boolean;
begin
  if new.direction = 'outbound' and new.status = 'queued' then
    select coalesce((custom_fields ->> 'crm_blocked')::boolean, false)
      into contact_is_blocked
      from public.contacts
     where id = new.contact_id;
    if contact_is_blocked then
      raise exception 'Contato bloqueado: envio externo impedido pelo CRM';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_prevent_outbound_to_blocked_contact on public.messages;
create trigger trg_crm_prevent_outbound_to_blocked_contact
before insert on public.messages
for each row execute function public.crm_prevent_outbound_to_blocked_contact();

comment on function public.crm_prevent_outbound_to_blocked_contact() is
  'Impede mensagens externas enfileiradas, inclusive automações, para contatos bloqueados.';
