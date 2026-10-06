-- v48.97 — Integração com o PausaMed: suspensão de medicamentos.
--
-- Rode depois da 20260924_reembolso_v48_93.sql. Pode rodar mais de uma vez.
--
-- O que entra:
--
--   1. cirurgia_medicamentos — a lista estruturada de remédios da cirurgia
--      (substitui, aos poucos, o campo de texto livre `cirurgias.medicacoes`).
--      Cada linha pode vir resolvida pela base do PausaMed (consultada pelo
--      backend do nosso CRM — ver lib/pausamed.ts) ou preenchida à mão.
--
--   2. Um 5º tipo de carta, 'suspensao_medicamentos', no mesmo motor que já
--      gera orçamento/solicitação/internação/reembolso — mesma folha
--      timbrada, mesmo fluxo de revisar-antes-de-gerar.
--
--   3. O gatilho: quando a cirurgia entra em "SOLICITADO AO HOSPITAL", nasce
--      um aviso pedindo para revisar e gerar o documento — reaproveita o
--      mesmo mecanismo de cirurgia_mensagens/cirurgia_avisos que já avisa
--      "cirurgia solicitada" e "convênio autorizou" (v48.66/v48.67). Como o
--      texto aqui é uma tarefa interna (revisar), e não uma notícia para o
--      paciente, o aviso fica marcado para NUNCA ir para o WhatsApp do
--      paciente — ver a trava em app/api/cirurgias/avisos/route.ts.
--
--   4. avisar_suspensao_medicamentos() — varredura (como avisar_cirurgias_
--      paradas) que cria, um dia antes da data de suspensão de CADA
--      medicamento aprovado, um aviso específico para aquele remédio.

-- ===========================================================================
-- 1) A lista estruturada de medicamentos por cirurgia
-- ===========================================================================
create table if not exists public.cirurgia_medicamentos (
  id uuid primary key default gen_random_uuid(),
  cirurgia_id uuid not null references public.cirurgias(id) on delete cascade,

  nome_informado text not null,
  principio_ativo text,
  nomes_comerciais text,
  prazo_suspensao_dias integer,
  explicacao_paciente text,
  clinical_notes text,          -- uso interno; NUNCA vai para o PDF do paciente

  -- hospital | clinica | hospital_importada | geral | manual
  fonte text,
  fonte_detalhe text,
  fonte_referencia text,

  -- pendente → falta prazo/explicação (bloqueia o PDF)
  -- resolvido → achou regra no PausaMed, ainda não aprovado
  -- manual → o médico preencheu na mão, ainda não aprovado
  -- aprovado → confirmado; é o que sai no PDF
  status text not null default 'pendente',

  aprovado_por uuid,
  aprovado_em timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists cirurgia_medicamentos_cirurgia_idx
  on public.cirurgia_medicamentos (cirurgia_id);

alter table public.cirurgia_medicamentos enable row level security;
drop policy if exists "cirurgia_medicamentos_rw" on public.cirurgia_medicamentos;
create policy "cirurgia_medicamentos_rw" on public.cirurgia_medicamentos
  for all to authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.cirurgia_medicamentos;
exception when others then null;
end $$;

create or replace function public.tocar_atualizado_em()
returns trigger language plpgsql as $tae$
begin
  new.atualizado_em := now();
  return new;
end
$tae$;

drop trigger if exists trg_cirurgia_medicamentos_atualizado on public.cirurgia_medicamentos;
create trigger trg_cirurgia_medicamentos_atualizado
  before update on public.cirurgia_medicamentos
  for each row execute function public.tocar_atualizado_em();

-- ===========================================================================
-- 2) O 5º tipo de carta
-- ===========================================================================
insert into public.cirurgia_cartas (tipo, titulo, corpo)
select 'suspensao_medicamentos', 'ORIENTAÇÃO DE SUSPENSÃO DE MEDICAMENTOS',
$T$Prezado(a) {paciente},

Para a sua cirurgia ({cirurgia}) marcada para {data}, no {hospital}, siga a orientação abaixo sobre os medicamentos que estão em uso.

