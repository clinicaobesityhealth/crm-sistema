-- v48.66 — Mensagem avisando que a cirurgia foi agendada e que foi autorizada.
--
-- Rode depois da 20260915_mensagens_cirurgia_v48_07.sql. Pode rodar de novo.
--
-- O que muda e por quê:
--
-- Até aqui todo modelo dependia da MESMA situação (a marcada com o sino) e saía
-- em relação à DATA DA CIRURGIA — "véspera às 9h", "dia seguinte às 10h". Isso
-- serve para orientação, mas não para notícia: "o convênio autorizou" só faz
-- sentido no momento em que autoriza, e "foi solicitada ao hospital" acontece
-- numa situação diferente.
--
-- Então cada modelo passa a dizer duas coisas por conta própria:
--   disparo_status — em que situação ele dispara (vazio = a do sino, como antes)
--   quando         — 'data_cirurgia' (offset, como antes) ou 'na_hora'
--                    (sai logo depois da mudança, com um atraso curto)
--
-- O atraso curto do 'na_hora' existe para dar tempo de corrigir um clique
-- errado: quem mudou a situação por engano tem alguns minutos para voltar
-- atrás antes de o paciente receber.

alter table public.cirurgia_mensagens
  add column if not exists disparo_status text,
  add column if not exists quando text not null default 'data_cirurgia',
  add column if not exists minutos_atraso integer not null default 10;

-- ===========================================================================
-- Modelos novos (nascem DESLIGADOS, como os outros)
-- ===========================================================================
insert into public.cirurgia_mensagens
  (tipo, titulo, dias_offset, hora, texto, ativo, ordem, disparo_status, quando, minutos_atraso)
select * from (values
  ('agendada', 'Cirurgia solicitada ao hospital', 0, time '09:00',
$T$Prezado(a) Sr(a). {primeiro_nome},

Sua cirurgia ({cirurgia}) foi solicitada ao {hospital} e está em análise pelo convênio.

Data prevista: {data} às {hora}.

Assim que o convênio autorizar, avisamos o(a) senhor(a) por aqui.

Equipe Obesity Health$T$, false, 0, 'SOLICITADO AO HOSPITAL', 'na_hora', 10),

  ('autorizada', 'Cirurgia autorizada pelo convênio', 0, time '09:00',
$T$Prezado(a) Sr(a). {primeiro_nome},

Boa notícia: o convênio autorizou a sua cirurgia ({cirurgia}).

Data: {data} às {hora}
Hospital: {hospital}
Cirurgião: {cirurgiao}

Nos próximos dias enviamos as orientações do pré-operatório. Qualquer dúvida, fale com a equipe: {whatsapp_cirurgiao}

Equipe Obesity Health$T$, false, 3, 'AUTORIZADA', 'na_hora', 10)
) as novos(tipo, titulo, dias_offset, hora, texto, ativo, ordem, disparo_status, quando, minutos_atraso)
where not exists (select 1 from public.cirurgia_mensagens c where c.tipo = novos.tipo);

-- ===========================================================================
-- O gatilho, agora decidindo modelo a modelo
-- ===========================================================================
create or replace function public.sincronizar_mensagens_cirurgia()
returns trigger
language plpgsql
security definer
set search_path = public
as $sinc$
declare
  m record;
  v_sino boolean := false;
  v_mudou_status boolean;
  v_quando timestamptz;
  v_texto text;
  v_chave text;
  v_tel text;
  v_whats text;
  v_primeiro text;
begin
  -- Qualquer mudança que afete a mensagem invalida o que estava agendado.
  if tg_op = 'UPDATE' and (
       old.data_cirurgia is distinct from new.data_cirurgia
    or old.hora          is distinct from new.hora
    or old.status        is distinct from new.status
    or old.hospital      is distinct from new.hospital
    or old.cirurgiao_id  is distinct from new.cirurgiao_id
    or old.contact_id    is distinct from new.contact_id
  ) then
    -- Só o que depende da DATA da cirurgia é refeito. Um aviso do tipo
    -- "o convênio autorizou", que já está a caminho com poucos minutos de
    -- espera, não pode ser derrubado porque alguém corrigiu o hospital na
    -- linha seguinte: ele nunca mais seria recriado, e o paciente ficaria sem
    -- a notícia.
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

  select telefone into v_tel from public.cirurgia_equipe where id = new.cirurgiao_id;
  v_whats := case
    when coalesce(v_tel, '') = '' then 'o WhatsApp da clínica'
    else 'https://wa.me/' || regexp_replace(v_tel, '[^0-9]', '', 'g')
  end;

  v_primeiro := split_part(trim(coalesce(new.paciente_nome, '')), ' ', 1);

  for m in select * from public.cirurgia_mensagens where ativo order by ordem loop

    -- Este modelo tem situação própria? Então só dispara nela, e só quando a
    -- situação acabou de mudar — senão qualquer edição da linha (trocar o
    -- hospital, corrigir a hora) mandaria a notícia de novo.
    if coalesce(btrim(m.disparo_status), '') <> '' then
      continue when upper(btrim(m.disparo_status)) is distinct from upper(btrim(coalesce(new.status, '')));
      continue when not v_mudou_status;
    else
      continue when not v_sino;
    end if;

    if m.quando = 'na_hora' then
      v_quando := now() + make_interval(mins => greatest(coalesce(m.minutos_atraso, 0), 0));
    else
      v_quando := ((new.data_cirurgia + m.dias_offset) + m.hora) at time zone 'America/Sao_Paulo';
      -- Não transforma um lançamento atrasado em disparo retroativo.
      continue when v_quando <= now();
    end if;

    v_texto := replace(m.texto, '{primeiro_nome}', v_primeiro);
    v_texto := replace(v_texto, '{paciente}',   coalesce(new.paciente_nome, ''));
    v_texto := replace(v_texto, '{data}',       to_char(new.data_cirurgia, 'DD/MM/YYYY'));
    v_texto := replace(v_texto, '{hora}',       left(coalesce(new.hora::text, ''), 5));
    v_texto := replace(v_texto, '{hospital}',   coalesce(new.hospital, ''));
    v_texto := replace(v_texto, '{cirurgiao}',  coalesce(new.cirurgiao, ''));
    v_texto := replace(v_texto, '{cirurgia}',   coalesce(new.procedimento_nome, ''));
    v_texto := replace(v_texto, '{sigla}',      coalesce(new.procedimento_sigla, ''));
    v_texto := replace(v_texto, '{whatsapp_cirurgiao}', v_whats);

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
