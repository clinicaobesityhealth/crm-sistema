-- v48.83 — O nome e o WhatsApp do cirurgião voltam a aparecer na mensagem.
--
-- Rode depois da 20260924_preop_avisado_v48_82.sql. Pode rodar de novo.
--
-- O QUE SAÍA ERRADO
--   Cirurgião: __
--   ...fale com a equipe: o WhatsApp da clínica
--
-- Duas causas, e as duas são de cadastro incompleto — mas o texto não podia
-- sair assim mesmo:
--
--   {cirurgiao} lia só a coluna de texto da cirurgia. Cirurgia trazida da
--   planilha, ou lançada escolhendo o médico pelo cadastro sem que o nome curto
--   fosse copiado, ficava com essa coluna vazia.
--
--   {whatsapp_cirurgiao} procurava o telefone SÓ pelo id do cirurgião. Sem id
--   preenchido, caía direto no texto genérico, mesmo com o telefone cadastrado.
--
-- Agora os dois procuram pelo id E pelo nome, e o nome sai do cadastro da
-- equipe quando a cirurgia não tiver o dele escrito.

create or replace function public.mensagem_cirurgia_texto(p_texto text, c public.cirurgias)
returns text
language plpgsql
stable
security definer
set search_path = public
as $txt$
declare
  v_medico public.cirurgia_equipe;
  v_nome text;
  v_tel text;
  v_whats text;
  v_retorno date;
begin
  -- Pelo id primeiro, que é o vínculo de verdade; pelo nome depois, que é o
  -- que sobra nas cirurgias antigas.
  if c.cirurgiao_id is not null then
    select * into v_medico from public.cirurgia_equipe where id = c.cirurgiao_id;
  end if;
  if v_medico.id is null and coalesce(btrim(c.cirurgiao), '') <> '' then
    select * into v_medico from public.cirurgia_equipe
     where upper(btrim(nome_curto)) = upper(btrim(c.cirurgiao))
        or upper(btrim(coalesce(nome_completo, ''))) = upper(btrim(c.cirurgiao))
     limit 1;
  end if;

  v_nome := coalesce(nullif(btrim(coalesce(c.cirurgiao, '')), ''), nullif(btrim(coalesce(v_medico.nome_curto, '')), ''), '');
  v_tel := v_medico.telefone;
  v_whats := case
    when coalesce(regexp_replace(coalesce(v_tel, ''), '[^0-9]', '', 'g'), '') = '' then 'o WhatsApp da clínica'
    else 'https://wa.me/' || regexp_replace(v_tel, '[^0-9]', '', 'g')
  end;

  select min(a.data) into v_retorno
    from public.agendamentos a
   where a.contact_id = c.contact_id
     and c.data_cirurgia is not null
     and a.data > c.data_cirurgia
     and lower(coalesce(a.status, '')) not like 'cancel%';

  p_texto := replace(p_texto, '{primeiro_nome}', initcap(lower(split_part(trim(coalesce(c.paciente_nome, '')), ' ', 1))));
  p_texto := replace(p_texto, '{paciente}',   initcap(lower(coalesce(c.paciente_nome, ''))));
  p_texto := replace(p_texto, '{data}',       coalesce(to_char(c.data_cirurgia, 'DD/MM/YYYY'), 'a definir'));
  p_texto := replace(p_texto, '{hora}',       left(coalesce(c.hora::text, ''), 5));
  p_texto := replace(p_texto, '{hospital}',   coalesce(c.hospital, ''));
  p_texto := replace(p_texto, '{cirurgiao}',  v_nome);
  p_texto := replace(p_texto, '{cirurgia}',   coalesce(c.procedimento_nome, ''));
  p_texto := replace(p_texto, '{sigla}',      coalesce(c.procedimento_sigla, ''));
  p_texto := replace(p_texto, '{whatsapp_cirurgiao}', v_whats);
  p_texto := replace(p_texto, '{data_retorno}', coalesce(to_char(v_retorno, 'DD/MM/YYYY'), 'a data combinada'));
  return p_texto;
end
$txt$;

-- Conferência: quem da equipe ativa ainda está sem telefone. Sem ele, o
-- {whatsapp_cirurgiao} continuará caindo no texto genérico.
select nome_curto, funcao,
       case when coalesce(btrim(telefone), '') = '' then 'SEM TELEFONE' else 'ok' end as telefone
  from public.cirurgia_equipe
 where ativo
 order by ordem;

-- ===========================================================================
-- Descartou? Na próxima vez que a situação voltar, pergunta de novo.
-- ===========================================================================
-- Antes, a chave do aviso era fixa por cirurgia e tipo. Quem clicasse em "não
-- enviar" fechava o assunto para sempre: a cirurgia podia sair e voltar para
-- SOLICITADO AO HOSPITAL que ninguém era mais perguntado. Agora só existe uma
-- pendência por vez — se já houver uma esperando, ela é atualizada; se a última
-- foi enviada ou descartada, a volta à situação abre uma nova.
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
