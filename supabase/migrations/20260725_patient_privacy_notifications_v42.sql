-- Avisos automáticos ao paciente ao entrar ou sair de setores exclusivos.
-- A regra fica no banco para cobrir todas as formas de transferência do CRM.

create or replace function public.notify_patient_sector_privacy_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_is_private boolean := false;
  new_is_private boolean := false;
  responsible_name text;
  message_channel text := 'whatsapp';
  notice_text text;
begin
  if new.sector_id is not distinct from old.sector_id then
    return new;
  end if;

  if old.sector_id is not null then
    select coalesce(is_exclusive, false) into old_is_private
    from public.sectors where id = old.sector_id;
  end if;

  if new.sector_id is not null then
    select coalesce(is_exclusive, false) into new_is_private
    from public.sectors where id = new.sector_id;
  end if;

  select name into responsible_name
  from public.agents where id = new.assigned_to;

  select case when channel in ('whatsapp', 'instagram') then channel else 'whatsapp' end
  into message_channel
  from public.messages
  where contact_id = new.id
  order by created_at desc
  limit 1;

  message_channel := coalesce(message_channel, 'whatsapp');

  -- Entrou em setor privado ou mudou de um setor privado para outro.
  if new_is_private and (not old_is_private or old.sector_id is distinct from new.sector_id) then
    notice_text := '🔒 *Atendimento privado ativado*' || E'\n\n' ||
      'A partir de agora, as novas mensagens deste atendimento poderão ser visualizadas apenas pelo(a) profissional responsável' ||
      case when responsible_name is not null then ' *' || responsible_name || '* ' else ' ' end ||
      'e por profissionais autorizados deste setor. Essa proteção preserva a confidencialidade da relação profissional-paciente.';

  -- Saiu de um setor privado para setor público ou para o Inbox.
  elsif old_is_private and not new_is_private then
    notice_text := '🔓 *Modo privado desativado*' || E'\n\n' ||
      'A partir de agora, as novas mensagens poderão ser visualizadas pela equipe autorizada responsável pelo atendimento. ' ||
      'As mensagens trocadas durante o modo privado permanecem protegidas.';
  end if;

  if notice_text is not null then
    insert into public.messages (
      contact_id, channel, direction, content, status, sender_id, send_via
    ) values (
      new.id, message_channel, 'outbound', notice_text, 'queued', new.assigned_to, message_channel
    );
  end if;

  return new;
end;
$$;

drop trigger if exists after_contact_sector_privacy_notice on public.contacts;
create trigger after_contact_sector_privacy_notice
after update of sector_id on public.contacts
for each row
when (old.sector_id is distinct from new.sector_id)
execute function public.notify_patient_sector_privacy_change();

