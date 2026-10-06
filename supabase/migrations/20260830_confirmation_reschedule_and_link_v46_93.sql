-- Junta duas correções na mesma função (v46.93):
--
-- 1) v46.60 (aplicada hoje): não deixa a trava "não disparar retroativo"
--    (pensada para recálculo em massa de configurações) bloquear também
--    consultas novas ou remarcadas de fato perto do horário padrão do
--    lembrete — nesses casos o lembrete sai para envio imediato em vez de
--    simplesmente não ser criado.
--
-- 2) v46.86 (26/08, já estava em produção, mas foi PISADA sem querer pela
--    migração da correção 1 acima porque as duas mudam a mesma função e a
--    v46.60 foi escrita em cima do corpo antigo, sem o link): acrescenta o
--    link de confirmação do próprio paciente (/confirmar/<id do agendamento>)
--    no texto do lembrete.
--
-- Esta migração é a soma das duas — nenhuma lógica de nenhuma delas foi
-- perdida. A partir de agora só deve existir UMA migração "fonte da verdade"
-- para esta função (esta aqui); qualquer alteração futura na função deve
-- partir do corpo abaixo.
--
-- Pré-requisito (já deve estar em produção desde a v46.86, não deveria
-- precisar reaplicar): colunas patient_confirmed_at/patient_declined_at em
-- agendamentos, e a variável SUPABASE_SERVICE_ROLE_KEY configurada no
-- EasyPanel para a rota /api/confirmacao/[id] funcionar. Os comandos abaixo
-- são idempotentes (if not exists) então não tem problema rodar de novo.

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
  v_is_new_or_rescheduled boolean := false;
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

  -- v46.60: consulta nova (insert) ou remarcação de fato (data/hora/
  -- profissional/contato mudaram) merece lembrete mesmo que o horário
  -- padrão já tenha passado. Um re-sync/backfill que não mudou nada
  -- continua respeitando a janela normalmente.
  v_is_new_or_rescheduled := (tg_op = 'INSERT') or v_old_changed;

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

  if v_scheduled_for <= now() then
    if v_is_new_or_rescheduled then
      -- v46.60: consulta nova ou remarcada perto (ou depois) do horário
      -- padrão do lembrete: manda a confirmação agora, em vez de não gerar
      -- nenhuma.
      v_scheduled_for := now() + interval '1 minute';
    else
      -- Backfill/config change sobre consulta já existente sem mudança
      -- real: não transforma isso em disparo retroativo.
      return new;
    end if;
  end if;

  v_external_key := coalesce(nullif(new.medx_agendamento_id::text, ''), 'crm-' || new.id::text);
  v_idempotency_key := 'confirmar_consulta:' || v_external_key || ':' || new.data::text || ':' || coalesce(new.hora::text, '');

  -- v46.86: link de confirmação pro próprio paciente. O id usado no link é
  -- sempre o id interno do agendamento (new.id) — é o que a rota pública
  -- /confirmar/[id] e a API /api/confirmacao/[id] esperam.
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

drop trigger if exists trg_sync_consulta_confirmation_reminder on public.agendamentos;
create trigger trg_sync_consulta_confirmation_reminder
after insert or update of contact_id, data, hora, status, medx_agendamento_id, professional_id, profissional_nome
on public.agendamentos
for each row execute function public.sync_consulta_confirmation_reminder();

-- Re-gera o conteúdo dos lembretes já agendados (ainda não enviados) para
-- consultas futuras não canceladas, para que ganhem o link agora, sem
-- esperar uma nova edição no MedX. Cobre também os lembretes que a v46.60
-- criou hoje sem link (por causa da migração ter pisado a v46.86).
update public.agendamentos
   set status = status
 where data >= (now() at time zone 'America/Sao_Paulo')::date
   and lower(coalesce(status, '')) not like 'cancel%';
