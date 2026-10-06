-- v48.67 — A notícia ao paciente passa pela secretária, e a mensagem de retorno.
--
-- Rode depois da 20260923_mensagens_por_situacao_v48_66.sql. Pode rodar de novo.
--
-- POR QUE MUDOU
--
-- "Foi solicitada ao hospital" e "o convênio autorizou" são NOTÍCIAS, e notícia
-- tem contexto: às vezes o paciente já soube pelo telefone, às vezes a situação
-- mudou por engano, às vezes o texto precisa de uma linha a mais. Mandar sozinho
-- economiza um clique e custa caro quando erra.
--
-- Então o modelo marcado como 'na_hora' não agenda mais nada: ele cria um AVISO
-- para a secretária, que lê, ajusta se quiser e decide enviar. O pré-operatório,
-- o pós-operatório e o retorno continuam saindo sozinhos — esses são rotina, não
-- notícia.

-- ===========================================================================
-- 1) A fila de avisos que esperam a secretária
-- ===========================================================================
create table if not exists public.cirurgia_avisos (
  id uuid primary key default gen_random_uuid(),
  cirurgia_id uuid references public.cirurgias(id) on delete cascade,
  contact_id uuid,
  tipo text not null,
  titulo text not null,
  texto text not null,

  -- pendente → a secretária ainda não decidiu
  -- enviado  → foi para o paciente
  -- descartado → ela decidiu não mandar
  status text not null default 'pendente',

  criado_em timestamptz not null default now(),
  decidido_em timestamptz,
  decidido_por uuid,

  -- Uma cirurgia que entra duas vezes na mesma situação não vira dois avisos.
  chave text unique
);

create index if not exists cirurgia_avisos_pendentes_idx
  on public.cirurgia_avisos (status, criado_em desc);

alter table public.cirurgia_avisos enable row level security;
drop policy if exists "cirurgia_avisos_rw" on public.cirurgia_avisos;
create policy "cirurgia_avisos_rw" on public.cirurgia_avisos
  for all to authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.cirurgia_avisos;
-- Já estar na publicação, ou nem existir publicação, não é motivo para a
-- migração falhar: só significa que o tempo real já está (ou não estará) ligado.
exception when others then null;
end $$;

-- ===========================================================================
-- 2) Texto alternativo (usado quando o paciente JÁ tem retorno marcado)
-- ===========================================================================
alter table public.cirurgia_mensagens
  add column if not exists texto_alternativo text;

-- ===========================================================================
-- 3) Modelo de retorno
-- ===========================================================================
insert into public.cirurgia_mensagens
  (tipo, titulo, dias_offset, hora, texto, texto_alternativo, ativo, ordem, disparo_status, quando, minutos_atraso)
select * from (values
  ('retorno', 'Retorno pós-operatório (7 dias)', 7, time '10:00',
$T$Prezado(a) Sr(a). {primeiro_nome},

Esperamos que esteja se recuperando bem da cirurgia.

O seu retorno com o Dr(a). {cirurgiao} deve acontecer entre o 10º e o 15º dia após a cirurgia. O(A) senhor(a) gostaria de agendar?

É só responder por aqui que a nossa equipe organiza o melhor horário.

Equipe Obesity Health$T$,
$T$Prezado(a) Sr(a). {primeiro_nome},

Esperamos que esteja se recuperando bem da cirurgia.

O seu retorno já está agendado para {data_retorno}. Estamos à disposição até lá — se aparecer qualquer dúvida ou desconforto, é só chamar por aqui.

Equipe Obesity Health$T$,
  false, 4, null, 'data_cirurgia', 0)
) as novos(tipo, titulo, dias_offset, hora, texto, texto_alternativo, ativo, ordem, disparo_status, quando, minutos_atraso)
where not exists (select 1 from public.cirurgia_mensagens c where c.tipo = novos.tipo);

-- ===========================================================================
-- 4) Substituição dos campos, num lugar só
-- ===========================================================================
-- Estava repetida dentro do gatilho. Agora o gatilho de cirurgias e o de
-- agendamentos usam a mesma função — texto que muda em dois lugares acaba
-- divergindo em um deles.
create or replace function public.mensagem_cirurgia_texto(p_texto text, c public.cirurgias)
returns text
language plpgsql
stable
security definer
set search_path = public
as $txt$
declare
  v_tel text;
  v_whats text;
  v_retorno date;
