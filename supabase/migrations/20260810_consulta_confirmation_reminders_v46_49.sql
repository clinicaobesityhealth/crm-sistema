-- Confirmação automática de consultas (v46.49)
-- Toda inclusão/atualização em agendamentos passa por este gatilho, inclusive MedX -> CRM.

alter table public.scheduled_messages
  add column if not exists medx_agendamento_id text,
  add column if not exists agendamento_id text,
  add column if not exists message_id text,
  add column if not exists idempotency_key text,
  add column if not exists superseded_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists reminder_type text;

alter table public.clinic_settings
  add column if not exists consulta_reminder_enabled boolean not null default true,
  add column if not exists consulta_reminder_days_before integer not null default 1,
  add column if not exists consulta_reminder_time time not null default '10:00';

alter table public.clinic_settings
  drop constraint if exists clinic_settings_consulta_reminder_days_before_check;
alter table public.clinic_settings
  add constraint clinic_settings_consulta_reminder_days_before_check
  check (consulta_reminder_days_before between 0 and 30);

create unique index if not exists scheduled_messages_idempotency_key_uidx
  on public.scheduled_messages (idempotency_key)
  where idempotency_key is not null;

create index if not exists scheduled_messages_medx_agendamento_idx
  on public.scheduled_messages (medx_agendamento_id);

create index if not exists scheduled_messages_agendamento_idx
  on public.scheduled_messages (agendamento_id);

-- Defesa final contra concorrência: no máximo uma confirmação ativa por consulta.
-- Se esta migração for reaplicada sobre uma tentativa anterior, preserva apenas o
-- registro ativo mais recente antes de criar a trava de unicidade.
with ranked_active as (
  select id,
         row_number() over (
           partition by coalesce(medx_agendamento_id, 'crm-' || agendamento_id)
           order by scheduled_for desc, created_at desc, id desc
         ) as position
    from public.scheduled_messages
   where coalesce(reminder_type, case when origin = 'appointment_confirmation' then 'confirmar_consulta' end) = 'confirmar_consulta'
     and status in ('scheduled', 'pending')
)
update public.scheduled_messages sm
   set status = 'superseded', superseded_at = now()
  from ranked_active r
 where sm.id = r.id and r.position > 1;

update public.scheduled_messages
   set reminder_type = 'confirmar_consulta'
 where reminder_type is null and origin = 'appointment_confirmation';

create unique index if not exists scheduled_messages_one_active_confirmation_uidx
  on public.scheduled_messages ((coalesce(medx_agendamento_id, 'crm-' || agendamento_id)), reminder_type)
  where reminder_type = 'confirmar_consulta' and status in ('scheduled', 'pending');

create or replace function public.sync_consulta_confirmation_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send_date date;
  v_scheduled_for timestamptz;
  v_external_key text;
  v_idempotency_key text;
  v_content text;
  v_old_changed boolean := false;
  v_is_cancelled boolean := false;
  v_enabled boolean := true;
  v_days_before integer := 1;
  v_send_time time := time '10:00';
