-- v48.168 — Caso Nathalia: o agendamento pelo link do cirurgião não
-- reconheceu que ela já era cadastro do CRM, e criou um contato duplicado a
-- partir do espelho do MedX.
--
-- RAIZ DO PROBLEMA (buscar_pacientes, v48.77): a função só considera "é a
-- mesma pessoa" quando o telefone do CRM e o telefone do MedX são IGUAIS,
-- dígito por dígito, depois de tirar tudo que não é número. Isso falha
-- sempre que um dos dois guarda o telefone com o "55" (código do país) na
-- frente e o outro não — que é exatamente como os dois lados gravam hoje: o
-- WhatsApp manda o telefone com 55 (e o CRM guarda como veio), e o MedX
-- guarda no formato local, sem 55. Resultado: a pessoa aparece DUAS vezes na
-- busca (uma vinda do CRM, outra do MedX, marcada "MedX"), e se quem está
-- agendando clicar na errada, nasce um cadastro novo em vez de usar o que já
-- existe.
--
-- A CORREÇÃO
-- 1) Comparar os telefones ignorando um "55" extra na frente de qualquer um
--    dos dois lados — função normalizar_telefone_br_v2(), abaixo.
-- 2) Também considerar "mesma pessoa" quando o contato do CRM já tem
--    medx_id preenchido igual ao Id_do_Cliente do MedX (um vínculo feito
--    antes, por exemplo pelo botão "Buscar no MedX" do cadastro) — isso não
--    dependia de telefone nenhum, e por isso nunca falha por formatação.
-- 3) A busca passa a devolver o medx_id de quem já é contato do CRM (antes
--    vinha sempre vazio nessa linha), para quem usar o resultado conseguir
--    ver que o vínculo já existe.
--
-- Pode rodar de novo sem problema.

create or replace function public.normalizar_telefone_br_v2(t text)
returns text
language sql
immutable
as $nt$
  select case
    -- Com "55" na frente e mais de 11 dígitos (DDD + 9 dígitos do celular):
    -- fica só com os últimos 11, tirando o código do país.
    when length(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g')) > 11
      then right(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), 11)
    else regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g')
  end
$nt$;

create or replace function public.buscar_pacientes(p_termo text, p_limite integer default 8)
returns table (
  origem text, id text, nome text, telefone text, id_medx text, nascimento date
)
language sql
stable
security definer
set search_path = public
as $bp$
  with digitos as (select regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') as d),
  crm as (
    -- v48.168 — id_medx agora vem de verdade (c.medx_id), não mais null fixo:
    -- quando o contato já está vinculado ao MedX, isso fica visível para
    -- quem usa o resultado.
    select 'crm'::text as origem, c.id::text, c.full_name as nome, c.phone as telefone,
           c.medx_id as id_medx, null::date as nascimento
      from public.contacts c, digitos
     where (btrim(public.chave_nome(p_termo)) <> ''
            and public.chave_nome(c.full_name) like '%' || public.chave_nome(p_termo) || '%')
        or (digitos.d <> '' and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || digitos.d || '%')
     limit greatest(coalesce(p_limite, 8), 1)
  ),
  medx as (
    select 'medx'::text as origem, m.id_cliente as id, m.nome, coalesce(m.celular, m.telefone) as telefone,
           m.id_cliente as id_medx, m.nascimento
      from public.medx_contatos m, digitos
     where (btrim(public.chave_nome(p_termo)) <> ''
            and public.chave_nome(m.nome) like '%' || public.chave_nome(p_termo) || '%')
        or (digitos.d <> '' and regexp_replace(coalesce(m.celular, ''), '[^0-9]', '', 'g') like '%' || digitos.d || '%')
     limit greatest(coalesce(p_limite, 8), 1)
  )
  select * from crm
  union all
  -- v48.168 — Quem já está no CRM não aparece duas vezes: agora reconhecido
  -- pelo telefone normalizado (ignora o "55" extra de qualquer lado) OU pelo
  -- medx_id já vinculado ao cadastro do CRM.
  select * from medx
   where not exists (
     select 1 from crm
      where (
        crm.id_medx is not null and crm.id_medx <> '' and crm.id_medx = medx.id_medx
      ) or (
        public.normalizar_telefone_br_v2(crm.telefone) <> ''
        and public.normalizar_telefone_br_v2(crm.telefone) = public.normalizar_telefone_br_v2(medx.telefone)
      ))
$bp$;

grant execute on function public.normalizar_telefone_br_v2(text) to authenticated;
grant execute on function public.buscar_pacientes(text, integer) to authenticated;

notify pgrst, 'reload schema';
