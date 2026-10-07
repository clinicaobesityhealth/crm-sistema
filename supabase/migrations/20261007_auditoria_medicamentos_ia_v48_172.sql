-- v48.172 — "Auditoria" da pesquisa por IA: busca ao vivo na internet, motivo
-- em linguagem simples, fontes consultadas e correção automática de nome.
--
-- Pode rodar mais de uma vez.
--
-- POR QUE
-- Pedido do Jorge (caso do paciente Wladimir): a pesquisa por IA de suspensão
-- de medicamento precisa SEMPRE buscar ao vivo na internet (não só responder
-- do que já sabe), sempre voltar o MOTIVO da suspensão (não só o prazo) com
-- uma REFERÊNCIA de verdade, e corrigir sozinha erro de digitação no nome
-- (ex.: "Coondroflex" → "Condroflex") sem fazer isso calado. Jorge pediu para
-- chamar esse resumo de "auditoria" — ver workflow "CRM - Pesquisar Remédio
-- (IA)" no n8n, que agora usa o Google Gemini com busca Google real
-- (googleSearch) em vez de só conhecimento treinado.
--
-- cirurgia_medicamentos já tinha "fonte_referencia" (texto livre, sem
-- garantia de ser uma busca ao vivo — ver comentário da migração
-- 20260930_referencia_medicamento_v48_144.sql). Esta coluna continua existindo
-- e sendo preenchida (compatibilidade), mas o que a equipe deve conferir
-- agora é "motivo_suspensao" + "fontes_consultadas" + "confiabilidade" +
-- "auditado", que são específicos da pesquisa feita AGORA, com rastro de
-- onde veio.
--
-- nome_digitado_original: quando a IA corrige um erro de digitação, o nome
-- aceito (nome_informado) passa a ser já o nome corrigido — mas o que a
-- pessoa realmente digitou fica guardado aqui, para transparência (nunca se
-- perde a informação de que houve uma correção automática).

-- ===========================================================================
-- cirurgia_medicamentos (por cirurgia)
-- ===========================================================================
alter table public.cirurgia_medicamentos
  add column if not exists nome_digitado_original text;

alter table public.cirurgia_medicamentos
  add column if not exists correcao_automatica boolean not null default false;

alter table public.cirurgia_medicamentos
  add column if not exists correcao_detalhe text;

alter table public.cirurgia_medicamentos
  add column if not exists motivo_suspensao text;

alter table public.cirurgia_medicamentos
  add column if not exists fontes_consultadas jsonb not null default '[]'::jsonb;

alter table public.cirurgia_medicamentos
  add column if not exists confiabilidade text;

alter table public.cirurgia_medicamentos
  add column if not exists auditado boolean not null default false;

comment on column public.cirurgia_medicamentos.nome_digitado_original is
  'O que a pessoa realmente digitou, quando a IA corrigiu um erro de digitação no nome (ver correcao_automatica). nome_informado já fica com o nome corrigido. Null quando não houve correção.';

comment on column public.cirurgia_medicamentos.correcao_automatica is
  'true quando a IA corrigiu sozinha um erro de digitação no nome informado (ex.: "Coondroflex" -> "Condroflex") — ver nome_digitado_original para o que foi digitado originalmente.';

comment on column public.cirurgia_medicamentos.correcao_detalhe is
  'Explicação da IA sobre a correção de nome (ou sobre por que não reconheceu o nome, quando não encontrou o remédio) — a IA nunca corrige nem descarta um nome calada, sempre explica aqui.';

comment on column public.cirurgia_medicamentos.motivo_suspensao is
  'O PORQUÊ da suspensão (ou da não-suspensão), em linguagem simples, pesquisado agora pela IA — é o campo que a equipe confere antes de aprovar ("auditoria", nome dado pelo Jorge). Diferente de clinical_notes (versão técnica/interna, já existente) e de explicacao_paciente (texto que vai para o paciente).';

comment on column public.cirurgia_medicamentos.fontes_consultadas is
  'Array JSON [{"titulo": "...", "url": "..."}] das fontes que a IA realmente abriu numa busca ao vivo para responder esta pesquisa. Vazio quando não houve busca ou nenhuma fonte confiável foi encontrada.';

comment on column public.cirurgia_medicamentos.confiabilidade is
  '"alta" | "media" | "baixa" — quão confiável a própria IA considera a fonte que achou agora para este medicamento. "baixa" deve ser conferido com atenção redobrada antes de aprovar.';

comment on column public.cirurgia_medicamentos.auditado is
  'true somente quando pelo menos uma URL em fontes_consultadas veio de uma busca ao vivo feita agora (não do conhecimento treinado da IA). Quando false, o resultado não deve ser tratado como conferido na internet.';

-- ===========================================================================
-- cirurgia_medicamentos_clinica (base própria da clínica, reaproveitada entre
-- cirurgias — ver 20260924_base_clinica_medicamentos_v48_101.sql)
-- ===========================================================================
alter table public.cirurgia_medicamentos_clinica
  add column if not exists motivo_suspensao text;

alter table public.cirurgia_medicamentos_clinica
  add column if not exists fontes_consultadas jsonb not null default '[]'::jsonb;

alter table public.cirurgia_medicamentos_clinica
  add column if not exists confiabilidade text;

alter table public.cirurgia_medicamentos_clinica
  add column if not exists auditado boolean not null default false;

comment on column public.cirurgia_medicamentos_clinica.motivo_suspensao is
  'O PORQUÊ da suspensão (ou da não-suspensão), em linguagem simples — mesmo campo e mesmo sentido de cirurgia_medicamentos.motivo_suspensao, guardado aqui para reaproveitar em outras cirurgias sem pesquisar de novo.';

comment on column public.cirurgia_medicamentos_clinica.fontes_consultadas is
  'Array JSON [{"titulo": "...", "url": "..."}] das fontes consultadas numa busca ao vivo quando este registro foi pesquisado por IA (fonte=''ia''). Vazio para registros importados ou manuais.';

comment on column public.cirurgia_medicamentos_clinica.confiabilidade is
  '"alta" | "media" | "baixa" — ver cirurgia_medicamentos.confiabilidade.';

comment on column public.cirurgia_medicamentos_clinica.auditado is
  'true somente quando a pesquisa por IA que gerou este registro fez uma busca ao vivo real (ver cirurgia_medicamentos.auditado).';

notify pgrst, 'reload schema';
