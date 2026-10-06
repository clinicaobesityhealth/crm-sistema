-- v48.69 — Orçamento de honorários médicos: o primeiro documento no CRM.
--
-- Pode rodar de novo sem problema.
--
-- O QUE SAI DA PLANILHA COM ISTO
-- A carta era uma aba formatada preenchida célula a célula pelo Apps Script.
-- Aqui o texto é um MODELO editável na tela, os valores vêm do cadastro, e o
-- PDF é escrito por cima da folha timbrada que já está no CRM.
--
-- A prévia (cobrado + 30%) deixa de existir por decisão da clínica: o mesmo
-- orçamento é o que o paciente manda ao convênio para análise de prévia, e o
-- documento passa a dizer isso.

-- ===========================================================================
-- 1) Diagnóstico do procedimento
-- ===========================================================================
-- A carta pede "Diagnóstico(s): HERNIA INGUINAL DIREITA (K409)". Isso morava
-- na aba DADOS CARTAS da planilha; agora é do procedimento, onde deveria estar.
alter table public.cirurgia_procedimentos
  add column if not exists diagnostico text,
  add column if not exists cid text;

-- ===========================================================================
-- 2) Modelos de carta
-- ===========================================================================
-- Texto fora do programa, como as mensagens: mudar uma frase de uma carta não
-- pode depender de subir versão nova do sistema.
create table if not exists public.cirurgia_cartas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null unique,       -- orcamento | solicitacao | internacao | reembolso | remedios
  titulo text not null,            -- o título impresso
  corpo text not null,
  ativo boolean not null default true,
  ordem integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.cirurgia_cartas enable row level security;
drop policy if exists "cirurgia_cartas_rw" on public.cirurgia_cartas;
create policy "cirurgia_cartas_rw" on public.cirurgia_cartas
  for all to authenticated using (true) with check (true);

insert into public.cirurgia_cartas (tipo, titulo, corpo, ordem)
select * from (values
  ('orcamento', 'ORÇAMENTO DE HONORÁRIOS MÉDICOS',
$T$SR(A) {paciente}

Ao convênio,

Solicito análise de prévia de reembolso para o(a) paciente referido(a) que necessita ser submetido(a) ao(s) tratamento(s) cirúrgicos abaixo relacionados que está prevista para ocorrer em {data} no hospital {hospital}.

Procedimento(s):
{procedimentos}

Diagnóstico(s):
{diagnosticos}

HONORÁRIOS   {valor}   ({valor_extenso})

{divisao}

Este documento deve ser enviado ao convênio para análise de prévia de reembolso, se for o caso.

O ORÇAMENTO DO HOSPITAL SERÁ ENVIADO SEPARADAMENTE$T$, 1)
) as novos(tipo, titulo, corpo, ordem)
where not exists (select 1 from public.cirurgia_cartas c where c.tipo = novos.tipo);

-- ===========================================================================
-- 3) Os documentos gerados
-- ===========================================================================
-- Guardar o texto junto do PDF, e não só o arquivo: seis meses depois alguém
-- vai perguntar por que aquele orçamento saiu naquele valor, e a resposta tem
-- de estar no documento que foi enviado, não no cadastro de hoje.
create table if not exists public.cirurgia_documentos (
  id uuid primary key default gen_random_uuid(),
  cirurgia_id uuid not null references public.cirurgias(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  texto text not null,
  valor numeric(10,2),
  url text,
  nome_arquivo text,
  criado_em timestamptz not null default now(),
  criado_por text,
  enviado_em timestamptz
);

create index if not exists cirurgia_documentos_cir_idx
  on public.cirurgia_documentos (cirurgia_id, criado_em desc);

alter table public.cirurgia_documentos enable row level security;
drop policy if exists "cirurgia_documentos_rw" on public.cirurgia_documentos;
create policy "cirurgia_documentos_rw" on public.cirurgia_documentos
  for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
select 'documentos', 'documentos', true
where not exists (select 1 from storage.buckets where id = 'documentos');
