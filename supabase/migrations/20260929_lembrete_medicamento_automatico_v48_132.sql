-- v48.132 — Lembrete de suspensão de medicamento vira mensagem programada.
--
-- Rode depois da 20260928_alerta_medicamentos_cirurgia_v48_122.sql (e da
-- 20260928_descartar_avisos_parado_v48_123.sql, mesmo grupo). Pode rodar mais
-- de uma vez.
--
-- POR QUE
-- Pedido do Jorge: o aviso de véspera ("amanhã é o dia de suspender X") vivia
-- em cirurgia_avisos, esperando alguém abrir o CRM — tanto para NASCER
-- (avisar_suspensao_medicamentos só era chamada quando alguém abria a tela)
-- quanto para SER ENVIADO (card "Deseja avisar o paciente?", com botão
-- "Enviar agora"). Se ninguém abrisse o CRM naquele dia, o paciente
-- simplesmente não era avisado a tempo — risco clínico, diferente do PDF de
-- suspensão, que continua sendo emitido e enviado manualmente como sempre.
--
-- Em vez de inventar um mecanismo novo, isto usa o que já existe: a mesma
-- fila de "mensagens agendadas" (scheduled_messages) que já manda pré-
-- operatório, pós-operatório e retorno sozinha, todo santo dia, sem depender
-- de ninguém — o workflow "CRM - Mensagens Agendadas" no n8n varre essa
-- tabela a cada 1 minuto e manda pelo WhatsApp o que estiver com
-- scheduled_for no passado. O lembrete de medicamento passa a entrar nessa
-- mesma fila.
--
-- O QUE ENTRA
--
--   1. scheduled_messages.medicamento_id — liga a mensagem programada à
--      LINHA do remédio (mesma ideia de cirurgia_avisos.medicamento_id, v48.122),
--      pra aba Medicações perguntar "esse remédio já tem lembrete
--      programado/enviado?" direto.
--
--   2. agendar_lembrete_medicamento(id) — calcula a data de suspensão
--      (data_cirurgia − prazo_suspensao_dias) e faz upsert em
--      scheduled_messages (chave = 'medicacao_suspender:<id>', sempre a
--      mesma linha por remédio — recalcular só move a data, nunca duplica).
--      Se o remédio deixou de estar aprovado, ou a cirurgia foi cancelada/já
--      foi realizada, ou faltar data/paciente, o lembrete pendente é
--      descartado (superseded) em vez de mandado.
--
--   3. Um trigger em cirurgia_medicamentos chama isso sozinho assim que um
--      remédio é aprovado (ou reaprovado com prazo diferente).
--
--   4. sincronizar_mensagens_cirurgia() (o trigger de cirurgias que já
--      recalcula pré-op/pós-op quando a data muda) ganha mais uma linha:
--      mudou a data (ou o paciente vinculado, ou a categoria virou
--      cancelada/realizada), recalcula o lembrete de TODOS os remédios já
--      aprovados daquela cirurgia — sozinho, sem precisar reabrir a aba
--      Medicações nem clicar na IA de novo. É exatamente o pedido do Jorge:
--      "ao mudar a data, mude sozinha a data dos envios programados".
--
--   5. Backfill: remédios já aprovados antes desta migração ganham o
--      lembrete agora, na hora de rodar.
--
-- O que NÃO muda: avisar_suspensao_medicamentos() (a varredura antiga) e as
-- linhas antigas em cirurgia_avisos ficam como estão, sem uso novo — só o
-- zip parou de chamar a antiga (ver AvisoCirurgiaNotification.tsx v48.132).

-- ===========================================================================
-- 1) A liga entre a mensagem programada e o remédio
-- ===========================================================================
alter table public.scheduled_messages
  add column if not exists medicamento_id uuid references public.cirurgia_medicamentos(id) on delete cascade;

create index if not exists scheduled_messages_medicamento_idx
  on public.scheduled_messages (medicamento_id) where medicamento_id is not null;