{medicamentos}

Qualquer dúvida sobre um medicamento que não esteja nesta lista, fale com a equipe antes de suspender por conta própria.

Equipe do(a) {cirurgiao}$T$
where not exists (select 1 from public.cirurgia_cartas where tipo = 'suspensao_medicamentos');

-- ===========================================================================
-- 3) O gatilho: "SOLICITADO AO HOSPITAL" → tarefa interna de revisar
-- ===========================================================================
-- Texto SEM dado de paciente de propósito: quem vê isto é a nossa equipe (o
-- aviso nunca é enviado ao WhatsApp do paciente — a trava está na API), então
-- o texto é só o lembrete da tarefa.
insert into public.cirurgia_mensagens
  (tipo, titulo, dias_offset, hora, texto, ativo, ordem, disparo_status, quando, minutos_atraso)
select * from (values
  ('medicamentos_pendentes', 'Revisar medicações da cirurgia', 0, time '09:00',
$T$Revisar as medicações de {paciente} ({cirurgia}, {data}) e gerar a orientação de suspensão antes de enviar ao paciente.$T$,
  false, 1, 'SOLICITADO AO HOSPITAL', 'na_hora', 10)
) as novos(tipo, titulo, dias_offset, hora, texto, ativo, ordem, disparo_status, quando, minutos_atraso)
where not exists (select 1 from public.cirurgia_mensagens c where c.tipo = novos.tipo);

-- ===========================================================================
-- 4) O aviso por remédio, um dia antes da data de suspensão de CADA um
-- ===========================================================================
-- data de suspensão = data da cirurgia − prazo_suspensao_dias. O aviso nasce
-- quando faltar exatamente 1 dia para essa data (não "a partir de", para não
-- lembrar todo dia até lá — é aviso de véspera, não contagem regressiva).
create or replace function public.avisar_suspensao_medicamentos()
returns integer
language plpgsql
security definer
set search_path = public
as $sus$
declare
  med record;
  v_data_suspensao date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_texto text;
  v_criados integer := 0;
begin
  for med in
    select cm.*, c.paciente_nome, c.contact_id, c.data_cirurgia, c.hospital, c.cirurgiao
      from public.cirurgia_medicamentos cm
      join public.cirurgias c on c.id = cm.cirurgia_id
     where cm.status = 'aprovado'
       and cm.prazo_suspensao_dias is not null
       and c.data_cirurgia is not null
       and c.contact_id is not null
       and coalesce(c.categoria, '') not in ('cancelada', 'realizada')
  loop
    v_data_suspensao := med.data_cirurgia - med.prazo_suspensao_dias;
    continue when v_data_suspensao <> (v_hoje + 1);

    v_texto := 'Prezado(a) Sr(a). ' || initcap(lower(split_part(trim(coalesce(med.paciente_nome, '')), ' ', 1))) || ',' || chr(10) || chr(10)
      || 'Amanhã (' || to_char(v_data_suspensao, 'DD/MM/YYYY') || ') é o dia de suspender o uso de *' || med.nome_informado || '*, por causa da sua cirurgia marcada para '
      || to_char(med.data_cirurgia, 'DD/MM/YYYY') || '.' || chr(10) || chr(10)
      || coalesce(nullif(btrim(med.explicacao_paciente), ''), 'Qualquer dúvida, fale com a equipe antes de suspender.')
      || chr(10) || chr(10) || 'Equipe do(a) ' || coalesce(med.cirurgiao, 'clínica');

    insert into public.cirurgia_avisos (cirurgia_id, contact_id, tipo, titulo, texto, chave)
    values (
      med.cirurgia_id, med.contact_id, 'medicacao_suspender',
      'Suspender ' || med.nome_informado, v_texto,
      'medicacao_suspender:' || med.id::text || ':' || v_data_suspensao::text
    )
    on conflict (chave) do nothing;

    if found then v_criados := v_criados + 1; end if;
  end loop;

  return v_criados;
end
$sus$;

grant execute on function public.avisar_suspensao_medicamentos() to authenticated;

notify pgrst, 'reload schema';
