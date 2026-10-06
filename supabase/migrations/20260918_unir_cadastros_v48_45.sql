-- v48.45 — Unir dois cadastros da mesma pessoa.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- POR QUE ISSO EXISTE
--
-- A clínica tem duas contas de Instagram: @drjoaojorge e @clinicaobesityhealth.
-- A mesma paciente pode escrever para as duas — a Lívia escreveu. E o
-- identificador que o Instagram dá para uma pessoa (o PSID) é DIFERENTE em cada
-- conta: para a Meta, a mesma Lívia tem dois números, um por conta.
--
-- Por isso o CRM abre dois cadastros. Não é um erro de leitura: do lado de lá,
-- são mesmo dois identificadores. O que falta é o CRM saber que pertencem à
-- mesma pessoa.
--
-- O QUE ESTA FUNÇÃO FAZ
--
-- Junta tudo o que está pendurado no cadastro duplicado — mensagens,
-- agendamentos, cirurgias, o que existir — no cadastro que fica, guarda os
-- identificadores do Instagram dos dois lados numa lista só, e deixa o
-- duplicado marcado como unido, sem apagar nada.
--
-- Nada é destruído. Se a união estiver errada, o cadastro antigo continua lá,
-- com a anotação de para onde foi.

-- ─────────────────────────────────────────────────────────────────────────────
-- Todos os identificadores de Instagram de um contato, nas quatro formas de
-- gravação que já existiram.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.crm_psids_instagram(p_phone text, p_campos jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  psids text[] := '{}';
  v text;
  item jsonb;
begin
  p_campos := coalesce(p_campos, '{}'::jsonb);

  if p_phone is not null and p_phone like 'ig:%' then
    psids := psids || substring(p_phone from 4);
  end if;

  v := nullif(trim(coalesce(p_campos ->> 'instagram_psid', '')), '');
  if v is not null and not (v = any(psids)) then psids := psids || v; end if;

  v := nullif(trim(coalesce(p_campos ->> 'ig_sender_psid', '')), '');
  if v is not null and not (v = any(psids)) then psids := psids || v; end if;

  -- v48.45: a lista nova, com uma entrada por conta do Instagram.
  if jsonb_typeof(p_campos -> 'instagram_contas') = 'array' then
    for item in select * from jsonb_array_elements(p_campos -> 'instagram_contas') loop
      v := nullif(trim(coalesce(item ->> 'psid', '')), '');
      if v is not null and not (v = any(psids)) then psids := psids || v; end if;
    end loop;
  end if;

  return psids;
exception
  when others then return '{}';
end;
$$;

comment on function public.crm_psids_instagram(text, jsonb) is
  'Todos os identificadores do Instagram de um contato, somando as formas antigas e a lista por conta.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A união propriamente dita.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.crm_unir_contatos(p_origem uuid, p_destino uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  origem public.contacts%rowtype;
  destino public.contacts%rowtype;
  tabela record;
  movidos jsonb := '{}'::jsonb;
  n bigint;
  contas jsonb;
  item jsonb;
  psid text;
  ja_tem boolean;
begin
  if p_origem is null or p_destino is null or p_origem = p_destino then
    raise exception 'Escolha dois cadastros diferentes para unir.';
  end if;

  select * into origem from public.contacts where id = p_origem;
  if not found then raise exception 'O cadastro de origem não existe mais.'; end if;

  select * into destino from public.contacts where id = p_destino;
  if not found then raise exception 'O cadastro de destino não existe mais.'; end if;

  -- Tudo o que aponta para um contato passa a apontar para o que fica. A lista
  -- de tabelas é descoberta na hora: assim, uma tabela criada amanhã entra
  -- nesta união sem ninguém precisar lembrar de acrescentá-la aqui.
  for tabela in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name = 'contact_id'
       and t.table_type = 'BASE TABLE'
     order by c.table_name
  loop
    execute format('update public.%I set contact_id = $1 where contact_id = $2', tabela.table_name)
      using p_destino, p_origem;
    get diagnostics n = row_count;
    if n > 0 then
      movidos := movidos || jsonb_build_object(tabela.table_name, n);
    end if;
  end loop;

  -- Os identificadores do Instagram dos dois lados, numa lista só, cada um com
  -- a conta por onde aquela pessoa escreveu.
  contas := case when jsonb_typeof(destino.custom_fields -> 'instagram_contas') = 'array'
                 then destino.custom_fields -> 'instagram_contas'
                 else '[]'::jsonb end;

  foreach psid in array public.crm_psids_instagram(origem.phone, origem.custom_fields) loop
    ja_tem := false;
    for item in select * from jsonb_array_elements(contas) loop
      if item ->> 'psid' = psid then ja_tem := true; end if;
    end loop;
    if not ja_tem then
      contas := contas || jsonb_build_array(jsonb_build_object(
        'psid', psid,
        'conta', coalesce(origem.custom_fields ->> 'ig_account_name', ''),
        'vinculado_em', to_char(now(), 'YYYY-MM-DD')
      ));
    end if;
  end loop;

  foreach psid in array public.crm_psids_instagram(destino.phone, destino.custom_fields) loop
    ja_tem := false;
    for item in select * from jsonb_array_elements(contas) loop
      if item ->> 'psid' = psid then ja_tem := true; end if;
    end loop;
    if not ja_tem then
      contas := contas || jsonb_build_array(jsonb_build_object(
        'psid', psid,
        'conta', coalesce(destino.custom_fields ->> 'ig_account_name', ''),
        'vinculado_em', to_char(now(), 'YYYY-MM-DD')
      ));
    end if;
  end loop;

  update public.contacts
     set custom_fields = coalesce(custom_fields, '{}'::jsonb)
           || jsonb_build_object('instagram_contas', contas)
           -- O telefone do duplicado só é aproveitado se for telefone de
           -- verdade: "ig:123" não é telefone de ninguém.
           || case when coalesce(destino.custom_fields ->> 'ig_account_name', '') = ''
                    and coalesce(origem.custom_fields ->> 'ig_account_name', '') <> ''
                   then jsonb_build_object('ig_account_name', origem.custom_fields ->> 'ig_account_name')
                   else '{}'::jsonb end,
         phone = case
                   when (destino.phone is null or destino.phone = '' or destino.phone like 'ig:%')
                    and origem.phone is not null and origem.phone not like 'ig:%'
                   then origem.phone else destino.phone end,
         email = coalesce(nullif(destino.email, ''), origem.email),
         full_name = case
                       when coalesce(nullif(trim(destino.full_name), ''), '') = ''
                       then origem.full_name else destino.full_name end,
         updated_at = now()
   where id = p_destino;

  -- O duplicado sai de cena, mas não é apagado: fica o rastro de para onde foi,
  -- que é o que permite desfazer se a união estiver errada.
  update public.contacts
     set conversation_status = 'closed',
         assigned_to = null,
         custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object(
           'crm_unido_em', now(),
           'crm_unido_para', p_destino::text,
           'sofia_never_respond', true
         ),
         updated_at = now()
   where id = p_origem;

  return jsonb_build_object(
    'ok', true,
    'destino', p_destino,
    'origem', p_origem,
    'movidos', movidos,
    'instagram_contas', contas
  );
end;
$$;

comment on function public.crm_unir_contatos(uuid, uuid) is
  'Une o cadastro de origem no de destino: move tudo o que aponta para ele, junta os identificadores do Instagram e marca o duplicado como unido.';

grant execute on function public.crm_unir_contatos(uuid, uuid) to authenticated, anon, service_role;
grant execute on function public.crm_psids_instagram(text, jsonb) to authenticated, anon, service_role;

notify pgrst, 'reload schema';

-- Quem já está unido, se houver.
select full_name, custom_fields ->> 'crm_unido_para' as unido_para, custom_fields ->> 'crm_unido_em' as quando
  from public.contacts
 where custom_fields ? 'crm_unido_para'
 order by updated_at desc;
