-- v48.68 — Agenda pessoal (secretária): compromissos com lembrete.
--
-- Pode rodar de novo sem problema.
--
-- O DESENHO EM UMA LINHA: cada pessoa tem a SUA agenda, ninguém vê a dos
-- outros, e o lembrete chega por três caminhos para não depender de ela estar
-- com o CRM aberto na hora.
--
-- Por que a repetição não vira uma linha por dia: "toda segunda-feira" sem data
-- final geraria linhas para sempre, e mudar o horário depois obrigaria a
-- reescrever todas. Aqui o compromisso é UM registro com a regra, as
-- ocorrências são calculadas na hora de mostrar, e o que se guarda por
-- ocorrência é só o que é fato: foi concluída, foi avisada.

-- ===========================================================================
-- 1) Telefone pessoal e permissão de menu
-- ===========================================================================
-- O lembrete de WhatsApp não pode sair pelo número da clínica para ela mesma.
alter table public.agents
  add column if not exists telefone text;

alter table public.job_titles
  add column if not exists ve_agenda_pessoal boolean not null default false;

-- ===========================================================================
-- 2) Os compromissos
-- ===========================================================================
create table if not exists public.compromissos (
  id uuid primary key default gen_random_uuid(),

  -- Dono: de quem é a agenda. Só ele vê.
  agent_id uuid not null references public.agents(id) on delete cascade,
  -- Quem lançou (o médico pode delegar uma tarefa para a secretária).
  criado_por uuid references public.agents(id) on delete set null,

  titulo text not null,
  descricao text,

  data date not null,
  hora time not null,

  -- Minutos de antecedência do aviso.
  antecedencia_min integer not null default 10,

  -- nenhuma | diaria | semanal | mensal
  repete text not null default 'nenhuma',
  repete_ate date,

  avisar_whatsapp boolean not null default true,
  cancelado boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists compromissos_agente_idx on public.compromissos (agent_id, data);

-- Concluído é por OCORRÊNCIA, não pelo compromisso: "fechar o caixa toda
-- sexta" se conclui em cada sexta, uma de cada vez.
create table if not exists public.compromisso_conclusoes (
  compromisso_id uuid not null references public.compromissos(id) on delete cascade,
  data date not null,
  concluido_em timestamptz not null default now(),
  por uuid references public.agents(id) on delete set null,
  primary key (compromisso_id, data)
);

-- Registro de que o aviso já saiu, para não repetir a cada varredura.
create table if not exists public.compromisso_avisos (
  compromisso_id uuid not null references public.compromissos(id) on delete cascade,
  data date not null,
  canal text not null,
  enviado_em timestamptz not null default now(),
  primary key (compromisso_id, data, canal)
);

alter table public.compromissos enable row level security;
alter table public.compromisso_conclusoes enable row level security;
alter table public.compromisso_avisos enable row level security;

-- A privacidade é regra do banco, não da tela: esconder o menu não bastaria,
-- porque quem soubesse o endereço entraria assim mesmo.
drop policy if exists "compromissos_meus" on public.compromissos;
create policy "compromissos_meus" on public.compromissos
  for all to authenticated
  using (agent_id = auth.uid() or criado_por = auth.uid())
  with check (agent_id = auth.uid() or criado_por = auth.uid());

drop policy if exists "compromisso_conclusoes_minhas" on public.compromisso_conclusoes;
create policy "compromisso_conclusoes_minhas" on public.compromisso_conclusoes
  for all to authenticated
  using (exists (select 1 from public.compromissos c
                  where c.id = compromisso_id
                    and (c.agent_id = auth.uid() or c.criado_por = auth.uid())))
  with check (exists (select 1 from public.compromissos c
                       where c.id = compromisso_id
                         and (c.agent_id = auth.uid() or c.criado_por = auth.uid())));

drop policy if exists "compromisso_avisos_meus" on public.compromisso_avisos;
create policy "compromisso_avisos_meus" on public.compromisso_avisos
  for all to authenticated
  using (exists (select 1 from public.compromissos c
                  where c.id = compromisso_id and c.agent_id = auth.uid()))
  with check (exists (select 1 from public.compromissos c
                       where c.id = compromisso_id and c.agent_id = auth.uid()));

do $$
begin
  alter publication supabase_realtime add table public.compromissos;
exception when others then null;
end $$;

-- ===========================================================================
-- 3) As ocorrências de um intervalo
-- ===========================================================================
-- Uma ocorrência é um par (compromisso, dia). A regra de repetição vira um
-- filtro sobre os dias do intervalo — nada é materializado.
create or replace function public.compromissos_ocorrencias(
  p_agente uuid, p_de date, p_ate date
)
returns table (
  compromisso_id uuid, titulo text, descricao text, dia date, hora time,
  antecedencia_min integer, repete text, concluido boolean, criado_por uuid
)
language sql
stable
security definer
set search_path = public
as $occ$
  select c.id, c.titulo, c.descricao, d::date, c.hora, c.antecedencia_min, c.repete,
         exists (select 1 from public.compromisso_conclusoes k
                  where k.compromisso_id = c.id and k.data = d::date) as concluido,
         c.criado_por
    from public.compromissos c
    cross join generate_series(p_de, p_ate, interval '1 day') as d
   where c.agent_id = p_agente
     and not c.cancelado
     and d::date >= c.data
     and (c.repete_ate is null or d::date <= c.repete_ate)
     and case c.repete
           when 'nenhuma' then d::date = c.data
           when 'diaria'  then true
           when 'semanal' then extract(dow  from d::date) = extract(dow  from c.data)
           when 'mensal'  then extract(day  from d::date) = extract(day  from c.data)
           else d::date = c.data
         end
   order by d::date, c.hora;