-- ===========================================================================
-- 2) Calcula e agenda (ou descarta) o lembrete de UM remédio
-- ===========================================================================
create or replace function public.agendar_lembrete_medicamento(p_medicamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $ag$
declare
  med record;
  v_data_suspensao date;
  v_quando timestamptz;
  v_texto text;
  v_chave text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select cm.*, c.paciente_nome, c.contact_id, c.data_cirurgia, c.cirurgiao, c.categoria
    into med
    from public.cirurgia_medicamentos cm
    join public.cirurgias c on c.id = cm.cirurgia_id
   where cm.id = p_medicamento_id;

  if not found then return; end if;

  v_chave := 'medicacao_suspender:' || med.id::text;

  -- condições que invalidam o lembrete: não aprovado, sem prazo definido,
  -- sem cirurgia/data/paciente válido, ou cirurgia cancelada/já realizada —
  -- descarta o que estiver pendente (nunca mexe no que já foi enviado).
  if med.status is distinct from 'aprovado'
     or med.prazo_suspensao_dias is null
     or med.data_cirurgia is null
     or med.contact_id is null
     or coalesce(med.categoria, '') in ('cancelada', 'realizada') then
    update public.scheduled_messages
       set status = 'superseded', superseded_at = now()
     where idempotency_key = v_chave and status in ('scheduled', 'pending');
    return;
  end if;

  v_data_suspensao := med.data_cirurgia - med.prazo_suspensao_dias;

  if v_data_suspensao < v_hoje then
    -- a data de suspensão deste remédio já passou — tarde demais para
    -- avisar a tempo, não faz sentido mandar atrasado.
    update public.scheduled_messages
       set status = 'superseded', superseded_at = now()
     where idempotency_key = v_chave and status in ('scheduled', 'pending');
    return;
  end if;

  -- véspera às 9h. Se já passou das 9h da véspera (aprovado em cima da hora),
  -- manda o quanto antes, em vez de esperar o dia seguinte não existir mais.
  v_quando := ((v_data_suspensao - 1) + time '09:00') at time zone 'America/Sao_Paulo';
  if v_quando <= now() then v_quando := now() + interval '2 minutes'; end if;

  v_texto := 'Prezado(a) Sr(a). ' || initcap(lower(split_part(trim(coalesce(med.paciente_nome, '')), ' ', 1))) || ',' || chr(10) || chr(10)
    || 'Amanhã (' || to_char(v_data_suspensao, 'DD/MM/YYYY') || ') é o dia de suspender o uso de *' || med.nome_informado || '*, por causa da sua cirurgia marcada para '
    || to_char(med.data_cirurgia, 'DD/MM/YYYY') || '.' || chr(10) || chr(10)
    || coalesce(nullif(btrim(med.explicacao_paciente), ''), 'Qualquer dúvida, fale com a equipe antes de suspender.')
    || chr(10) || chr(10) || 'Equipe do(a) ' || coalesce(med.cirurgiao, 'clínica');

  insert into public.scheduled_messages (
    contact_id, content, scheduled_for, status, origin,
    cirurgia_id, medicamento_id, idempotency_key, reminder_type
  ) values (
    med.contact_id, v_texto, v_quando, 'scheduled', 'cirurgia',
    med.cirurgia_id, med.id, v_chave, 'medicacao_suspender'
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do update set
    contact_id     = excluded.contact_id,
    content        = excluded.content,
    scheduled_for  = excluded.scheduled_for,
    cirurgia_id    = excluded.cirurgia_id,
    medicamento_id = excluded.medicamento_id,
    reminder_type  = excluded.reminder_type,
    status = case
      when public.scheduled_messages.status in ('sent', 'failed') then public.scheduled_messages.status
      else 'scheduled'
    end,
    superseded_at = null,
    cancelled_at  = null;
end
$ag$;

grant execute on function public.agendar_lembrete_medicamento(uuid) to authenticated;

-- ===========================================================================
-- 3) Aprovou o remédio (ou reaprovou com prazo diferente) → agenda sozinho
-- ===========================================================================
create or replace function public.trg_cirurgia_medicamento_aprovado()
returns trigger
language plpgsql
security definer
set search_path = public
as $tcm$
begin
  if new.status = 'aprovado' and (
       tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.prazo_suspensao_dias is distinct from new.prazo_suspensao_dias
  ) then
    perform public.agendar_lembrete_medicamento(new.id);
  end if;
  return new;
end
$tcm$;

drop trigger if exists trg_cirurgia_medicamentos_lembrete on public.cirurgia_medicamentos;
create trigger trg_cirurgia_medicamentos_lembrete
  after insert or update on public.cirurgia_medicamentos
  for each row execute function public.trg_cirurgia_medicamento_aprovado();

-- ===========================================================================
-- 4) Mudou a data (ou o paciente, ou cancelou/realizou) → recalcula sozinho
-- ===========================================================================
create or replace function public.sincronizar_mensagens_cirurgia()
returns trigger
language plpgsql
security definer
set search_path = public
as $sinc$
declare
  m public.cirurgia_mensagens;
  v_sino boolean := false;
  v_mudou_status boolean;
  v_quando timestamptz;
  v_texto text;
  v_chave text;
