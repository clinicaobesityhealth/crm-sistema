-- v48.177 — Dois ajustes no aviso de WhatsApp pessoal pro atendente (v48.158),
-- pedido do Jorge.
--
--   1) O aviso de "paciente aguardando" (transferência pra ela, ou mensagem
--      nova enquanto ela está offline com um atendimento já assumido) estava
--      DESLIGADO por padrão pra secretária/recepção desde a v48.158 — Jorge
--      perguntou se valia pra todo mundo, confirmou que quer incluir a
--      secretária. Liga agora. Dá pra religar/desligar por cargo em
--      Configurações → Cargos (o campo já existia no banco, só não tinha
--      botão na tela — acrescentado aqui também).
--
--   2) Aviso novo: quando um paciente cai no INBOX (mensagem nova, ainda sem
--      atendente) e NENHUMA secretária está com o CRM aberto, avisa no
--      WhatsApp pessoal dela(s) — "chegou paciente, a Sofia está atendendo"
--      se a Sofia está ativa nessa conversa, ou a MESMA mensagem que o
--      médico recebe quando um atendimento assumido fica sem resposta
--      ("aguarda atendimento") se a Sofia está pausada nessa conversa
--      (pedido exato do Jorge: "se estiver pausada a sofia, msg igual dos
--      médicos"). Mesmo desenho da v48.158: fila (avisos_atendente_fila) +
--      RPC + n8n (que já varre essa fila, nenhuma mudança lá é necessária).
--      Throttle de 20 min por paciente, pra não repetir a cada mensagem nova
--      do mesmo paciente esperando.
--
--      Quem recebe o aviso de Inbox é um campo de cargo separado,
--      "avisar_inbox" — não é o mesmo "avisar_atendimento" porque um médico
--      não deveria ser avisado de paciente no Inbox (não é o trabalho dele),
--      mas a secretária sim. Já nasce ligado pra secretária/secretário/
--      recepção, e também ajustável em Configurações → Cargos.

-- ===========================================================================
-- 1) Liga o aviso de atendimento pra secretária/recepção
-- ===========================================================================
update public.job_titles
   set avisar_atendimento = true
 where avisar_atendimento = false
   and (lower(name) like '%secretari%' or lower(name) like '%recep%');

-- ===========================================================================
-- 2) Novo campo de cargo: quem é avisado de paciente no Inbox
-- ===========================================================================
alter table public.job_titles
  add column if not exists avisar_inbox boolean not null default false;

update public.job_titles
   set avisar_inbox = true
 where lower(name) like '%secretari%' or lower(name) like '%recep%';

-- ===========================================================================
-- 3) Gatilho: mensagem nova de paciente ainda sem atendente (Inbox)
-- ===========================================================================
-- "No Inbox" = mesma definição já usada pro badge global (AuthContext.tsx):
-- sem assigned_to e status ativo/nulo (não fechado/inativo/pendente).
create or replace function public.fn_fila_aviso_inbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contato record;
  v_motivo text;
  v_secretaria record;
  v_alguma_online boolean;
begin
  if new.direction <> 'inbound' then
    return new;
  end if;

  select c.id, c.full_name, c.sofia_paused
    into v_contato
    from public.contacts c
   where c.id = new.contact_id
     and c.assigned_to is null
     and (c.conversation_status is null or c.conversation_status = 'active');

  if v_contato.id is null then
    return new; -- já tem atendente, ou está fechado/inativo/pendente
  end if;

  -- Já avisou faz pouco pra este paciente? O paciente pode mandar várias
  -- mensagens seguidas esperando — um aviso só já basta até alguém assumir a
  -- conversa ou passar esse tempo (mesmo throttle da v48.158).
  if exists (
    select 1 from public.avisos_atendente_fila f
     where f.contact_id = v_contato.id
       and f.motivo in ('inbox_sofia_atendendo', 'inbox_precisa_atendente')
       and f.created_at > now() - interval '20 minutes'
  ) then
    return new;
  end if;

  -- Alguma secretária (cargo com avisar_inbox) está com o CRM aberto agora?
  -- Se sim, ela já vê o Inbox em tempo real, não precisa de WhatsApp.
  select exists (
    select 1 from public.agents a
      join public.job_titles jt on jt.name = a.job_title
     where coalesce(jt.avisar_inbox, false) = true
       and a.is_online = true
       and a.last_seen_at is not null
       and a.last_seen_at > now() - interval '90 seconds'
  ) into v_alguma_online;

  if v_alguma_online then
    return new;
  end if;

  v_motivo := case when coalesce(v_contato.sofia_paused, false)
                then 'inbox_precisa_atendente' else 'inbox_sofia_atendendo' end;

  for v_secretaria in
    select a.id
      from public.agents a
      join public.job_titles jt on jt.name = a.job_title
     where coalesce(jt.avisar_inbox, false) = true
  loop
    insert into public.avisos_atendente_fila (contact_id, agent_id, motivo)
    values (v_contato.id, v_secretaria.id, v_motivo);
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_aviso_inbox on public.messages;
create trigger trg_aviso_inbox
  after insert on public.messages
  for each row execute function public.fn_fila_aviso_inbox();

-- ===========================================================================
-- 4) Texto da mensagem — inclui os dois motivos novos
-- ===========================================================================
-- Mesmo contrato de sempre (devolve o pendente E marca como enviado no mesmo
-- passo). O gate por cargo passa a depender do tipo de aviso: os motivos de
-- Inbox olham avisar_inbox, os demais (já existentes) continuam olhando
-- avisar_atendimento — assim, se o cargo mudar depois, um aviso que ainda
-- não saiu passa a valer com a configuração atual.
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
       and (
         (f.motivo in ('inbox_sofia_atendendo', 'inbox_precisa_atendente')
            and coalesce(jt.avisar_inbox, false) = true)
         or
         (f.motivo not in ('inbox_sofia_atendendo', 'inbox_precisa_atendente')
            and coalesce(jt.avisar_atendimento, true) = true)
       )
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
           when 'inbox_precisa_atendente' then
             '💬 O(a) Sr(a). *' || c.paciente_nome || '* enviou uma mensagem para a Clínica Obesity Health (CRM) e aguarda atendimento.'
           when 'inbox_sofia_atendendo' then
             '👋 *' || c.paciente_nome || '* chegou no Inbox do CRM. A Sofia está atendendo.'
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

notify pgrst, 'reload schema';
