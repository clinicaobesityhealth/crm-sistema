-- v48.55 — Alerta na tela quando o paciente paga.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- O alerta escuta, em tempo real, a cobrança virar "paga". Para o Supabase
-- avisar as telas, a tabela precisa estar na publicação do Realtime — e
-- "replica identity full" faz o aviso trazer também o estado ANTERIOR, que é
-- o que impede o alerta de tocar duas vezes para o mesmo pagamento.

alter table public.cobrancas_cartao replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.cobrancas_cartao;
exception when duplicate_object then null; end $$;

select 'ok' as alerta_de_pagamento;
