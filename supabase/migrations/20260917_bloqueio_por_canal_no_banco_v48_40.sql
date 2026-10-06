-- v48.40 — O bloqueio por canal precisa existir DENTRO do banco.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- O QUE ACONTECEU
--
-- Na v48.34 o bloqueio passou a ser por canal: dá para bloquear o Instagram de
-- um paciente e manter o WhatsApp. O CRM passou a guardar isso em
--   custom_fields.crm_blocked_canais = ['instagram']
-- e a marca antiga, crm_blocked, só fica verdadeira quando TODOS os canais do
-- contato estão bloqueados.
--
-- Só que quem decide se a Sofia responde é o fluxo do n8n, e ele lê exatamente
-- duas coisas: crm_blocked e sofia_never_respond. Nenhuma das duas muda num
-- bloqueio de um canal só. Resultado: a Talita foi bloqueada no Instagram,
-- mandou mensagem pelo Instagram, e a Sofia estava livre para responder — o
-- oposto do que foi pedido.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--
-- 1. Guarda o bloqueio também como duas marcas simples:
--       custom_fields.crm_blocked_whatsapp  = true/false
--       custom_fields.crm_blocked_instagram = true/false
--    Lista dentro de JSON é difícil de ler em fluxo de automação; booleano não
--    tem erro. As duas formas passam a existir juntas, e o banco mantém elas
--    combinando — não importa por qual tela o bloqueio foi feito.
--
-- 2. Impede a saída de mensagem PELO CANAL BLOQUEADO. Antes isso só valia para
--    o bloqueio inteiro. É a última linha de defesa: mesmo que uma automação
--    erre, a mensagem não sai.
--
-- 3. Conserta o que já está gravado, para os contatos bloqueados antes de hoje.

-- ─────────────────────────────────────────────────────────────────────────────
-- Quais canais estão bloqueados para este contato, olhando as três formas de
-- gravação que já existiram. Uma função só, para não haver duas verdades.
-- ─────────────────────────────────────────────────────────────────────────────
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
    canais := canais || 'whatsapp';
  end if;

  if coalesce((campos ->> 'crm_blocked_instagram')::boolean, false)
     and not ('instagram' = any(canais)) then
    canais := canais || 'instagram';
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

comment on function public.crm_canais_bloqueados(jsonb) is
  'Canais bloqueados de um contato, lendo crm_blocked_canais, as marcas por canal e o crm_blocked antigo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Ao salvar um contato: mantém as marcas por canal combinando com a lista, e
-- continua fechando o atendimento de quem está bloqueado por completo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.crm_keep_blocked_contact_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  canais text[];
begin
  canais := public.crm_canais_bloqueados(new.custom_fields);

  new.custom_fields := coalesce(new.custom_fields, '{}'::jsonb) || jsonb_build_object(
    'crm_blocked_whatsapp',  ('whatsapp'  = any(canais)),
    'crm_blocked_instagram', ('instagram' = any(canais))
  );

  -- Só o bloqueio inteiro cala a assistente e fecha o atendimento. Num
  -- bloqueio de um canal só, o atendimento pelo outro canal continua
  -- normalmente — é exatamente para isso que o bloqueio por canal existe.
  if coalesce((new.custom_fields ->> 'crm_blocked')::boolean, false) then
    new.conversation_status := 'closed';
    new.assigned_to := null;
    new.sofia_paused := true;
    new.custom_fields := new.custom_fields || jsonb_build_object('sofia_never_respond', true);
  end if;

  return new;
exception
  when invalid_text_representation then
    -- Um valor antigo não booleano nunca deve impedir a atualização do contato.
    return new;
end;
$$;

drop trigger if exists trg_crm_keep_blocked_contact_closed on public.contacts;
create trigger trg_crm_keep_blocked_contact_closed
before insert or update on public.contacts
for each row execute function public.crm_keep_blocked_contact_closed();

comment on function public.crm_keep_blocked_contact_closed() is
  'Mantém as marcas de bloqueio por canal e impede que integrações reabram atendimento de contato bloqueado por completo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Nenhuma mensagem sai pelo canal bloqueado. Nem a da equipe, nem a da Sofia.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.crm_prevent_outbound_to_blocked_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  canais text[];
  canal_msg text;
begin
  if new.direction = 'outbound' and new.status = 'queued' then
    select public.crm_canais_bloqueados(custom_fields)
      into canais
      from public.contacts
     where id = new.contact_id;

    if canais is null or array_length(canais, 1) is null then
      return new;
    end if;

    -- Sem canal na mensagem, o caminho de sempre é o WhatsApp.
    canal_msg := lower(coalesce(new.channel, 'whatsapp'));
    if canal_msg = any(canais) then
      raise exception 'Contato bloqueado no canal %: envio externo impedido pelo CRM', canal_msg;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_prevent_outbound_to_blocked_contact on public.messages;
create trigger trg_crm_prevent_outbound_to_blocked_contact
before insert on public.messages
for each row execute function public.crm_prevent_outbound_to_blocked_contact();

comment on function public.crm_prevent_outbound_to_blocked_contact() is
  'Impede mensagens externas enfileiradas, inclusive automações, no canal em que o contato está bloqueado.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Conserta o que já está gravado. Um update que não muda nada faz o gatilho
-- acima rodar e gravar as marcas por canal em todo mundo que já foi bloqueado.
-- ─────────────────────────────────────────────────────────────────────────────
update public.contacts
   set updated_at = updated_at
 where custom_fields ? 'crm_blocked_canais'
    or coalesce((custom_fields ->> 'crm_blocked')::boolean, false);

notify pgrst, 'reload schema';

-- Confira aqui quem está bloqueado e em qual canal.
select full_name,
       public.crm_canais_bloqueados(custom_fields) as canais_bloqueados,
       coalesce((custom_fields ->> 'sofia_never_respond')::boolean, false) as sofia_calada
  from public.contacts
 where array_length(public.crm_canais_bloqueados(custom_fields), 1) is not null
 order by full_name;
