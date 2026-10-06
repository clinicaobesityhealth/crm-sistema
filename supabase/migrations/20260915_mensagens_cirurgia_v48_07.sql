-- v48.07 — Mensagens automáticas de pré e pós-operatório.
--
-- Rode depois da v48.04. Pode rodar mais de uma vez.
--
-- Hoje isso mora num script da planilha: quando a situação vira AUTORIZADA, ele
-- escreve linhas numa aba de agendamento, e alguém copia e cola no WhatsApp.
-- Aqui a mensagem entra na MESMA fila que o CRM já usa para confirmação de
-- consulta (scheduled_messages) e sai sozinha, pelo mesmo caminho.
--
-- Duas escolhas que valem explicar:
--
--   O texto não fica no programa. Fica numa tabela que você edita na tela. Um
--   texto de mensagem muda com o tempo — e mudar texto não pode depender de
--   deploy.
--
--   Os modelos nascem DESLIGADOS. Escrevi um texto de partida, mas quem conhece
--   o tom da clínica é você. Nenhum paciente recebe nada até alguém ler,
--   ajustar e ligar.

-- ===========================================================================
-- 1) Modelos de mensagem
-- ===========================================================================
create table if not exists public.cirurgia_mensagens (
  id uuid primary key default gen_random_uuid(),

  -- 'pre' e 'pos' são os dois que a planilha tem hoje. A tabela aceita mais:
  -- basta cadastrar outro modelo com outro deslocamento de dias.
  tipo text not null,
  titulo text not null,

  -- Deslocamento em dias a partir da data da cirurgia: -1 é véspera, +1 é o
  -- dia seguinte. É exatamente o que o script faz hoje (data−1 e data+1).
  dias_offset integer not null,
  hora time not null default '09:00',

  texto text not null,
  ativo boolean not null default false,
  ordem integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cirurgia_mensagens enable row level security;
drop policy if exists "cirurgia_mensagens_rw" on public.cirurgia_mensagens;
create policy "cirurgia_mensagens_rw" on public.cirurgia_mensagens
  for all to authenticated using (true) with check (true);

-- Liga a mensagem agendada à cirurgia que a originou. Sem isso, remarcar uma
-- cirurgia deixaria a mensagem antiga viva, e o paciente receberia aviso de
-- uma data que não existe mais.
alter table public.scheduled_messages
  add column if not exists cirurgia_id uuid references public.cirurgias(id) on delete cascade;

create index if not exists scheduled_messages_cirurgia_idx
  on public.scheduled_messages (cirurgia_id);

-- ===========================================================================
-- 2) Texto de partida
-- ===========================================================================
-- Só entra se a tabela estiver vazia: rodar de novo não desfaz o que você editou.
insert into public.cirurgia_mensagens (tipo, titulo, dias_offset, hora, texto, ativo, ordem)
select * from (values
  ('pre', 'Pré-operatório (véspera)', -1, time '09:00',
$T$Prezado(a) Sr(a). {primeiro_nome},

Sua cirurgia está marcada para amanhã, {data}, às {hora}, no {hospital}.

Orientações importantes:
• Jejum absoluto de 8 horas antes do horário da cirurgia
• Leve documento com foto e carteirinha do convênio
• Chegue com 2 horas de antecedência para a internação
• Leve os exames pré-operatórios

Qualquer dúvida, fale com a equipe: {whatsapp_cirurgiao}

Equipe Obesity Health$T$, false, 1),

  ('pos', 'Pós-operatório (dia seguinte)', 1, time '10:00',
$T$Prezado(a) Sr(a). {primeiro_nome},

Passando para saber como o(a) senhor(a) está se sentindo após a cirurgia de ontem.

Lembre-se das orientações do pós-operatório:
• Siga rigorosamente a medicação prescrita
• Mantenha o repouso orientado
• Observe o curativo e avise se houver sangramento, febre ou dor intensa

Estamos à disposição: {whatsapp_cirurgiao}

Equipe Obesity Health$T$, false, 2)
) as novos(tipo, titulo, dias_offset, hora, texto, ativo, ordem)
where not exists (select 1 from public.cirurgia_mensagens);

-- ===========================================================================
-- 3) O gatilho
-- ===========================================================================
-- Dispara quando a cirurgia entra na situação marcada com o sino em
-- Configurações → Cad. Cirurgias → Situações (hoje, AUTORIZADA).
create or replace function public.sincronizar_mensagens_cirurgia()
returns trigger
language plpgsql
security definer
set search_path = public
as $sinc$
declare
  m record;
  v_dispara boolean := false;
  v_quando timestamptz;
  v_texto text;
  v_chave text;
  v_tel text;
  v_whats text;
  v_primeiro text;
begin
  -- Qualquer mudança que afete a mensagem invalida o que estava agendado.
  -- Remarcou a cirurgia, trocou o hospital, mudou de situação: o aviso antigo
  -- para de valer na hora, antes de qualquer coisa nova ser criada.
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
       and status in ('scheduled', 'pending');
  end if;

  -- Sem paciente vinculado ou sem data não há o que agendar. Não é erro: é uma
  -- cirurgia ainda incompleta, e ela pode ser completada depois.
  if new.contact_id is null or new.data_cirurgia is null then
    return new;
  end if;

  select coalesce(bool_or(dispara_mensagens), false) into v_dispara
    from public.cirurgia_status
   where nome = new.status and ativo;

  if not v_dispara then
    return new;
  end if;

  -- WhatsApp do cirurgião, quando cadastrado em Cad. Cirurgias → Equipe.
  select telefone into v_tel from public.cirurgia_equipe where id = new.cirurgiao_id;
  v_whats := case
    when coalesce(v_tel, '') = '' then 'o WhatsApp da clínica'
    else 'https://wa.me/' || regexp_replace(v_tel, '[^0-9]', '', 'g')
  end;

  v_primeiro := split_part(trim(coalesce(new.paciente_nome, '')), ' ', 1);

  for m in select * from public.cirurgia_mensagens where ativo order by ordem loop
    v_quando := ((new.data_cirurgia + m.dias_offset) + m.hora) at time zone 'America/Sao_Paulo';

    -- Não transforma um lançamento atrasado em disparo retroativo. Uma cirurgia
    -- autorizada na véspera não pode fazer a mensagem de ontem sair hoje.
    continue when v_quando <= now();

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
      -- Mensagem já enviada não volta atrás. Reagendar o passado seria pior do
      -- que não reagendar nada.
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

drop trigger if exists trg_mensagens_cirurgia on public.cirurgias;
create trigger trg_mensagens_cirurgia
  after insert or update on public.cirurgias
  for each row execute function public.sincronizar_mensagens_cirurgia();

-- Cirurgia cancelada ou negada: derruba o que estiver agendado. Sem isso, o
-- paciente receberia orientação de jejum para uma cirurgia que não vai acontecer.
create or replace function public.cancelar_mensagens_cirurgia()
returns trigger
language plpgsql
security definer
set search_path = public
as $canc$
begin
  if new.categoria = 'cancelada' then
    update public.scheduled_messages
       set status = 'cancelled', cancelled_at = now()
     where cirurgia_id = new.id
       and status in ('scheduled', 'pending');
  end if;
  return new;
end
$canc$;

drop trigger if exists trg_cancelar_mensagens_cirurgia on public.cirurgias;
create trigger trg_cancelar_mensagens_cirurgia
  after update of categoria on public.cirurgias
  for each row execute function public.cancelar_mensagens_cirurgia();
