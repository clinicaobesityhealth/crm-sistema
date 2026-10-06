-- v48.150 — A notícia "cirurgia solicitada ao hospital" tem que chegar ao
-- paciente ANTES do aviso de suspender medicação.
--
-- Rode depois da 20260929_lembrete_solicitado_hospital_v48_134.sql. Pode
-- rodar mais de uma vez.
--
-- POR QUE
-- Pedido do Jorge, verbatim: "O AVISO DE QUE A CIRURGIA FOI SOLICITADA TEM
-- QUE VIR ANTES DO ENVIAR AVISO DE SUSPENDER MEDICACOES".
--
-- O MECANISMO REAL (não é fila de WhatsApp — é a ordem dos CARTÕES que a
-- secretária vê no CRM):
--
--   1. Quando a cirurgia entra em "SOLICITADO AO HOSPITAL", o mesmo gatilho
--      (sincronizar_mensagens_cirurgia) cria DUAS linhas em cirurgia_avisos
--      na mesma transação: a notícia "Cirurgia solicitada ao hospital"
--      (tipo 'agendada', para o paciente — v48.66/v48.67) e, se houver
--      remédio ainda não aprovado, a tarefa interna "Revisar medicações da
--      cirurgia" (tipo 'medicamentos_pendentes' — v48.97/v48.134).
--
--   2. AvisoCirurgiaNotification.tsx mostra só UM cartão por vez
--      (avisos[0], pedindo cirurgia_avisos ORDER BY criado_em) — o próximo só
--      aparece depois que a secretária decide o de cima.
--
--   3. Na v48.134, o bloco que cria a tarefa "medicamentos_pendentes" roda
--      ANTES do laço que cria o aviso 'agendada'. Como as duas linhas nascem
--      na mesma transação, now() (usado pelo default de criado_em) devolve o
--      MESMO instante para as duas — e o desempate cai pela ordem física de
--      inserção, que é a tarefa interna primeiro. Resultado: a secretária via
--      "Revisar medicações" antes de "Cirurgia solicitada ao hospital",
--      clicava em "Abrir medicações", aprovava e mandava o PDF de suspensão
--      — tudo isso com a notícia "solicitada ao hospital" ainda parada,
--      pendente, atrás na fila. O paciente recebia a suspensão de remédio
--      antes de saber que a cirurgia tinha sido solicitada.
--
-- O QUE MUDA
--   a) O laço que cria o aviso 'agendada' (a notícia ao paciente) passa a
--      rodar ANTES do bloco que cria a tarefa "medicamentos_pendentes".
--   b) Os dois INSERT em cirurgia_avisos passam a gravar
--      criado_em = clock_timestamp() explicitamente, em vez de confiar no
--      default now() (que é o mesmo instante para a transação inteira) —
--      assim o desempate em ORDER BY criado_em fica garantido pela ordem
--      real das instruções, não pela ordem física (não documentada) de
--      inserção em caso de empate.
-- Fora essa troca de ordem e o criado_em explícito, a função é idêntica à da
-- v48.134 — nenhuma outra regra muda.

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

  -- Data mudou (ou o paciente vinculado, ou a cirurgia virou
  -- cancelada/realizada): recalcula sozinho o lembrete de véspera de CADA
  -- remédio já aprovado desta cirurgia (agendar_lembrete_medicamento decide
  -- se reagenda para a data nova ou descarta, conforme o caso).
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

  if new.contact_id is not null and new.data_cirurgia is not null then
    v_mudou_status := tg_op = 'INSERT' or old.status is distinct from new.status;

    select coalesce(bool_or(dispara_mensagens), false) into v_sino
      from public.cirurgia_status
     where nome = new.status and ativo;

    -- v48.150 — Este laço (a NOTÍCIA ao paciente, tipo 'agendada' incluso)
    -- roda antes do bloco de baixo que cria a tarefa interna
    -- "medicamentos_pendentes": as duas competem pelo mesmo cartão único em
    -- AvisoCirurgiaNotification.tsx (avisos[0], ORDER BY criado_em), e é a
    -- notícia que tem que aparecer — e ser decidida — primeiro.
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
          insert into public.cirurgia_avisos (cirurgia_id, contact_id, tipo, titulo, texto, chave, criado_em)
          values (new.id, new.contact_id, m.tipo, m.titulo, v_texto,
                  'cirurgia_' || m.tipo || ':' || new.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text,
                  clock_timestamp())
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
  end if;

  -- v48.134/v48.150 — Virou "Solicitado ao Hospital" e ainda há remédio sem
  -- aprovar: lembra a secretária de revisar e enviar o documento de
  -- suspensão agora (é isso que agenda o lembrete de véspera). Reaproveita a
  -- mesma tarefa "medicamentos_pendentes" de sempre — sem remédio pendente,
  -- não cria nada. Fica DEPOIS do laço acima de propósito (ver cabeçalho
  -- desta migração): a notícia "Cirurgia solicitada ao hospital" precisa
  -- nascer primeiro, para aparecer primeiro no cartão único da secretária.
  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and upper(btrim(coalesce(new.status, ''))) = 'SOLICITADO AO HOSPITAL'
     and exists (
       select 1 from public.cirurgia_medicamentos cm
        where cm.cirurgia_id = new.id and cm.status is distinct from 'aprovado'
     )
  then
    v_texto := 'Revisar as medicações de ' || coalesce(new.paciente_nome, '')
      || ' e gerar/enviar o documento de suspensão — a cirurgia acabou de ser solicitada ao hospital, já com data prevista.';
    if exists (select 1 from public.cirurgia_avisos a
                where a.cirurgia_id = new.id and a.tipo = 'medicamentos_pendentes' and a.status = 'pendente') then
      update public.cirurgia_avisos
         set texto = v_texto, titulo = 'Revisar medicações da cirurgia'
       where cirurgia_id = new.id and tipo = 'medicamentos_pendentes' and status = 'pendente';
    else
      insert into public.cirurgia_avisos (cirurgia_id, contact_id, tipo, titulo, texto, chave, criado_em)
      values (new.id, new.contact_id, 'medicamentos_pendentes', 'Revisar medicações da cirurgia', v_texto,
              'medicamentos_pendentes:' || new.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text,
              clock_timestamp())
      on conflict (chave) do nothing;
    end if;
  end if;

  return new;
end
$sinc$;

notify pgrst, 'reload schema';
