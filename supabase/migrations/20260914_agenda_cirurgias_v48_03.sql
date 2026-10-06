-- v48.03 — A cirurgia em si: lançamento, lista e histórico de situações.
--
-- Rode DEPOIS de v48_01 e v48_02. Pode rodar mais de uma vez.
--
-- Esta tabela é o espelho da aba CIRURGIAS, com três diferenças que importam:
--
--   1. O paciente é o MESMO cadastro do CRM (contacts). Na planilha o nome é
--      digitado de novo a cada cirurgia, e "José da Silva" e "Jose da Silva"
--      viram duas pessoas. Aqui a cirurgia aponta para o contato — e com isso a
--      conversa no WhatsApp, a cobrança e a cirurgia passam a ser da mesma
--      pessoa.
--
--   2. Cirurgia realizada e cancelada NÃO mudam de lugar. Na planilha a linha é
--      movida para outra aba; aqui ela muda de situação e a lista filtra. O que
--      aconteceu com o paciente continua junto dele.
--
--   3. Cada troca de situação fica registrada, com quem fez e quando. Hoje isso
--      não existe: a célula é sobrescrita e a anterior desaparece.

create table if not exists public.cirurgias (
  id uuid primary key default gen_random_uuid(),

  -- O paciente. contact_id é a ligação com o CRM; o nome e o telefone ficam
  -- copiados porque a carta e a guia precisam do dado como estava no dia, e
  -- porque um contato apagado não pode levar a cirurgia junto.
  contact_id uuid references public.contacts(id) on delete set null,
  paciente_nome text not null,
  paciente_telefone text,

  data_cirurgia date,
  hora time,

  -- Procedimento: id para as regras e valores, sigla e nome congelados para o
  -- histórico não mudar quando a tabela de preços for atualizada.
  procedimento_id uuid references public.cirurgia_procedimentos(id) on delete set null,
  procedimento_sigla text,
  procedimento_nome text,

  hospital_id uuid references public.cirurgia_hospitais(id) on delete set null,
  hospital text,

  cirurgiao_id uuid references public.cirurgia_equipe(id) on delete set null,
  cirurgiao text,
  composicao_equipe text,

  modalidade text,                       -- CONDIÇÃO na planilha

  status_id uuid references public.cirurgia_status(id) on delete set null,
  status text not null default 'AGENDAR',
  categoria text not null default 'aberta',   -- copiada da situação, para filtrar rápido

  -- Valores. valor_previa é a estimativa; valor_cobrado é o que foi combinado.
  -- Os dois são editáveis: a regra exata de composição vem na etapa de cálculos.
  valor_previa  numeric(10,2),
  valor_cobrado numeric(10,2),
  ajuste_valor  numeric(10,2) not null default 0,

  forma_pagamento text,
  parcelas integer,
  pago boolean not null default false,

  observacao text,
  medicacoes text,
  documentos text,

  -- As três datas que a planilha guarda sem cabeçalho visível.
  data_pre_operatorio       date,
  data_solicitado_hospital  date,
  data_autorizacao          date,

  -- Marca da mensagem de pré-operatório com mais de 30 dias (coluna N).
  -- Vira data, não "✔": assim dá para saber QUANDO foi enviada.
  msg_preop_enviada_em timestamptz,

  agenda_evento_id text,        -- id do evento no Google Agenda, enquanto existir
  planilha_linha integer,       -- linha de origem, para a sincronização

  criado_por uuid references public.agents(id) on delete set null,
  criado_por_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cirurgias_contato   on public.cirurgias(contact_id);
create index if not exists idx_cirurgias_data      on public.cirurgias(data_cirurgia);
create index if not exists idx_cirurgias_categoria on public.cirurgias(categoria);
create index if not exists idx_cirurgias_status    on public.cirurgias(status);

-- Histórico de situações. Uma linha por mudança, nunca apagada.
create table if not exists public.cirurgia_historico (
  id uuid primary key default gen_random_uuid(),
  cirurgia_id uuid not null references public.cirurgias(id) on delete cascade,
  status_anterior text,
  status_novo text not null,
  observacao text,
  agente_id uuid references public.agents(id) on delete set null,
  agente_nome text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cirurgia_hist_cir on public.cirurgia_historico(cirurgia_id, created_at desc);

-- Permissões: mesmo desenho das outras telas — quem está logado lê e escreve.
do $perm$
declare t text;
begin
  foreach t in array array['cirurgias','cirurgia_historico'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_rw" on public.%I', t, t);
    execute format('create policy "%s_rw" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end
$perm$;

-- Toda troca de situação vira linha de histórico, sem a tela precisar lembrar
-- de gravar. Se um dia a mudança vier de outro lugar — da sincronização com a
-- planilha, de uma automação do n8n — o registro acontece do mesmo jeito.
create or replace function public.registrar_historico_cirurgia()
returns trigger language plpgsql as $hist$
begin
  if tg_op = 'INSERT' then
    insert into public.cirurgia_historico (cirurgia_id, status_anterior, status_novo, agente_id, agente_nome)
    values (new.id, null, new.status, new.criado_por, new.criado_por_nome);
  elsif new.status is distinct from old.status then
    insert into public.cirurgia_historico (cirurgia_id, status_anterior, status_novo, agente_id, agente_nome)
    values (new.id, old.status, new.status, new.criado_por, new.criado_por_nome);
  end if;
  return new;
end
$hist$;

drop trigger if exists trg_historico_cirurgia on public.cirurgias;
create trigger trg_historico_cirurgia
  after insert or update of status on public.cirurgias
  for each row execute function public.registrar_historico_cirurgia();