begin
  select telefone into v_tel from public.cirurgia_equipe where id = c.cirurgiao_id;
  v_whats := case
    when coalesce(v_tel, '') = '' then 'o WhatsApp da clínica'
    else 'https://wa.me/' || regexp_replace(v_tel, '[^0-9]', '', 'g')
  end;

  select min(a.data) into v_retorno
    from public.agendamentos a
   where a.contact_id = c.contact_id
     and c.data_cirurgia is not null
     and a.data > c.data_cirurgia
     and lower(coalesce(a.status, '')) not like 'cancel%';

  -- Os nomes chegam do MedX em caixa alta. "Prezado(a) Sr(a). MARIA," soa como
  -- grito; initcap devolve "Maria".
  p_texto := replace(p_texto, '{primeiro_nome}', initcap(lower(split_part(trim(coalesce(c.paciente_nome, '')), ' ', 1))));
  p_texto := replace(p_texto, '{paciente}',   initcap(lower(coalesce(c.paciente_nome, ''))));
  -- coalesce em tudo: um replace com NULL apaga o texto inteiro, e no
  -- pré-operatório a cirurgia costuma ainda não ter data.
  p_texto := replace(p_texto, '{data}',       coalesce(to_char(c.data_cirurgia, 'DD/MM/YYYY'), 'a definir'));
  p_texto := replace(p_texto, '{hora}',       left(coalesce(c.hora::text, ''), 5));
  p_texto := replace(p_texto, '{hospital}',   coalesce(c.hospital, ''));
  p_texto := replace(p_texto, '{cirurgiao}',  coalesce(c.cirurgiao, ''));
  p_texto := replace(p_texto, '{cirurgia}',   coalesce(c.procedimento_nome, ''));
  p_texto := replace(p_texto, '{sigla}',      coalesce(c.procedimento_sigla, ''));
  p_texto := replace(p_texto, '{whatsapp_cirurgiao}', v_whats);
  p_texto := replace(p_texto, '{data_retorno}', coalesce(to_char(v_retorno, 'DD/MM/YYYY'), 'a data combinada'));
  return p_texto;
end
$txt$;

-- Qual dos dois textos usar: o paciente já tem consulta marcada depois da
-- cirurgia? Então não faz sentido perguntar se ele quer agendar.
create or replace function public.mensagem_cirurgia_escolhe(m public.cirurgia_mensagens, c public.cirurgias)
returns text
language sql
stable
security definer
set search_path = public
as $esc$
  select case
    when coalesce(btrim(m.texto_alternativo), '') <> ''
     and exists (
       select 1 from public.agendamentos a
        where a.contact_id = c.contact_id
          and a.data > c.data_cirurgia
          and lower(coalesce(a.status, '')) not like 'cancel%')
    then m.texto_alternativo
    else m.texto
  end;
$esc$;

-- ===========================================================================
-- 5) O gatilho das cirurgias
-- ===========================================================================
create or replace function public.sincronizar_mensagens_cirurgia()
returns trigger
language plpgsql
security definer
set search_path = public
as $sinc$
declare
  -- Tipado (e não 'record') de propósito: as funções de texto recebem a linha
  -- inteira, e um record anônimo não se converte no tipo da tabela.
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
    if m.quando = 'na_hora' then
      insert into public.cirurgia_avisos (cirurgia_id, contact_id, tipo, titulo, texto, chave)
      values (new.id, new.contact_id, m.tipo, m.titulo, v_texto, v_chave)
      on conflict (chave) do update
        set texto = excluded.texto, titulo = excluded.titulo
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

-- ===========================================================================
-- 6) Marcou (ou desmarcou) consulta depois da cirurgia: o retorno se ajusta
-- ===========================================================================
-- A mensagem de retorno é escrita semanas antes de sair. Se nesse meio-tempo o
-- paciente marcar o retorno, perguntar "gostaria de agendar?" fica ruim — e se
-- desmarcar, deixar de perguntar é pior ainda. Então o texto é reescrito quando
-- a agenda do paciente muda.
create or replace function public.reescrever_retorno_cirurgia()
returns trigger
language plpgsql
security definer
set search_path = public
as $ret$
declare
  v_contato uuid;
  c public.cirurgias;
  m public.cirurgia_mensagens;
begin
  v_contato := coalesce(new.contact_id, old.contact_id);
  if v_contato is null then return coalesce(new, old); end if;

  select * into m from public.cirurgia_mensagens where tipo = 'retorno' limit 1;
  if not found then return coalesce(new, old); end if;

  for c in
    select cir.* from public.cirurgias cir
     where cir.contact_id = v_contato
       and cir.data_cirurgia is not null
       and exists (
         select 1 from public.scheduled_messages s
          where s.cirurgia_id = cir.id
            and s.reminder_type = 'cirurgia_retorno'
            and s.status in ('scheduled', 'pending'))
  loop
    update public.scheduled_messages
       set content = public.mensagem_cirurgia_texto(public.mensagem_cirurgia_escolhe(m, c), c)
     where cirurgia_id = c.id
       and reminder_type = 'cirurgia_retorno'
       and status in ('scheduled', 'pending');
  end loop;

  return coalesce(new, old);
