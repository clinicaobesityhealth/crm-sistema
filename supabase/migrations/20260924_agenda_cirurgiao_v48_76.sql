-- v48.76 — Página de agendamento para o cirurgião.
--
-- Rode depois da 20260923_internacao_v48_75.sql. Pode rodar de novo.
--
-- POR QUE ELA EXISTE
-- Hoje o cirurgião manda a cirurgia por WhatsApp, em texto corrido, e alguém
-- transcreve para o CRM. O que se perde na transcrição é sempre o mesmo: a via
-- de acesso, a composição da equipe, a medicação em uso. Aqui ele lança direto,
-- num formulário curto, e a secretária recebe pronto.
--
-- Ele NÃO mexe no resto: só três situações (pré-operatório, agendar, cancelada)
-- e nada de valores, convênio autorizado, carta ou cobrança. O resto é da casa.

-- ===========================================================================
-- 1) O link e o que cada botão do cirurgião significa
-- ===========================================================================
-- Um link só para todos, e ele escolhe o próprio nome. Foi a opção da clínica:
-- mais simples de distribuir do que um endereço por médico.
alter table public.clinic_settings
  add column if not exists agenda_cirurgiao jsonb not null default '{"ativa": false}'::jsonb;

-- Nasce com uma chave longa e aleatória. É ela que protege a página — por isso
-- é gerada aqui, e não digitada por alguém.
update public.clinic_settings
   set agenda_cirurgiao = coalesce(agenda_cirurgiao, '{}'::jsonb)
       -- md5 duas vezes em vez de gen_random_bytes: dá os mesmos 64 caracteres
       -- hexadecimais sem depender de a extensão pgcrypto estar instalada.
       || jsonb_build_object('token',
            md5(random()::text || clock_timestamp()::text || id::text)
            || md5(clock_timestamp()::text || random()::text))
 where coalesce(agenda_cirurgiao->>'token', '') = '';

-- Os três botões apontam para situações do cadastro. Ficam configuráveis
-- porque o nome das situações é da clínica, não do programa.
update public.clinic_settings s
   set agenda_cirurgiao = s.agenda_cirurgiao || jsonb_build_object(
     'status_preop',     (select id::text from public.cirurgia_status where ativo and upper(nome) like 'PR%OPERAT%' order by ordem limit 1),
     'status_agendar',   (select id::text from public.cirurgia_status where ativo and upper(nome) like '%SOLICITAD%' order by ordem limit 1),
     'status_cancelada', (select id::text from public.cirurgia_status where ativo and upper(nome) like 'CANCELAD%' order by ordem limit 1))
 where coalesce(s.agenda_cirurgiao->>'status_preop', '') = '';

-- ===========================================================================
-- 2) De onde veio a cirurgia, e se a equipe já viu
-- ===========================================================================
alter table public.cirurgias
  add column if not exists origem text not null default 'crm',
  add column if not exists lancada_por text,
  add column if not exists vista_pela_equipe_em timestamptz,
  -- Documentos que o cirurgião anexa no lançamento (pedido, exame, foto).
  add column if not exists anexos jsonb not null default '[]'::jsonb;

create index if not exists cirurgias_novas_do_cirurgiao_idx
  on public.cirurgias (origem, vista_pela_equipe_em)
  where origem = 'cirurgiao';

-- ===========================================================================
-- 3) As cirurgias que ele mais lança
-- ===========================================================================
-- "os 5 de acesso mais fácil": em vez de um campo marcado à mão, a lista sai do
-- que ele de fato lançou nos últimos meses. Quem opera hérnia toda semana não
-- deveria procurar hérnia numa lista de sessenta.
create or replace function public.cirurgias_frequentes(p_equipe uuid, p_limite integer default 5)
returns table (procedimento_id uuid, sigla text, nome text, quantas bigint)
language sql
stable
security definer
set search_path = public
as $fq$
  select p.id, p.sigla, p.nome, count(*) as quantas
    from public.cirurgias c
    join public.cirurgia_itens i on i.cirurgia_id = c.id
    join public.cirurgia_procedimentos p on p.id = i.procedimento_id
   where p.ativo
     and (p_equipe is null or c.cirurgiao_id = p_equipe)
     and c.created_at > now() - interval '18 months'
   group by p.id, p.sigla, p.nome
   order by count(*) desc, p.nome
   limit greatest(coalesce(p_limite, 5), 1)
$fq$;

grant execute on function public.cirurgias_frequentes(uuid, integer) to anon, authenticated;

insert into storage.buckets (id, name, public)
select 'anexos', 'anexos', true
where not exists (select 1 from storage.buckets where id = 'anexos');

notify pgrst, 'reload schema';
