-- v48.56 — PIX confirmado pelo comprovante que o paciente envia.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- O PIX do CRM vai direto para a chave da clínica: o banco não avisa ninguém.
-- A confirmação passa a vir do comprovante que o paciente manda na conversa —
-- a Sofia lê, o fluxo confere com a cobrança aberta e, se bater, dá baixa.
-- Fica registrado COMO foi confirmado, para a equipe saber o que conferir.

alter table public.cobrancas_pix add column if not exists confirmado_por text;   -- comprovante | equipe
alter table public.cobrancas_pix add column if not exists comprovante jsonb;     -- o que foi lido do comprovante

-- Para o alerta aparecer na tela na hora (mesmo mecanismo do cartão).
alter table public.cobrancas_pix replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.cobrancas_pix;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

select 'ok' as pix_por_comprovante;