end
$ret$;

drop trigger if exists trg_reescrever_retorno on public.agendamentos;
create trigger trg_reescrever_retorno
  after insert or update or delete on public.agendamentos
  for each row execute function public.reescrever_retorno_cirurgia();

-- ===========================================================================
-- 7) Paciente parado no pré-operatório
-- ===========================================================================
-- Hoje a planilha só acende um alerta para a secretária ("Verificar Preop >30
-- dias") e a conversa morre ali. O paciente parado não é um esquecimento do
-- sistema: é alguém que adiou, e que costuma voltar quando alguém explica por
-- que a cirurgia importa NO CASO DELE.
--
-- Vira mais um modelo de mensagem, com um terceiro tipo de disparo:
--   quando = 'parado' → dias_offset = quantos dias na mesma situação
-- E, como é notícia/abordagem, também passa pela secretária antes de sair.

insert into public.cirurgia_mensagens
  (tipo, titulo, dias_offset, hora, texto, ativo, ordem, disparo_status, quando, minutos_atraso)
select * from (values
  ('preop_parado', 'Pré-operatório parado (30 dias)', 30, time '09:00',
$T$Olá, Sr(a). {primeiro_nome}, tudo bem?

Aqui é a equipe da Obesity Health, do consultório do(a) {cirurgiao}.

Vimos que a sua cirurgia ({cirurgia}) está no pré-operatório há algum tempo e gostaríamos de ajudar o(a) senhor(a) a seguir em frente.

No seu caso, o tratamento cirúrgico é o que resolve o problema de forma definitiva. Quanto antes ele acontece, mais simples costuma ser a recuperação — adiar geralmente significa conviver com os sintomas por mais tempo e, em parte dos casos, um procedimento mais trabalhoso lá na frente.

Podemos retomar? A nossa equipe organiza os exames e a documentação do convênio para o(a) senhor(a), é só responder por aqui.

Equipe Obesity Health$T$, false, 5, 'PRÉ-OPERATÓRIO', 'parado', 0)
) as novos(tipo, titulo, dias_offset, hora, texto, ativo, ordem, disparo_status, quando, minutos_atraso)
where not exists (select 1 from public.cirurgia_mensagens c where c.tipo = novos.tipo);

-- Quem varre: o próprio CRM, quando alguém abre a tela.
--
-- Não há cron aqui, e pendurar isso num agendador externo custaria uma chave
-- secreta a mais circulando. Como a clínica abre o CRM todo dia, a varredura
-- acontece de qualquer jeito — e a chave do aviso é mensal, então o paciente
-- parado é lembrado uma vez por mês, não uma vez por login.
create or replace function public.avisar_cirurgias_paradas()
returns integer
language plpgsql
security definer
set search_path = public
as $par$
declare
  m public.cirurgia_mensagens;
  c public.cirurgias;
  v_desde timestamptz;
  v_criados integer := 0;
begin
  for m in select * from public.cirurgia_mensagens where ativo and quando = 'parado' loop
    continue when coalesce(btrim(m.disparo_status), '') = '';

    for c in
      select cir.* from public.cirurgias cir
       where cir.contact_id is not null
         and upper(btrim(coalesce(cir.status, ''))) = upper(btrim(m.disparo_status))
         and coalesce(cir.categoria, '') not in ('cancelada', 'realizada')
    loop
      -- Desde quando está nesta situação: a última vez que o histórico registrou
      -- a entrada nela; se não houver histórico, desde que a cirurgia foi criada.
      select coalesce(
               (select max(h.created_at) from public.cirurgia_historico h
                 where h.cirurgia_id = c.id and h.status_novo = c.status),
               c.created_at)
        into v_desde;

      continue when v_desde > now() - make_interval(days => greatest(coalesce(m.dias_offset, 30), 1));

      insert into public.cirurgia_avisos (cirurgia_id, contact_id, tipo, titulo, texto, chave)
      values (
        c.id, c.contact_id, m.tipo, m.titulo,
        public.mensagem_cirurgia_texto(m.texto, c),
        'cirurgia_' || m.tipo || ':' || c.id::text || ':' || to_char(now(), 'YYYY-MM')
      )
      on conflict (chave) do nothing;

      if found then v_criados := v_criados + 1; end if;
    end loop;
  end loop;

  return v_criados;
end
$par$;

grant execute on function public.avisar_cirurgias_paradas() to authenticated;
