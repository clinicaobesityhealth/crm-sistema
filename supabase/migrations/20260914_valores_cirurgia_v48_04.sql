-- v48.04 — Cálculo dos valores da cirurgia.
--
-- Rode depois da v48.03. Pode rodar mais de uma vez.
--
-- A conta, conforme você descreveu:
--
--   valor cobrado (o orçamento)
--     = valor da equipe do procedimento
--     + valor do anestesista, SE houver anestesista na equipe E ele não
--       for cobrar direto do paciente
--     + ajuste
--
--   valor da prévia
--     = valor cobrado + percentual da modalidade
--
-- No caso do Leandro: CCC, equipe de 2 auxiliares e 1 instrumentador, sem
-- anestesista → cobrado R$ 10.000; particular com convênio, 30% → prévia
-- R$ 13.000. Bate com a planilha.
--
-- Os dois valores continuam editáveis. Quando você digita por cima, a tela
-- para de recalcular aquele campo e mostra um atalho para voltar ao calculado
-- — porque "às vezes fazemos a alteração manualmente conforme acordo", e um
-- cálculo que sobrescreve o acordo é pior do que cálculo nenhum.

-- 1) Composição da equipe, em números em vez de texto solto ------------------
-- A planilha guarda "2 AUXILIARES, 1 INSTRUMENTADOR" como frase. Frase não
-- entra em conta: é ela que decide se o anestesista soma ou não.
alter table public.cirurgias add column if not exists equipe_auxiliares       integer not null default 0;
alter table public.cirurgias add column if not exists equipe_instrumentadores integer not null default 0;
alter table public.cirurgias add column if not exists tem_anestesista         boolean not null default false;

-- "Varia conforme o acordo paciente x clínica x anestesista": quando marcado,
-- o anestesista fatura direto e sai do orçamento.
alter table public.cirurgias add column if not exists anestesista_cobra_direto boolean not null default false;

-- Marca que o valor foi digitado à mão. Sem isto, o próximo recálculo apagaria
-- o acordo feito com o paciente.
alter table public.cirurgias add column if not exists valor_cobrado_manual boolean not null default false;
alter table public.cirurgias add column if not exists valor_previa_manual  boolean not null default false;

-- 2) O percentual da prévia vive na modalidade ------------------------------
-- Prévia é coisa de reembolso: só faz sentido quando existe convênio. Em vez
-- de deixar os 30% escritos dentro do programa, cada modalidade carrega o seu
-- percentual — e zero significa "esta modalidade não tem prévia".
alter table public.cirurgia_modalidades
  add column if not exists percentual_previa numeric(5,2) not null default 0;

update public.cirurgia_modalidades
   set percentual_previa = 30
 where upper(nome) like '%CONVÊNIO%' or upper(nome) like '%CONVENIO%';
