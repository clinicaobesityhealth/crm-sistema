-- v48.144 — Autocomplete de medicamento (catálogo do PausaMed) + campo de
-- REFERÊNCIA (fonte da informação) de verdade.
--
-- Pode rodar mais de uma vez.
--
-- POR QUE
-- O Jorge digitou "MOUJARO" de propósito (em vez de "MOUNJARO") para mostrar
-- o problema: a IA não reconheceu o nome, não achou o remédio, e voltou um
-- prazo genérico errado (21 dias) sem avisar que não tinha certeza. Duas
-- frentes:
--
--   1) Prevenir o erro de digitação NA ORIGEM: um campo com autocomplete que
--      já sugere o nome certo enquanto o médico/equipe digita — agora
--      olhando também o catálogo do PRÓPRIO PausaMed (clinical_rules), não
--      só o que a nossa clínica já tinha pesquisado antes. Ver
--      sugerirMedicamentos() em lib/pausamed.ts. Escolher da lista já
--      inclui o remédio e limpa o campo para o próximo, sem precisar clicar
--      em "Adicionar" de novo.
--
--   2) Quando o remédio REALMENTE não está em lugar nenhum (nem PausaMed,
--      nem nossa base, então cai na pesquisa por IA): a IA agora também
--      devolve de ONDE tirou a informação (bula do fabricante, diretriz de
--      sociedade médica, etc.) — ver workflow "CRM - Pesquisar Remédio (IA)"
--      no n8n. Isto é a base de conhecimento treinado da IA, não uma busca
--      ao vivo na internet (o n8n não tem hoje uma ferramenta de busca web
--      configurada) — o campo existe para a equipe SABER e CONFERIR a fonte
--      antes de aprovar, não para substituir a checagem humana.
--
-- cirurgia_medicamentos já tinha uma coluna "fonte_referencia" que, por um
-- desencontro de nomes, vinha sendo usada para guardar o TEXTO CRU do prazo
-- ("21 dias"), não uma referência de verdade — e nunca era mostrada em
-- lugar nenhum na tela, então isso nunca quebrou nada visível. A partir de
-- agora ela passa a guardar a referência de verdade (ver lib/pausamed.ts).
-- cirurgia_medicamentos_clinica não tinha nenhuma coluna equivalente —
-- entra aqui.

alter table public.cirurgia_medicamentos_clinica
  add column if not exists referencia text;

comment on column public.cirurgia_medicamentos_clinica.referencia is
  'De onde veio a orientação (bula do fabricante, diretriz de sociedade médica, regra própria...) — mostrado à equipe para conferir antes de confiar. Não é um link de busca ao vivo: vem do conhecimento treinado da IA, ver workflow "CRM - Pesquisar Remédio (IA)" no n8n.';

comment on column public.cirurgia_medicamentos.fonte_referencia is
  'De onde veio a orientação (bula do fabricante, diretriz de sociedade médica, regra própria do PausaMed...) — mostrado à equipe para conferir antes de aprovar. Não é um link de busca ao vivo quando fonte=ia.';

notify pgrst, 'reload schema';
