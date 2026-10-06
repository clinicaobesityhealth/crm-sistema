-- v48.136 — Lembrete de suspensão: quando o prazo ideal já passou, avisa
-- URGENTE agora em vez de ficar quieto.
--
-- Rode depois da 20260929_lembrete_medicamento_automatico_v48_132.sql. Pode
-- rodar mais de uma vez.
--
-- POR QUE
-- Achado no teste do Jorge (paciente João Jorge, METFORMINA + MOUNJARO): ao
-- gerar o PDF, os dois remédios ficaram "aprovado", mas só um ganhou
-- "lembrete programado". Causa: agendar_lembrete_medicamento (v48.132)
-- calculava a data ideal de suspensão (data da cirurgia − prazo do remédio)
-- e, se essa data já tivesse passado — cirurgia marcada perto demais para a
-- janela daquele remédio, ex.: Mounjaro pede mais dias de antecedência do que
-- sobrou até a cirurgia —, DESCARTAVA o lembrete em silêncio. Exatamente o
-- risco clínico que essa automação inteira existe para evitar (ver o
-- cabeçalho da migração v48.132): se o prazo ideal já passou, é ainda MAIS
-- urgente avisar a equipe/paciente agora, não menos.
--
-- O QUE MUDA
-- agendar_lembrete_medicamento(id) não descarta mais por causa da data:
--   • prazo ideal ainda no futuro → continua exatamente como era, aviso de
--     véspera às 9h.
--   • prazo ideal é HOJE → manda agora (~2 min), com o texto ajustado para
--     "hoje" em vez de "amanhã".
--   • prazo ideal já passou → manda agora (~2 min), com um texto de URGÊNCIA
--     avisando que o prazo passou e pedindo para falar com a equipe
--     imediatamente, em vez de silenciosamente não avisar ninguém.
-- Continua descartando (supersede) só pelos motivos que não são de data: não
-- aprovado, sem prazo definido, sem cirurgia/data/paciente válido, ou cirurgia
-- cancelada/realizada — esses sim não fazem sentido de avisar.

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
begin
  select cm.*, c.paciente_nome, c.contact_id, c.data_cirurgia, c.cirurgiao, c.categoria
    into med
    from public.cirurgia_medicamentos cm
    join public.cirurgias c on c.id = cm.cirurgia_id
   where cm.id = p_medicamento_id;

  if not found then return; end if;

  v_chave := 'medicacao_suspender:' || med.id::text;

  -- condições que invalidam o lembrete de vez: não aprovado, sem prazo
  -- definido, sem cirurgia/data/paciente válido, ou cirurgia
  -- cancelada/realizada — descarta o que estiver pendente (nunca mexe no que
  -- já foi enviado). Data ideal já ter passado NÃO entra mais aqui.
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

  if v_data_suspensao > v_hoje then
    -- Ainda dá tempo: véspera às 9h, como sempre. Se já passou das 9h da
    -- véspera (aprovado em cima da hora), manda o quanto antes.
    v_quando := ((v_data_suspensao - 1) + time '09:00') at time zone 'America/Sao_Paulo';
    if v_quando <= now() then v_quando := now() + interval '2 minutes'; end if;
    v_texto := 'Prezado(a) Sr(a). ' || v_primeiro_nome || ',' || chr(10) || chr(10)
      || 'Amanhã (' || to_char(v_data_suspensao, 'DD/MM/YYYY') || ') é o dia de suspender o uso de *' || med.nome_informado || '*, por causa da sua cirurgia marcada para '
      || to_char(med.data_cirurgia, 'DD/MM/YYYY') || '.' || chr(10) || chr(10)
      || coalesce(nullif(btrim(med.explicacao_paciente), ''), 'Qualquer dúvida, fale com a equipe antes de suspender.')
      || chr(10) || chr(10) || 'Equipe do(a) ' || coalesce(med.cirurgiao, 'clínica');
  elsif v_data_suspensao = v_hoje then
    -- Hoje é o dia: manda agora, texto ajustado (não faz sentido dizer "amanhã").
    v_quando := now() + interval '2 minutes';
    v_texto := 'Prezado(a) Sr(a). ' || v_primeiro_nome || ',' || chr(10) || chr(10)
      || 'Hoje (' || to_char(v_data_suspensao, 'DD/MM/YYYY') || ') é o dia de suspender o uso de *' || med.nome_informado || '*, por causa da sua cirurgia marcada para '
      || to_char(med.data_cirurgia, 'DD/MM/YYYY') || '.' || chr(10) || chr(10)
      || coalesce(nullif(btrim(med.explicacao_paciente), ''), 'Qualquer dúvida, fale com a equipe antes de suspender.')
      || chr(10) || chr(10) || 'Equipe do(a) ' || coalesce(med.cirurgiao, 'clínica');
  else
    -- v48.136 — O prazo ideal já passou (cirurgia marcada perto demais para a
    -- janela deste remédio). Antes disto era descartado em silêncio; agora
    -- manda urgente, agora mesmo.
    v_quando := now() + interval '2 minutes';
    v_texto := 'Prezado(a) Sr(a). ' || v_primeiro_nome || ',' || chr(10) || chr(10)
      || '*URGENTE:* o prazo ideal para suspender o uso de *' || med.nome_informado || '* (' || to_char(v_data_suspensao, 'DD/MM/YYYY') || ') já passou, por causa da sua cirurgia marcada para '
      || to_char(med.data_cirurgia, 'DD/MM/YYYY') || '. Por favor, entre em contato com a equipe agora mesmo antes de continuar tomando.' || chr(10) || chr(10)
      || coalesce(nullif(btrim(med.explicacao_paciente), ''), '')
      || chr(10) || chr(10) || 'Equipe do(a) ' || coalesce(med.cirurgiao, 'clínica');
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

-- Backfill: reaplica a função para todo remédio já aprovado, para os que
-- foram descartados por engano (a data já ter passado) ganharem o lembrete
-- urgente agora, em vez de esperar a próxima mudança de cirurgia/remédio.
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
