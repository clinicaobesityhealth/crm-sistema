-- v48.35 — Saúde dos canais: saber que o Instagram caiu ANTES do paciente avisar.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- O que aconteceu em 16/09: o token do Instagram venceu às 11:19. As mensagens
-- continuaram entrando, a Sofia continuou respondendo dentro do CRM, e nada
-- saía — a Meta recusava cada envio. O fluxo do n8n marcava a execução como
-- "sucesso" porque o nó de envio está configurado para não falhar, então
-- ninguém foi avisado. Uma paciente ficou um dia inteiro sem resposta, e a
-- clínica só descobriu porque o Dr. João reparou.
--
-- Falha silenciosa é o pior tipo de falha. Esta tabela existe para que o
-- estado de cada canal seja uma coisa que o CRM SABE, e não algo que alguém
-- precisa desconfiar.

create table if not exists public.canal_saude (
  id uuid primary key default gen_random_uuid(),

  canal text not null,                    -- 'instagram', e amanhã 'whatsapp'
  conta text not null,                    -- o nome da conta, como aparece no cadastro

  ok boolean not null,
  mensagem text,                          -- o erro como a Meta devolveu, sem tradução
  expirado_em timestamptz,                -- quando a sessão venceu, se a Meta disse

  -- Desde quando está assim. Só muda quando o estado muda — é o que permite
  -- dizer "fora do ar desde ontem às 11h" em vez de "fora do ar agora".
  desde timestamptz not null default now(),
  verificado_em timestamptz not null default now(),

  created_at timestamptz not null default now()
);

-- Índice simples, sem lower(): o upsert do PostgREST só reconhece colunas de
-- verdade. Com uma expressão aqui, "on_conflict" falharia na hora de gravar —
-- foi o que já aconteceu na tabela de preços, na v48.22.
create unique index if not exists idx_canal_saude_conta
  on public.canal_saude (canal, conta);

alter table public.canal_saude enable row level security;
do $$ begin
  create policy canal_saude_all on public.canal_saude for all using (true) with check (true);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

select canal, conta, ok, verificado_em from public.canal_saude order by canal, conta;
