-- v48.139 — Ajuste no texto do lembrete de suspensão de medicamento (a mesma
-- mensagem confirmada funcionando pelo Jorge com o paciente de teste): a
-- assinatura passa a ser "Equipe *Obesity Health*" (negrito), no lugar de
-- "Equipe do(a) {cirurgião}", e a mensagem passa a citar QUAL cirurgia é —
-- antes só dizia a data ("sua cirurgia marcada para 13/10/2026"), agora diz
-- "sua cirurgia de {procedimento} marcada para 13/10/2026" quando o
-- procedimento está cadastrado.
--
-- Rode depois da 20260930_lembrete_atrasado_nao_descarta_v48_136.sql.
-- Pode rodar mais de uma vez.

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
  v_primeiro_nome text;
  v_cirurgia_txt text;
begin
  select cm.*, c.paciente_nome, c.contact_id, c.data_cirurgia, c.cirurgiao, c.categoria, c.procedimento_nome
    into med
    from public.cirurgia_medicamentos cm
    join public.cirurgias c on c.id = cm.cirurgia_id
   where cm.id = p_medicamento_id;

  if not found then return; end if;

  v_chave := 'medicacao_suspender:' || med.id::text;

  -- condições que invalidam o lembrete de vez: não aprovado, sem prazo
  -- definido, sem cirurgia/data/paciente válido, ou cirurgia
  -- cancelada/realizada — descarta o que estiver pendente (nunca mexe no que
  -- já foi enviado). Data ideal já ter passado NÃO entra mais aqui (v48.136).
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
  v_primeiro_nome := initcap(lower(split_part(trim(coalesce(med.paciente_nome, '')), ' ', 1)));
  -- v48.139 — "sua cirurgia de BYPASS GÁSTRICO marcada para ..." quando dá
  -- para dizer qual é; sem procedimento cadastrado, cai de volta em "sua
  -- cirurgia marcada para ..." (como já era).
  v_cirurgia_txt := case when nullif(btrim(med.procedimento_nome), '') is not null
    then ' de ' || med.procedimento_nome else '' end;

  if v_data_suspensao > v_hoje then
    -- Ainda dá tempo: véspera às 9h, como sempre. Se já passou das 9h da
    -- véspera (aprovado em cima da hora), manda o quanto antes.
    v_quando := ((v_data_suspensao - 1) + time '09:00') at time zone 'America/Sao_Paulo';
    if v_quando <= now() then v_quando := now() + interval '2 minutes'; end if;
    v_texto := 'Prezado(a) Sr(a). ' || v_primeiro_nome || ',' || chr(10) || chr(10)
      || 'Amanhã (' || to_char(v_data_suspensao, 'DD/MM/YYYY') || ') é o dia de suspender o uso de *' || med.nome_informado || '*, por causa da sua cirurgia' || v_cirurgia_txt || ' marcada para '
      || to_char(med.data_cirurgia, 'DD/MM/YYYY') || '.' || chr(10) || chr(10)
      || coalesce(nullif(btrim(med.explicacao_paciente), ''), 'Qualquer dúvida, fale com a equipe antes de suspender.')
      || chr(10) || chr(10) || 'Equipe *Obesity Health*';
  elsif v_data_suspensao = v_hoje then
    -- Hoje é o dia: manda agora, texto ajustado (não faz sentido dizer "amanhã").
    v_quando := now() + interval '2 minutes';
    v_texto := 'Prezado(a) Sr(a). ' || v_primeiro_nome || ',' || chr(10) || chr(10)
      || 'Hoje (' || to_char(v_data_suspensao, 'DD/MM/YYYY') || ') é o dia de suspender o uso de *' || med.nome_informado || '*, por causa da sua cirurgia' || v_cirurgia_txt || ' marcada para '
      || to_char(med.data_cirurgia, 'DD/MM/YYYY') || '.' || chr(10) || chr(10)
      || coalesce(nullif(btrim(med.explicacao_paciente), ''), 'Qualquer dúvida, fale com a equipe antes de suspender.')
      || chr(10) || chr(10) || 'Equipe *Obesity Health*';
  else
    -- v48.136 — O prazo ideal já passou (cirurgia marcada perto demais para a
    -- janela deste remédio). Antes disto era descartado em silêncio; agora
    -- manda urgente, agora mesmo.
    v_quando := now() + interval '2 minutes';
    v_texto := 'Prezado(a) Sr(a). ' || v_primeiro_nome || ',' || chr(10) || chr(10)
      || '*URGENTE:* o prazo ideal para suspender o uso de *' || med.nome_informado || '* (' || to_char(v_data_suspensao, 'DD/MM/YYYY') || ') já passou, por causa da sua cirurgia' || v_cirurgia_txt || ' marcada para '
      || to_char(med.data_cirurgia, 'DD/MM/YYYY') || '. Por favor, entre em contato com a equipe agora mesmo antes de continuar tomando.' || chr(10) || chr(10)
      || coalesce(nullif(btrim(med.explicacao_paciente), ''), '')
      || chr(10) || chr(10) || 'Equipe *Obesity Health*';
  end if;

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

-- Backfill: reaplica a função para todo remédio aprovado, para os lembretes
-- que AINDA NÃO FORAM ENVIADOS ganharem o texto novo (assinatura + cirurgia).
-- O que já foi enviado nunca é tocado (ver "status in ('sent','failed')"
-- acima) — o Mounjaro de teste que o Jorge já recebeu continua como está.
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
