-- v48.33 — A folha timbrada inteira, e o carimbo junto com a assinatura.
--
-- Rode depois da v48.32. Pode rodar mais de uma vez.
--
-- Duas correções do que foi entregue na v48.32:
--
--   1. Carimbo e assinatura são a MESMA imagem na prática — o carimbo do
--      médico já vem com a assinatura por cima. Dois campos separados obrigam
--      a inventar uma divisão que não existe no papel.
--
--   2. Montar o papel a partir de pedaços (cabeçalho em cima, rodapé embaixo)
--      nunca sai igual ao impresso: a marca d'água, a faixa lateral, a borda,
--      o espaçamento exato. É mais fiel — e muito mais simples — usar a FOLHA
--      INTEIRA como fundo da página e escrever só o texto por cima.
--
-- Por isso entra papel_url, e com ele as margens da área onde o texto pode
-- entrar. Sem as margens, o texto passaria por cima do cabeçalho impresso.

alter table public.cirurgia_equipe add column if not exists papel_url text;

-- Em milímetros, medidos na folha de verdade. Os padrões são de uma folha A4
-- com cabeçalho de uns 4 cm e rodapé de uns 3 cm, que é o desenho mais comum —
-- e ficam visíveis na tela para ajustar olhando.
alter table public.cirurgia_equipe add column if not exists margem_topo_mm      numeric(5,1) not null default 45;
alter table public.cirurgia_equipe add column if not exists margem_base_mm      numeric(5,1) not null default 35;
alter table public.cirurgia_equipe add column if not exists margem_esquerda_mm  numeric(5,1) not null default 25;
alter table public.cirurgia_equipe add column if not exists margem_direita_mm   numeric(5,1) not null default 20;

-- A assinatura passa a ser "carimbo e assinatura". O que já foi subido como
-- carimbo é aproveitado quando não há assinatura — ninguém precisa subir de novo.
update public.cirurgia_equipe
   set assinatura_url = carimbo_url
 where assinatura_url is null and carimbo_url is not null;

notify pgrst, 'reload schema';

select
  count(*)                                           as pessoas_na_equipe,
  count(*) filter (where papel_url is not null)      as com_folha_timbrada,
  count(*) filter (where assinatura_url is not null) as com_carimbo_assinatura
  from public.cirurgia_equipe;
