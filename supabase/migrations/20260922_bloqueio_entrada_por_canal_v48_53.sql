-- v48.53 — Canal bloqueado também não RECEBE.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- O QUE ACONTECIA
--
-- O bloqueio por canal (v48.34/v48.40) já impedia a Sofia de responder e
-- impedia qualquer mensagem de SAIR pelo canal bloqueado. Mas a mensagem que
-- CHEGAVA pelo canal bloqueado continuava entrando no CRM e reabrindo o
-- atendimento. Caso real: a Talita, bloqueada só no Instagram, continuava
-- aparecendo no Atendimento com mensagens do Instagram.
--
-- O QUE MUDA
--
-- 1. Mensagem recebida por um canal bloqueado não entra na conversa. Ela fica
--    guardada à parte, em mensagens_bloqueadas, para consulta se um dia for
--    preciso (prova, histórico) — mas não aparece no Atendimento.
-- 2. Se essa mensagem tinha acabado de reabrir o atendimento (ninguém
--    atendendo), ele volta a ficar fechado. Atendimento que está com alguém
--    da equipe não é mexido.
-- 3. O WhatsApp de quem foi bloqueado só no Instagram (e vice-versa) continua
--    funcionando normalmente.

-- Correção da v48.40: com só a marca por canal (sem a lista), a função caía
-- no tratamento de erro e dizia "nenhum canal bloqueado". array_append resolve.
create or replace function public.crm_canais_bloqueados(campos jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  canais text[] := '{}';
  lista jsonb;
begin
  campos := coalesce(campos, '{}'::jsonb);

  lista := campos -> 'crm_blocked_canais';
  if jsonb_typeof(lista) = 'array' then
    select coalesce(array_agg(x), '{}') into canais
      from jsonb_array_elements_text(lista) as t(x)
     where x in ('whatsapp', 'instagram');
  end if;

  if coalesce((campos ->> 'crm_blocked_whatsapp')::boolean, false)
     and not ('whatsapp' = any(canais)) then
    canais := array_append(canais, 'whatsapp');
  end if;

  if coalesce((campos ->> 'crm_blocked_instagram')::boolean, false)
     and not ('instagram' = any(canais)) then
    canais := array_append(canais, 'instagram');
  end if;

  -- Bloqueio antigo, de antes da v48.34: valia para o contato inteiro.
  if array_length(canais, 1) is null
     and coalesce((campos ->> 'crm_blocked')::boolean, false) then
    canais := array['whatsapp', 'instagram'];
  end if;

  return canais;
exception
  when others then
    -- Um valor estranho num contato antigo nunca pode impedir que ele seja
    -- salvo. Na dúvida, devolve "nenhum canal bloqueado" e deixa as outras
    -- proteções agirem.
    return '{}';
end;
$$;

create table if not exists public.mensagens_bloqueadas (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid,
  channel text,
  content text,
  media_url text,
  media_type text,
  original jsonb,
  recebida_em timestamptz not null default now()
);

create index if not exists idx_mensagens_bloqueadas_contact on public.mensagens_bloqueadas(contact_id, recebida_em desc);

alter table public.mensagens_bloqueadas enable row level security;
drop policy if exists "mensagens_bloqueadas_leitura" on public.mensagens_bloqueadas;
create policy "mensagens_bloqueadas_leitura" on public.mensagens_bloqueadas
  for select to authenticated using (true);

create or replace function public.crm_desviar_entrada_de_canal_bloqueado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  canais text[];
  canal_msg text;
  c record;
  outra_recente boolean;
begin
  if new.direction is distinct from 'inbound' then
    return new;
  end if;

  select id, custom_fields, conversation_status, assigned_to, updated_at
    into c
    from public.contacts
   where id = new.contact_id;
  if not found then
    return new;
  end if;

  canais := public.crm_canais_bloqueados(c.custom_fields);
  if canais is null or array_length(canais, 1) is null then
    return new;
  end if;

  canal_msg := lower(coalesce(new.channel, 'whatsapp'));
  if not (canal_msg = any(canais)) then
    return new;
  end if;

  insert into public.mensagens_bloqueadas (contact_id, channel, content, media_url, media_type, original)
  values (new.contact_id, canal_msg, new.content, new.media_url, new.media_type, to_jsonb(new));

  -- Houve conversa de verdade (por canal liberado) nos últimos 10 minutos?
  select exists (
    select 1 from public.messages m
     where m.contact_id = new.contact_id
       and m.created_at > now() - interval '10 minutes'
  ) into outra_recente;

  -- Desfaz a reabertura que essa mensagem causou: só quando ninguém da equipe
  -- está atendendo e não há conversa recente pelo canal liberado.
  update public.contacts
     set custom_fields = coalesce(custom_fields, '{}'::jsonb)
                         || jsonb_build_object('crm_bloqueio_entrada_em', now()),
         conversation_status = case
           when assigned_to is null and not outra_recente then 'closed'
           else conversation_status end
   where id = new.contact_id;

  return null;  -- a mensagem não entra na conversa
exception
  when others then
    -- Na dúvida, a mensagem entra. Perder mensagem por erro aqui seria pior.
    return new;
end;
$$;

drop trigger if exists trg_crm_desviar_entrada_bloqueada on public.messages;
create trigger trg_crm_desviar_entrada_bloqueada
before insert on public.messages
for each row execute function public.crm_desviar_entrada_de_canal_bloqueado();

-- Se o fluxo reabrir o atendimento DEPOIS de a mensagem ter sido desviada
-- (a ordem varia), o contato é mantido fechado por 30 segundos — só quando
-- ninguém da equipe assumiu.
create or replace function public.crm_manter_fechado_apos_entrada_bloqueada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quando timestamptz;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if old.conversation_status is distinct from 'closed' then return new; end if;
  if new.conversation_status is not distinct from 'closed' then return new; end if;
  if new.assigned_to is not null then return new; end if;

  begin
    quando := (new.custom_fields ->> 'crm_bloqueio_entrada_em')::timestamptz;
  exception when others then
    return new;
  end;
  if quando is not null and quando > now() - interval '30 seconds' then
    new.conversation_status := 'closed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_manter_fechado_entrada_bloqueada on public.contacts;
create trigger trg_crm_manter_fechado_entrada_bloqueada
before update on public.contacts
for each row execute function public.crm_manter_fechado_apos_entrada_bloqueada();

notify pgrst, 'reload schema';

select 'ok' as bloqueio_de_entrada_por_canal;
