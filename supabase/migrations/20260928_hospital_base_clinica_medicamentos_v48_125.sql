-- v48.125 — Coluna hospital em cirurgia_medicamentos_clinica.
--
-- Rode depois da 20260924_base_clinica_medicamentos_v48_101.sql. Pode rodar
-- de novo.
--
-- POR QUE
-- Relato real do Jorge: adicionou Mounjaro e o sistema preencheu 21 dias,
-- mas o certo na clínica dele é 14 ou 15 dias, DEPENDENDO DO HOSPITAL da
-- cirurgia. Investigando (ver lib/pausamed.ts): o PausaMed não tem regra
-- hospital-específica para tirzepatida nos hospitais do Jorge, então a busca
-- caía no padrão genérico do PausaMed (21 dias, sem noção de hospital). E
-- mesmo que o Jorge corrigisse o valor uma vez e salvasse na base própria da
-- clínica (cirurgia_medicamentos_clinica), essa tabela não distinguia
-- hospital nenhum — buscarNaBaseClinica() casava só por princípio_ativo /
-- nomes_comerciais. Resultado: uma correção para o Hospital A vazaria (ou
-- brigaria) com a resposta certa do Hospital B.
--
-- NULL = "vale para qualquer hospital" (fallback, prioridade MENOR que uma
-- linha específica daquele hospital — ver a ordem comentada em
-- resolverMedicamento(), lib/pausamed.ts).

alter table public.cirurgia_medicamentos_clinica
  add column if not exists hospital text;

comment on column public.cirurgia_medicamentos_clinica.hospital is
  'Nome do hospital ao qual esta regra se aplica (mesmo texto livre de cirurgias.hospital). NULL/vazio = vale para qualquer hospital (fallback). Ver resolverMedicamento() em lib/pausamed.ts.';

create index if not exists cirurgia_medicamentos_clinica_hospital_idx
  on public.cirurgia_medicamentos_clinica (hospital);

notify pgrst, 'reload schema';