$occ$;

grant execute on function public.compromissos_ocorrencias(uuid, date, date) to authenticated;

-- O que está em aberto para MIM: o que já deveria ter avisado (inclusive de
-- dias anteriores, para quem não estava online) e ainda não foi concluído.
create or replace function public.meus_compromissos_pendentes(p_dias_atras integer default 7)
returns table (
  compromisso_id uuid, titulo text, descricao text, dia date, hora time,
  antecedencia_min integer, atrasado boolean
)
language sql
stable
security definer
set search_path = public
as $pend$
  select o.compromisso_id, o.titulo, o.descricao, o.dia, o.hora, o.antecedencia_min,
         ((o.dia + o.hora) at time zone 'America/Sao_Paulo') < now() as atrasado
    from public.compromissos_ocorrencias(
           auth.uid(),
           (now() at time zone 'America/Sao_Paulo')::date - greatest(coalesce(p_dias_atras, 7), 0),
           (now() at time zone 'America/Sao_Paulo')::date) o
   where not o.concluido
     and ((o.dia + o.hora) at time zone 'America/Sao_Paulo')
         - make_interval(mins => coalesce(o.antecedencia_min, 10)) <= now()
   order by o.dia, o.hora;
$pend$;

grant execute on function public.meus_compromissos_pendentes(integer) to authenticated;

-- ===========================================================================
-- 4) Quem manda o WhatsApp
-- ===========================================================================
-- Esta é a parte que precisa funcionar com o CRM FECHADO — é justamente para
-- isso que o lembrete vai para o celular. Então quem varre é um agendador de
-- fora (n8n, a cada 5 minutos), e esta função é o contrato entre os dois:
-- devolve o que está na hora de avisar e, no mesmo passo, marca como avisado.
--
-- Marcar dentro da função (e não depois de enviar) é deliberado: entre ler e
-- enviar pode haver uma segunda varredura, e receber o mesmo lembrete duas
-- vezes é pior do que perder um por falha de rede — este, o card no CRM cobre.
create or replace function public.compromissos_para_avisar()
returns table (compromisso_id uuid, dia date, telefone text, texto text)
language plpgsql
security definer
set search_path = public
as $avi$
-- Os nomes de saída (compromisso_id, dia...) colidem com colunas dentro da
-- consulta; aqui a coluna ganha.
#variable_conflict use_column
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  return query
  with candidatos as (
    select c.id, d::date as ddia, c.titulo, c.descricao, c.hora, a.telefone
      from public.compromissos c
      join public.agents a on a.id = c.agent_id
      cross join generate_series(hoje - 1, hoje, interval '1 day') as d
     where not c.cancelado
       and c.avisar_whatsapp
       and coalesce(btrim(a.telefone), '') <> ''
       and d::date >= c.data
       and (c.repete_ate is null or d::date <= c.repete_ate)
       and case c.repete
             when 'nenhuma' then d::date = c.data
             when 'diaria'  then true
             when 'semanal' then extract(dow from d::date) = extract(dow from c.data)
             when 'mensal'  then extract(day from d::date) = extract(day from c.data)
             else d::date = c.data
           end
       -- Já está dentro da antecedência...
       and ((d::date + c.hora) at time zone 'America/Sao_Paulo')
           - make_interval(mins => coalesce(c.antecedencia_min, 10)) <= now()
       -- ...e não é lembrete de ontem ressuscitado: passou mais de 2 horas da
       -- hora marcada, o WhatsApp não ajuda mais, só assusta.
       and ((d::date + c.hora) at time zone 'America/Sao_Paulo') + interval '2 hours' >= now()
       and not exists (select 1 from public.compromisso_conclusoes k
                        where k.compromisso_id = c.id and k.data = d::date)
       and not exists (select 1 from public.compromisso_avisos v
                        where v.compromisso_id = c.id and v.data = d::date and v.canal = 'whatsapp')
  ),
  marcados as (
    insert into public.compromisso_avisos (compromisso_id, data, canal)
    select id, ddia, 'whatsapp' from candidatos
    on conflict do nothing
    returning compromisso_id, data
  )
  select c.id, c.ddia,
         regexp_replace(c.telefone, '[^0-9]', '', 'g'),
         '⏰ *' || c.titulo || '* às ' || to_char(c.hora, 'HH24:MI')
           || coalesce(chr(10) || c.descricao, '')
      from candidatos c
      join marcados m on m.compromisso_id = c.id and m.data = c.ddia;
end
$avi$;
