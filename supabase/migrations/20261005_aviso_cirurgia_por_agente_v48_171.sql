-- v48.171 — Jorge: quando a Daniella muda a situação de uma cirurgia, a
-- janela "Deseja avisar o paciente?" aparece para ELA (certo) e também para
-- ELE (errado) — e para qualquer outro atendente logado na hora. Só deveria
-- aparecer para quem fez a alteração.
--
-- POR QUE ACONTECIA
-- O aviso (cirurgia_avisos) é criado por um gatilho no banco quando a
-- situação da cirurgia muda, sem saber qual tela/pessoa fez a mudança — e o
-- componente que mostra a janela (AvisoCirurgiaNotification.tsx) busca TODOS
-- os avisos pendentes, para TODOS os atendentes logados, de propósito: assim
-- um aviso nunca se perde mesmo que ninguém estivesse olhando na hora da
-- mudança (ex.: uma sincronização automática).
--
-- A CORREÇÃO
-- O gatilho passa a gravar QUEM mudou a situação (auth.uid(), do token de
-- quem fez a requisição) em cirurgia_avisos.criado_por. O componente (código
-- em InternalChat.tsx/AvisoCirurgiaNotification.tsx, v48.171) só mostra a
-- janela para esse agente — e, como rede de segurança (mudança feita por
-- automação sem usuário, ou a pessoa que mudou sair sem decidir), continua
-- aparecendo para QUALQUER UM depois de 2 horas sem decisão, ou se
-- criado_por ficar vazio (ex.: sincronização via chave de serviço, sem um
-- usuário logado por trás).
--
-- Pode rodar de novo sem problema.

alter table public.cirurgia_avisos
  add column if not exists criado_por uuid;

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
    v_chave := 'cirurgia_' || m.tipo || ':' || new.id::text || ':' || new.data_cirurgia::text;

    -- NOTÍCIA: vira aviso para a secretária decidir. Não sai sozinha.
    -- v48.171 — criado_por grava quem fez a mudança (auth.uid()), para o
    -- aviso aparecer só para essa pessoa (com rede de segurança — ver
    -- comentário no topo deste arquivo).
    if m.quando = 'na_hora' then
      insert into public.cirurgia_avisos (cirurgia_id, contact_id, tipo, titulo, texto, chave, criado_por)
      values (new.id, new.contact_id, m.tipo, m.titulo, v_texto, v_chave, auth.uid())
      on conflict (chave) do update
        set texto = excluded.texto, titulo = excluded.titulo, criado_por = excluded.criado_por
      where public.cirurgia_avisos.status = 'pendente';
      continue;
    end if;

    -- ROTINA: agenda, como antes.
    v_quando := ((new.data_cirurgia + m.dias_offset) + m.hora) at time zone 'America/Sao_Paulo';
    continue when v_quando <= now();

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
