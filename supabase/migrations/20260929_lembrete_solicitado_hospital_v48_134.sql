-- v48.134 — Ao virar "Solicitado ao Hospital", lembra a secretária de revisar
-- e enviar o documento de suspensão (se houver remédio pendente).
--
-- Rode depois da 20260929_lembrete_medicamento_automatico_v48_132.sql.
-- Pode rodar mais de uma vez.
--
-- POR QUE
-- Pedido do Jorge: "ao mudar para solicitado ao hospital já pergunte a
-- secretária se deseja enviar o pdf e programar as msg". Nesse momento a
-- cirurgia já tem data provável — é o ponto certo para revisar/aprovar as
-- medicações, porque é a APROVAÇÃO (gerar o PDF de suspensão) que agenda o
-- lembrete de véspera sozinho (agendar_lembrete_medicamento, v48.132).
--
-- Em vez de um botão novo "enviar agora" solto num card (a aprovação exige
-- revisão médica — prazo e explicação de cada remédio — então não dá pra
-- disparar o PDF sozinho, sem alguém olhar), isto reaproveita a tarefa que já
-- existia na tela para exatamente esse fim: "medicamentos_pendentes" (v48.97,
-- cadastrada mas nunca ativada). Ela já tem card próprio em
-- AvisoCirurgiaNotification.tsx ("Tarefa da equipe" → botão "Abrir
-- cirurgias") — não precisa de nada novo no zip, só nascer sozinha na hora
-- certa.
--
-- O QUE ENTRA
-- sincronizar_mensagens_cirurgia() ganha mais uma checagem: o status (não a
-- categoria) mudou para 'SOLICITADO AO HOSPITAL' e existe pelo menos um
-- cirurgia_medicamentos desta cirurgia ainda não aprovado → cria (ou atualiza,
-- se já tiver uma pendente) o aviso "Revisar medicações da cirurgia". Sem
-- remédio pendente (nenhum remédio, ou todos já aprovados), não cria nada —
-- não faz sentido incomodar quem não tem o que revisar.

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

  -- v48.134 — Virou "Solicitado ao Hospital" e ainda há remédio sem aprovar:
  -- lembra a secretária de revisar e enviar o documento de suspensão agora
  -- (é isso que agenda o lembrete de véspera). Reaproveita a mesma tarefa
  -- "medicamentos_pendentes" de sempre — sem remédio pendente, não cria nada.
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
      insert into public.cirurgia_avisos (cirurgia_id, contact_id, tipo, titulo, texto, chave)
      values (new.id, new.contact_id, 'medicamentos_pendentes', 'Revisar medicações da cirurgia', v_texto,
              'medicamentos_pendentes:' || new.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text)
      on conflict (chave) do nothing;
    end if;
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