begin
  if tg_op = 'UPDATE' and (
       old.data_cirurgia is distinct from new.data_cirurgia
    or old.hora          is distinct from new.hora
    or old.status        is distinct from new.status
    or old.hospital      is distinct from new.hospital
    or old.cirurgiao_id  is distinct from new.cirurgiao_id
    or old.contact_id    is distinct from new.contact_id
  ) then
    update public.scheduled_messages
       set status = 'superseded', superseded_at = now()
     where cirurgia_id = new.id
       and status in ('scheduled', 'pending')
       and reminder_type in (
         select 'cirurgia_' || tipo from public.cirurgia_mensagens
          where coalesce(quando, 'data_cirurgia') = 'data_cirurgia');
  end if;

  -- v48.132 — Data mudou (ou o paciente vinculado, ou a cirurgia virou
  -- cancelada/realizada): recalcula sozinho o lembrete de véspera de CADA
  -- remédio já aprovado desta cirurgia (agendar_lembrete_medicamento decide
  -- se reagenda para a data nova ou descarta, conforme o caso). Já aprovado
  -- continua aprovado — não força reabrir a aba Medicações nem clicar na IA
  -- de novo, só a data do envio muda.
  if tg_op = 'UPDATE' and (
       old.data_cirurgia is distinct from new.data_cirurgia
    or old.contact_id    is distinct from new.contact_id
    or old.categoria     is distinct from new.categoria
  ) then
    perform public.agendar_lembrete_medicamento(cm.id)
      from public.cirurgia_medicamentos cm
     where cm.cirurgia_id = new.id
       and cm.status = 'aprovado'
       and cm.prazo_suspensao_dias is not null;
  end if;

  if new.contact_id is null or new.data_cirurgia is null then
    return new;
  end if;

  v_mudou_status := tg_op = 'INSERT' or old.status is distinct from new.status;

  select coalesce(bool_or(dispara_mensagens), false) into v_sino
    from public.cirurgia_status
   where nome = new.status and ativo;

  for m in select * from public.cirurgia_mensagens where ativo order by ordem loop

    if coalesce(btrim(m.disparo_status), '') <> '' then
      continue when upper(btrim(m.disparo_status)) is distinct from upper(btrim(coalesce(new.status, '')));
      continue when not v_mudou_status;
    else
      continue when not v_sino;
    end if;

    v_texto := public.mensagem_cirurgia_texto(public.mensagem_cirurgia_escolhe(m, new), new);

    if m.quando = 'na_hora' then
      if exists (select 1 from public.cirurgia_avisos a
                  where a.cirurgia_id = new.id and a.tipo = m.tipo and a.status = 'pendente') then
        update public.cirurgia_avisos
           set texto = v_texto, titulo = m.titulo
         where cirurgia_id = new.id and tipo = m.tipo and status = 'pendente';
      else
        insert into public.cirurgia_avisos (cirurgia_id, contact_id, tipo, titulo, texto, chave)
        values (new.id, new.contact_id, m.tipo, m.titulo, v_texto,
                'cirurgia_' || m.tipo || ':' || new.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text)
        on conflict (chave) do nothing;
      end if;
      continue;
    end if;

    v_quando := ((new.data_cirurgia + m.dias_offset) + m.hora) at time zone 'America/Sao_Paulo';
    continue when v_quando <= now();

    v_chave := 'cirurgia_' || m.tipo || ':' || new.id::text || ':' || new.data_cirurgia::text;

    insert into public.scheduled_messages (
      contact_id, content, scheduled_for, status, origin,
      cirurgia_id, idempotency_key, reminder_type
    ) values (
      new.contact_id, v_texto, v_quando, 'scheduled', 'cirurgia',
      new.id, v_chave, 'cirurgia_' || m.tipo
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do update set
      contact_id    = excluded.contact_id,
      content       = excluded.content,
      scheduled_for = excluded.scheduled_for,
      cirurgia_id   = excluded.cirurgia_id,
      reminder_type = excluded.reminder_type,
      status = case
        when public.scheduled_messages.status in ('sent', 'failed')
          then public.scheduled_messages.status
        else 'scheduled'
      end,
      superseded_at = null,
      cancelled_at  = null;
  end loop;

  return new;
end
$sinc$;

-- ===========================================================================
-- 5) Backfill: remédios já aprovados antes desta migração ganham o lembrete
-- ===========================================================================
do $$
declare
  r record;
begin
  for r in select id from public.cirurgia_medicamentos
            where status = 'aprovado' and prazo_suspensao_dias is not null
  loop
    perform public.agendar_lembrete_medicamento(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
