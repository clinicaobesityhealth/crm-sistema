-- v48.101 — Base própria da clínica para suspensão de medicamentos.
--
-- Rode depois da 20260924_pausamed_suspensao_v48_97.sql. Pode rodar de novo.
--
-- POR QUE ESTA TABELA
-- O PausaMed responde a maioria dos remédios, mas não todos. Antes, quando
-- faltava, a equipe pesquisava com uma IA (workflow n8n "ORIENTAÇÃO REMÉDIOS")
-- que ia acumulando o resultado numa planilha do Google — cada remédio novo
-- pesquisado uma vez, aproveitado depois. Esta tabela é essa mesma planilha,
-- migrada para dentro do CRM: quando o PausaMed não tem o remédio, o CRM
-- consulta aqui primeiro (rápido, sem gastar IA de novo) e só then pesquisa
-- com IA se também não estiver aqui — gravando o resultado nesta tabela para
-- a próxima vez. Ver lib/pausamed.ts.

create table if not exists public.cirurgia_medicamentos_clinica (
  id uuid primary key default gen_random_uuid(),

  principio_ativo text,
  nomes_comerciais text,
  prazo_suspensao_dias integer,       -- em dias antes da cirurgia; 0 = não suspender
  prazo_texto text,                   -- o texto cru ("Não suspender", "reduzir dose 3 dias antes"...)
  orientacao text,                    -- motivo clínico e risco, para a equipe
  explicacao_paciente text,           -- frase simples, para o documento que o paciente recebe
  observacoes text,

  fonte text not null default 'ia',   -- 'ia' (pesquisado agora) | 'sheets_importado' | 'manual'
  ativo boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cirurgia_medicamentos_clinica_ativo_idx
  on public.cirurgia_medicamentos_clinica (ativo);

alter table public.cirurgia_medicamentos_clinica enable row level security;
drop policy if exists "cirurgia_medicamentos_clinica_rw" on public.cirurgia_medicamentos_clinica;
create policy "cirurgia_medicamentos_clinica_rw" on public.cirurgia_medicamentos_clinica
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
