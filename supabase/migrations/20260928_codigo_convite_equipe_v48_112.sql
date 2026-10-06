-- v48.112 — Código de convite para o cadastro público (Configurações → Sistema).
--
-- POR QUE
-- A tela de login (/login) sempre teve um "Criar cadastro" aberto para
-- qualquer pessoa: preenche nome/email/senha e cai na fila de aprovação
-- (user_registration_requests, trigger on_auth_user_created_crm_registration
-- em 20260725_user_registration_approval.sql). Isso é ótimo para uma nova
-- atendente se cadastrar sozinha — mas o mesmo link do CRM que o paciente
-- recebe (crm.obesityhealth.com.br/...) é o mesmo domínio da tela de login.
-- De vez em quando um paciente cai lá (por engano, curiosidade, ou navegando
-- para a raiz do domínio) e "se cadastra" pensando que é necessário — caso
-- real: Claudiana Rodrigues de Oliveira apareceu em "Configurar e aprovar
-- usuário" como se fosse uma atendente nova.
--
-- O QUE ESTE ARQUIVO MUDA
-- Nada muda sozinho: sem código configurado, o cadastro continua aberto
-- exatamente como sempre foi (comportamento padrão preservado). Só quando
-- a clínica DEFINIR um código em Configurações → Sistema é que a tela de
-- login passa a exigi-lo para completar o cadastro — aí quem não sabe o
-- código (qualquer paciente) não consegue mais criar login sozinho.
create extension if not exists pgcrypto;

alter table public.clinic_settings
  add column if not exists equipe_codigo_convite_hash text;

-- Verifica o código digitado na tela de login, ANTES de chamar
-- supabase.auth.signUp — por isso precisa ser chamável por anon (quem está
-- se cadastrando ainda não tem sessão). Sem código configurado (hash nulo),
-- devolve true sempre: não bloqueia quem já usava o cadastro livre.
create or replace function public.verificar_codigo_convite_equipe(candidate text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare stored_hash text;
begin
  select equipe_codigo_convite_hash into stored_hash from public.clinic_settings limit 1;
  if stored_hash is null then return true; end if;
  return crypt(coalesce(candidate, ''), stored_hash) = stored_hash;
end;
$$;

-- Define (ou limpa, com '') o código. Só quem já é admin do CRM — mesma
-- checagem is_crm_admin() usada na senha da Sofia.
--
-- v48.114 — Este projeto roda com uma trava de segurança que rejeita
-- qualquer UPDATE sem WHERE ("UPDATE requires a WHERE clause"), mesmo
-- dentro de uma função security definer. clinic_settings é uma tabela de
-- linha única (configuração global da clínica), então "where id is not
-- null" é seguro e sempre atinge a linha certa — o mesmo padrão que já
-- existe em outro lugar do código para sofia_paused_global.
create or replace function public.definir_codigo_convite_equipe(novo_codigo text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.is_crm_admin(auth.uid()) then raise exception 'Acesso negado'; end if;
  if novo_codigo is null or btrim(novo_codigo) = '' then
    update public.clinic_settings set equipe_codigo_convite_hash = null where id is not null;
  else
    update public.clinic_settings set equipe_codigo_convite_hash = crypt(btrim(novo_codigo), gen_salt('bf', 12)) where id is not null;
  end if;
end;
$$;

-- Diz à tela de login se um código está exigido agora, sem revelar o
-- código nem o hash — só um booleano.
create or replace function public.codigo_convite_equipe_exigido()
returns boolean language sql stable security definer set search_path = public
as $$ select equipe_codigo_convite_hash is not null from public.clinic_settings limit 1 $$;

revoke all on function public.verificar_codigo_convite_equipe(text) from public;
revoke all on function public.definir_codigo_convite_equipe(text) from public;
revoke all on function public.codigo_convite_equipe_exigido() from public;
grant execute on function public.verificar_codigo_convite_equipe(text) to anon, authenticated;
grant execute on function public.definir_codigo_convite_equipe(text) to authenticated;
grant execute on function public.codigo_convite_equipe_exigido() to anon, authenticated;

notify pgrst, 'reload schema';
