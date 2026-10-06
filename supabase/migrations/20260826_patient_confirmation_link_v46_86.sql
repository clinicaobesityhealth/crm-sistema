-- Link de confirmação de consulta pelo próprio paciente (v46.86)
--
-- O QUE FAZ:
-- 1) Duas colunas novas e aditivas em `agendamentos`: patient_confirmed_at e
--    patient_declined_at. NÃO mexe na coluna `status` — aquela continua
--    exclusivamente sob controle do sync automático com o MedX.
-- 2) Recria sync_consulta_confirmation_reminder() só pra acrescentar o link
--    de confirmação (/confirmar/<id do agendamento>) no texto da mensagem
--    de lembrete. Todo o resto da função (regras de quando enviar, colunas
--    observadas pelo gatilho, idempotência etc.) fica IDÊNTICO ao que já
--    está em produção (20260810_consulta_confirmation_reminders_v46_49.sql).
-- 3) Atualiza o conteúdo dos lembretes de confirmação já agendados (ainda
--    não enviados) pra que também ganhem o link, sem esperar a próxima
--    edição do agendamento no MedX.
--
-- IMPORTANTE — ORDEM DE APLICAÇÃO:
-- Só rode esta migração DEPOIS que a nova versão do app (com a rota pública
-- /confirmar/[id] e a API /api/confirmacao/[id]) já estiver publicada e no
-- ar em produção. Antes disso, os lembretes já saem sem o link — não tem
-- problema nenhum esperar, e assim que rodar a migração, os PRÓXIMOS
-- lembretes (e os já agendados, via passo 3 acima) passam a sair com o link.

alter table public.agendamentos
  add column if not exists patient_confirmed_at timestamptz,
  add column if not exists patient_declined_at timestamptz;

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

  -- v46.86: acrescenta o link de confirmação pro próprio paciente. O id usado
  -- no link é sempre o id interno do agendamento (new.id) — é o que a rota
  -- pública /confirmar/[id] e a API /api/confirmacao/[id] esperam.
  v_content := format(
    'Olá, %s! Tudo bem? Estamos entrando em contato para confirmar sua consulta com %s no dia %s às %s. Por favor, toque no link abaixo para confirmar presença ou avisar que não poderá comparecer:%s%s',
    coalesce(nullif(new.paciente_nome, ''), 'tudo bem'),
    coalesce(nullif(new.profissional_nome, ''), 'nossa equipe'),
    to_char(new.data, 'DD/MM/YYYY'),
    left(coalesce(new.hora::text, ''), 5),
    chr(10),
    'https://crm.obesityhealth.com.br/confirmar/' || new.id::text
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

-- A trigger em si não muda (mesmo nome, mesma função, mesmas colunas
-- observadas) — só recriamos por segurança/idempotência da migração.
drop trigger if exists trg_sync_consulta_confirmation_reminder on public.agendamentos;
create trigger trg_sync_consulta_confirmation_reminder
after insert or update of contact_id, data, hora, status, medx_agendamento_id, professional_id, profissional_nome
on public.agendamentos
for each row execute function public.sync_consulta_confirmation_reminder();

-- Passo 3: re-gera o conteúdo dos lembretes de confirmação já agendados
-- (ainda não enviados) pra consultas futuras não canceladas, pra que
-- ganhem o link sem precisar esperar uma nova edição no MedX. O gatilho
-- observa a coluna `status`; "set status = status" não muda o valor mas
-- ainda dispara a trigger (mesmo truque já usado na migração anterior).
update public.agendamentos
   set status = status
 where data >= (now() at time zone 'America/Sao_Paulo')::date
   and lower(coalesce(status, '')) not like 'cancel%';
