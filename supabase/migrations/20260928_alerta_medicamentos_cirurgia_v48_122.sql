-- v48.122 — Alerta de medicação na lista de cirurgias + tique de controle.
--
-- Rode depois da 20260924_base_clinica_medicamentos_v48_101.sql. Pode rodar de novo.
--
-- Pedido do Jorge: um alerta no cartão da cirurgia quando o paciente usa
-- remédio, que leva direto para a revisão do remédio — mostrando "revisado
-- pelo médico" quando já está tudo aprovado, ou pedindo para a secretária
-- buscar (PausaMed/base da clínica/IA) quando ainda falta. Depois de o
-- lembrete de suspensão ser enviado, um tique de controle aparece ao lado do
-- remédio na aba Medicações.
--
-- O QUE ENTRA
--
--   1. cirurgia_avisos.medicamento_id — liga o aviso de véspera (already
--      criado por avisar_suspensao_medicamentos, v48.97) à LINHA do remédio,
--      não só ao texto da chave. É o que permite a aba Medicações perguntar
--      "esse remédio específico já tem lembrete programado/enviado?" com uma
--      consulta direta, em vez de tentar recortar o id de dentro da chave.
--
--   2. avisar_suspensao_medicamentos() grava esse id ao criar o aviso.
--
--   3. sincronizar_mensagens_cirurgia() ganha mais uma linha: mudou a DATA da
--      cirurgia, descarta os lembretes de suspensão ainda pendentes (o texto
--      deles fala da data antiga — "amanhã é o dia de suspender..."). A
--      próxima varredura (avisar_suspensao_medicamentos, chamada toda vez que
--      alguém abre o CRM — ver AvisoCirurgiaNotification.tsx) cria um lembrete
--      novo, na data certa, sozinha — mesma ideia de "remarcar refaz as datas
--      sozinho" que MensagensDaCirurgia.tsx já promete para pré/pós-operatório.

-- ===========================================================================
-- 1) A liga entre o aviso e o remédio
-- ===========================================================================
alter table public.cirurgia_avisos
  add column if not exists medicamento_id uuid references public.cirurgia_medicamentos(id) on delete cascade;

create index if not exists cirurgia_avisos_medicamento_idx
  on public.cirurgia_avisos (medicamento_id) where medicamento_id is not null;

-- ===========================================================================
-- 2) A varredura de véspera passa a gravar o id do remédio
-- ===========================================================================
create or replace function public.avisar_suspensao_medicamentos()
returns integer
language plpgsql
security definer
set search_path = public
as $sus$
declare
  med record;
  v_data_suspensao date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_texto text;
  v_criados integer := 0;
begin
  for med in
    select cm.*, c.paciente_nome, c.contact_id, c.data_cirurgia, c.hospital, c.cirurgiao
      from public.cirurgia_medicamentos cm
      join public.cirurgias c on c.id = cm.cirurgia_id
     where cm.status = 'aprovado'
       and cm.prazo_suspensao_dias is not null
       and c.data_cirurgia is not null
       and c.contact_id is not null
       and coalesce(c.categoria, '') not in ('cancelada', 'realizada')
  loop
    v_data_suspensao := med.data_cirurgia - med.prazo_suspensao_dias;
    continue when v_data_suspensao <> (v_hoje + 1);

    v_texto := 'Prezado(a) Sr(a). ' || initcap(lower(split_part(trim(coalesce(med.paciente_nome, '')), ' ', 1))) || ',' || chr(10) || chr(10)
      || 'Amanhã (' || to_char(v_data_suspensao, 'DD/MM/YYYY') || ') é o dia de suspender o uso de *' || med.nome_informado || '*, por causa da sua cirurgia marcada para '
      || to_char(med.data_cirurgia, 'DD/MM/YYYY') || '.' || chr(10) || chr(10)
      || coalesce(nullif(btrim(med.explicacao_paciente), ''), 'Qualquer dúvida, fale com a equipe antes de suspender.')
      || chr(10) || chr(10) || 'Equipe do(a) ' || coalesce(med.cirurgiao, 'clínica');

    insert into public.cirurgia_avisos (cirurgia_id, contact_id, medicamento_id, tipo, titulo, texto, chave)
    values (
      med.cirurgia_id, med.contact_id, med.id, 'medicacao_suspender',
      'Suspender ' || med.nome_informado, v_texto,
      'medicacao_suspender:' || med.id::text || ':' || v_data_suspensao::text
    )
    on conflict (chave) do nothing;

    if found then v_criados := v_criados + 1; end if;
  end loop;

  return v_criados;
end
$sus$;

grant execute on function public.avisar_suspensao_medicamentos() to authenticated;

-- ===========================================================================
-- 3) Mudou a data da cirurgia: os lembretes de suspensão pendentes (que falam
--    da data antiga) caem. A varredura de véspera recria, sozinha, na data
--    certa, quando chegar a hora.
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
