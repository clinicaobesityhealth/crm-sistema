-- v48.158 — Avisar o atendente por WhatsApp quando um paciente precisa dele.
--
-- Pode rodar de novo sem problema.
--
-- PEDIDO DO JORGE, em duas partes:
--
--   1) Quando um paciente é transferido para um atendente (exceto secretaria)
--      -- médico, cirurgião, nutri, psicóloga -- ou incluído na conversa com
--      ele, manda uma mensagem pro WhatsApp PESSOAL desse atendente avisando
--      que o paciente está aguardando, com link pro CRM. Sempre, esteja ele
--      online ou não -- é o aviso de "chegou um atendimento pra você".
--
--   2) Separado disso: se o paciente JÁ ESTÁ em atendimento com um desses
--      profissionais (conversa com assigned_to pra ele) e manda uma NOVA
--      mensagem enquanto esse atendente NÃO ESTÁ logado no CRM, avisa de
--      novo -- "fulano mandou mensagem e está esperando". Só dispara se ele
--      estiver realmente fora (sem heartbeat recente), pra não duplicar o que
--      o próprio CRM já mostra em tempo real pra quem está com a tela aberta.
--
-- MESMO DESENHO da v48.68 (lembretes da agenda pessoal): gatilhos no banco
-- gravam numa fila, uma função RPC entrega o que está pendente E marca como
-- entregue no mesmo passo (pra duas varreduras não mandarem duas vezes), e
-- quem varre de fora é o n8n. Reusa o `agents.telefone` que já existe (o
-- mesmo campo "Celular pessoal (WhatsApp)" da agenda pessoal) e o mesmo
-- webhook de envio (tool-enviar-mensagem-waha) -- não precisa de novo
-- cadastro nem de nova integração.
--
-- QUEM FICA DE FORA (as duas partes): o cargo (job_titles) decide, com o
-- mesmo tipo de campo booleano que já existe pra "vê agenda pessoal" -- aqui
-- "avisar_atendimento", ligado por padrão pra todo mundo, e já semeado como
-- DESLIGADO pra quem tem cargo de secretária/secretário/recepção hoje. Dá
-- pra mudar depois em Configurações → Cargos, sem precisar mexer em código.

-- ===========================================================================
-- 1) O cargo decide quem recebe o aviso
-- ===========================================================================
alter table public.job_titles
  add column if not exists avisar_atendimento boolean not null default true;

update public.job_titles
   set avisar_atendimento = false
 where avisar_atendimento = true
   and (lower(name) like '%secretari%' or lower(name) like '%recep%');

-- ===========================================================================
-- 2) A fila
-- ===========================================================================
create table if not exists public.avisos_atendente_fila (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  motivo text not null, -- 'transferencia' | 'participante' | 'mensagem_offline'
  created_at timestamptz not null default now(),
  enviado_em timestamptz
);

create index if not exists avisos_atendente_fila_pendentes_idx
  on public.avisos_atendente_fila (agent_id) where enviado_em is null;

create index if not exists avisos_atendente_fila_throttle_idx
  on public.avisos_atendente_fila (contact_id, agent_id, motivo, created_at);

alter table public.avisos_atendente_fila enable row level security;

-- Sem policy de leitura pra authenticated de propósito: só o RPC (security
-- definer) e o service role (n8n) mexem aqui. Ninguém no app lê esta tabela
-- direto.

-- ===========================================================================
-- 3) Parte 1 — transferência e inclusão na conversa
-- ===========================================================================
-- Dispara sempre (online ou não). Só não dispara se foi a própria pessoa que
-- se atribuiu/se incluiu (auth.uid() do autor é comparado) -- abrir uma
-- conversa e assumir pra si mesmo não precisa de aviso, a pessoa já sabe,
-- acabou de fazer isso.
create or replace function public.fn_fila_aviso_transferencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is distinct from old.assigned_to
     and new.assigned_to is not null
     and new.assigned_to is distinct from auth.uid() then
    insert into public.avisos_atendente_fila (contact_id, agent_id, motivo)
    values (new.id, new.assigned_to, 'transferencia');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aviso_transferencia on public.contacts;
create trigger trg_aviso_transferencia
  after update of assigned_to on public.contacts
  for each row execute function public.fn_fila_aviso_transferencia();

create or replace function public.fn_fila_aviso_participante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agent_id is distinct from auth.uid() then
    insert into public.avisos_atendente_fila (contact_id, agent_id, motivo)
    values (new.contact_id, new.agent_id, 'participante');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aviso_participante on public.conversation_participants;
