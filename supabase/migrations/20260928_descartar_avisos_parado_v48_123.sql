-- v48.123 — Descartar aviso de "parado há mais de X dias" quando a situação muda.
--
-- Rode depois da 20260928_alerta_medicamentos_cirurgia_v48_122.sql. Pode rodar de novo.
--
-- POR QUE
-- avisar_cirurgias_paradas() (v48.82) cria um cirurgia_avisos pendente quando
-- uma cirurgia fica X dias parada numa situação (ex.: 30 dias em
-- PRÉ-OPERATÓRIO). Esse aviso fica na fila da secretária até ela revisar e
-- mandar — mas se, ENQUANTO ele está pendente, a cirurgia mudar de situação
-- (ex.: PRÉ-OPERATÓRIO → AGENDAR, ela não está mais "parada"), nada apagava
-- esse aviso: a secretária podia acabar mandando pro paciente uma mensagem de
-- "você está há mais de 30 dias sem retorno" bem depois de ele já ter sido
-- agendado — o oposto do que a mensagem deveria dizer.
--
-- Mesmo padrão já usado pelo lembrete de suspensão de medicamento (v48.122):
-- quando o motivo que criou o aviso deixa de valer, o aviso pendente é
-- descartado (status='descartado'). Se a cirurgia empacar de novo depois (ou
-- voltar pra PRÉ-OPERATÓRIO e ficar parada outra vez), a próxima varredura de
-- avisar_cirurgias_paradas() cria um aviso novo, sozinha — nada aqui impede
-- isso, porque o descarte só mexe no que já existia.

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

  -- v48.122 — Só a data importa aqui: o lembrete de suspensão é por remédio, e
  -- o único dado da mensagem que depende da cirurgia é "amanhã é dia
  -- {data}" — trocar hospital ou cirurgião não invalida o aviso.
  if tg_op = 'UPDATE' and old.data_cirurgia is distinct from new.data_cirurgia then
    update public.cirurgia_avisos
       set status = 'descartado', decidido_em = now()
     where cirurgia_id = new.id
       and tipo = 'medicacao_suspender'
       and status = 'pendente';
  end if;

  -- v48.123 — Mudou a situação: qualquer aviso "parado há X dias" ainda
  -- pendente cujo motivo (a situação configurada no modelo, ex.:
  -- PRÉ-OPERATÓRIO) não é mais a situação atual da cirurgia deixa de valer.
  -- Junta pelo tipo (cada modelo "parado" tem o seu) e compara com a
  -- situação NOVA — se a cirurgia saiu de PRÉ-OPERATÓRIO pra AGENDAR, o aviso
  -- de PRÉ-OPERATÓRIO parado cai; se ela caiu de novo em PRÉ-OPERATÓRIO
  -- depois, a próxima varredura cria um aviso novo, sozinha.
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    update public.cirurgia_avisos a
       set status = 'descartado', decidido_em = now()
     where a.cirurgia_id = new.id
       and a.status = 'pendente'
       and exists (
         select 1 from public.cirurgia_mensagens m2
          where m2.quando = 'parado'
            and m2.tipo = a.tipo
            and upper(btrim(coalesce(m2.disparo_status, ''))) is distinct from upper(btrim(coalesce(new.status, '')))
       );
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

notify pgrst, 'reload schema';
