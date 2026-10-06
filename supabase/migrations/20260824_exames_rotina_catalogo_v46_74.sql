-- v46.74: catálogo de exames de rotina, usado no passo "Exames" do modal
-- "Agendar msg de retorno" (aba MedX do atendimento do paciente).
--
-- Antes o campo era texto livre (até 5 caixas de texto, sem memória). Agora
-- os exames ficam cadastrados aqui: a tela oferece selecionar os já
-- cadastrados, cadastrar um novo (fica salvo pra próxima vez) ou excluir um
-- da lista. É 100% aditivo — não mexe em nenhuma tabela existente.
--
-- IMPORTANTE: aplique este SQL no Supabase ANTES de publicar o deploy do CRM
-- que acompanha esta versão (o modal de retorno passa a consultar esta
-- tabela; se ela não existir, a lista de exames aparece vazia).

create table if not exists public.exames_rotina (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null default '00000000-0000-0000-0000-000000000001',
  nome text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists exames_rotina_nome_unique on public.exames_rotina (lower(nome));

-- Este projeto Supabase ativa RLS por padrão em tabelas novas, sem nenhuma
-- política — o que bloqueia silenciosamente o SELECT (lista vazia, sem erro)
-- e bloqueia o INSERT/DELETE com erro explícito. As demais tabelas de
-- catálogo simples do sistema (ex.: job_titles) não usam RLS, então seguimos
-- o mesmo padrão aqui.
alter table public.exames_rotina disable row level security;

-- Semente com os exames que o Jorge pediu pra sempre ter cadastrados
-- (o restante da lista pode ser editado livremente pela tela).
insert into public.exames_rotina (nome) values
  ('Endoscopia'),
  ('Exames laboratoriais'),
  ('Colonoscopia'),
  ('Ultrassonografia')
on conflict do nothing;