create trigger trg_aviso_participante
  after insert on public.conversation_participants
  for each row execute function public.fn_fila_aviso_participante();

-- ===========================================================================
-- 4) Parte 2 — mensagem nova enquanto o atendente responsável está offline
-- ===========================================================================
-- "Logado no CRM agora" = heartbeat recente. O app marca is_online/last_seen_at
-- a cada 15s enquanto a aba está aberta (ver AuthContext.tsx), com presence do
-- Supabase Realtime detectando queda em segundos e marcando offline no
-- fechar/sair. 90s de folga cobre essa cadência sem reagir tarde demais.
--
-- Throttle de 20 minutos por (contact_id, agent_id): paciente mandando várias
-- mensagens seguidas não deve tocar o celular do atendente várias vezes --
-- um aviso já é suficiente até ele aparecer ou passar esse tempo.
create or replace function public.fn_fila_aviso_mensagem_offline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
begin
  if new.direction <> 'inbound' then
    return new;
  end if;

  select c.assigned_to into v_agent_id
    from public.contacts c
   where c.id = new.contact_id
     and c.conversation_status in ('active', 'pending')
     and c.assigned_to is not null;

  if v_agent_id is null then
    return new;
  end if;

  if exists (
    select 1 from public.agents a
     where a.id = v_agent_id
       and a.is_online = true
       and a.last_seen_at is not null
       and a.last_seen_at > now() - interval '90 seconds'
  ) then
    return new; -- está com o CRM aberto agora, o realtime já mostra lá
  end if;

  if exists (
    select 1 from public.avisos_atendente_fila f
     where f.contact_id = new.contact_id
       and f.agent_id = v_agent_id
       and f.motivo = 'mensagem_offline'
       and f.created_at > now() - interval '20 minutes'
  ) then
    return new; -- já avisou faz pouco, não repete
  end if;

  insert into public.avisos_atendente_fila (contact_id, agent_id, motivo)
  values (new.contact_id, v_agent_id, 'mensagem_offline');

  return new;
end;
$$;

drop trigger if exists trg_aviso_mensagem_offline on public.messages;
create trigger trg_aviso_mensagem_offline
  after insert on public.messages
  for each row execute function public.fn_fila_aviso_mensagem_offline();

-- ===========================================================================
-- 5) Quem manda o WhatsApp
-- ===========================================================================
-- Mesmo contrato da v48.68: devolve o que está pendente E marca como enviado
-- no mesmo passo. O cargo (job_titles.avisar_atendimento) e o telefone
-- cadastrado são checados aqui, não nos gatilhos -- assim, se alguém mudar o
-- cargo ou cadastrar o telefone depois, um aviso que ainda não saiu passa a
-- valer com a configuração atual, em vez de ficar travado na que existia no
-- momento do evento.
create or replace function public.avisos_atendente_para_enviar()
returns table (fila_id uuid, telefone text, texto text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with candidatos as (
    select f.id, f.motivo, f.contact_id, a.telefone,
           coalesce(c.full_name, 'Paciente') as paciente_nome
      from public.avisos_atendente_fila f
      join public.agents a on a.id = f.agent_id
      join public.contacts c on c.id = f.contact_id
      left join public.job_titles jt on jt.name = a.job_title
     where f.enviado_em is null
       and coalesce(btrim(a.telefone), '') <> ''
       and coalesce(jt.avisar_atendimento, true) = true
  ),
  marcados as (
    update public.avisos_atendente_fila
       set enviado_em = now()
      from candidatos
     where avisos_atendente_fila.id = candidatos.id
     returning avisos_atendente_fila.id
  )
  select c.id,
         regexp_replace(c.telefone, '[^0-9]', '', 'g'),
         case c.motivo
           when 'mensagem_offline' then
             '💬 O(a) Sr(a). *' || c.paciente_nome || '* enviou uma mensagem para a Clínica Obesity Health (CRM) e aguarda atendimento.'
           else
             '🔔 *' || c.paciente_nome || '* está aguardando atendimento no CRM.'
         end
           || chr(10) || chr(10)
           || 'Abrir: ' || coalesce(current_setting('app.crm_base_url', true), 'https://crm.obesityhealth.com.br')
           || '/inbox?contact=' || c.contact_id
    from candidatos c
    join marcados m on m.id = c.id;
end;
$$;

grant execute on function public.avisos_atendente_para_enviar() to service_role;