begin
  v_is_cancelled := lower(coalesce(new.status, '')) like 'cancel%';

  if tg_op = 'UPDATE' then
    v_old_changed := old.data is distinct from new.data
      or old.hora is distinct from new.hora
      or old.professional_id is distinct from new.professional_id
      or old.profissional_nome is distinct from new.profissional_nome
      or old.medx_agendamento_id is distinct from new.medx_agendamento_id
      or old.contact_id is distinct from new.contact_id;

    if v_old_changed then
      update public.scheduled_messages
         set status = 'superseded', superseded_at = now()
       where agendamento_id = old.id::text
         and origin = 'appointment_confirmation'
         and status in ('scheduled', 'pending');
    end if;
  end if;

  if v_is_cancelled then
    update public.scheduled_messages
       set status = 'cancelled', cancelled_at = now()
     where agendamento_id = new.id::text
       and origin = 'appointment_confirmation'
       and status in ('scheduled', 'pending');
    return new;
  end if;

  if new.contact_id is null or new.data is null then
    return new;
  end if;

  select consulta_reminder_enabled, consulta_reminder_days_before, consulta_reminder_time
    into v_enabled, v_days_before, v_send_time
    from public.clinic_settings
   order by updated_at desc nulls last
   limit 1;

  if not coalesce(v_enabled, true) then
    update public.scheduled_messages
       set status = 'cancelled', cancelled_at = now()
     where agendamento_id = new.id::text
       and reminder_type = 'confirmar_consulta'
       and status in ('scheduled', 'pending');
    return new;
  end if;

  v_send_date := new.data - coalesce(v_days_before, 1);
  v_scheduled_for := (v_send_date + coalesce(v_send_time, time '10:00')) at time zone 'America/Sao_Paulo';

  -- Não transforma configurações/backfills em disparos retroativos.
  if v_scheduled_for <= now() then
    return new;
  end if;
  v_external_key := coalesce(nullif(new.medx_agendamento_id::text, ''), 'crm-' || new.id::text);
  v_idempotency_key := 'confirmar_consulta:' || v_external_key || ':' || new.data::text || ':' || coalesce(new.hora::text, '');

  v_content := format(
    'Olá, %s! Tudo bem? Estamos entrando em contato para confirmar sua consulta com %s no dia %s às %s. Você poderá comparecer? Se precisar cancelar ou reagendar, responda por aqui que ajudamos você.',
    coalesce(nullif(new.paciente_nome, ''), 'tudo bem'),
    coalesce(nullif(new.profissional_nome, ''), 'nossa equipe'),
    to_char(new.data, 'DD/MM/YYYY'),
    left(coalesce(new.hora::text, ''), 5)
  );

  insert into public.scheduled_messages (
    contact_id, content, scheduled_for, status, origin,
    medx_agendamento_id, agendamento_id, idempotency_key, reminder_type
  ) values (
    new.contact_id, v_content, v_scheduled_for, 'scheduled', 'appointment_confirmation',
    nullif(new.medx_agendamento_id::text, ''), new.id::text, v_idempotency_key, 'confirmar_consulta'
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do update set
    contact_id = excluded.contact_id,
    content = excluded.content,
    scheduled_for = excluded.scheduled_for,
    medx_agendamento_id = excluded.medx_agendamento_id,
    agendamento_id = excluded.agendamento_id,
    reminder_type = excluded.reminder_type,
    status = case
      when public.scheduled_messages.status in ('sent', 'failed') then public.scheduled_messages.status
      else 'scheduled'
    end,
    cancelled_at = null,
    superseded_at = null;

  return new;
end;
$$;

drop trigger if exists trg_sync_consulta_confirmation_reminder on public.agendamentos;
create trigger trg_sync_consulta_confirmation_reminder
after insert or update of contact_id, data, hora, status, medx_agendamento_id, professional_id, profissional_nome
on public.agendamentos
for each row execute function public.sync_consulta_confirmation_reminder();

-- Alterar a configuração recalcula somente confirmações ainda ativas.
create or replace function public.resync_consulta_confirmation_reminders_on_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.consulta_reminder_enabled is distinct from new.consulta_reminder_enabled
     or old.consulta_reminder_days_before is distinct from new.consulta_reminder_days_before
     or old.consulta_reminder_time is distinct from new.consulta_reminder_time then
    update public.agendamentos
       set status = status
     where data >= (now() at time zone 'America/Sao_Paulo')::date
       and lower(coalesce(status, '')) not like 'cancel%';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_resync_consulta_confirmation_reminders on public.clinic_settings;
create trigger trg_resync_consulta_confirmation_reminders
after update of consulta_reminder_enabled, consulta_reminder_days_before, consulta_reminder_time
on public.clinic_settings
for each row execute function public.resync_consulta_confirmation_reminders_on_settings_change();

-- Cria os lembretes dos agendamentos futuros já existentes, sem duplicar.
update public.agendamentos
   set status = status
 where ((data - coalesce((select consulta_reminder_days_before from public.clinic_settings order by updated_at desc nulls last limit 1), 1))
          + coalesce((select consulta_reminder_time from public.clinic_settings order by updated_at desc nulls last limit 1), time '10:00'))
          at time zone 'America/Sao_Paulo' > now()
   and lower(coalesce(status, '')) not like 'cancel%';
