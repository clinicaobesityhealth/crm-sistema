-- =====================================================================
-- v47.01 — Corrige o "check azul" (status de leitura) do WhatsApp
-- =====================================================================
--
-- PROBLEMA
-- Ao migrar o envio da Evolution API para o WAHA, o formato do ID da
-- mensagem mudou:
--
--   Evolution  ->  "3EB08F9B4A31AB0B599BAE"                       (só o hash)
--   WAHA       ->  "true_5511999999999@c.us_3EB08F9B4A31AB0B599BAE"
--   WAHA (novo)->  "true_81866522669304@lid_3EB08F9B4A31AB0B599BAE"
--
-- O CRM grava em messages.external_id o ID que o WAHA devolve no envio,
-- mas os avisos de "entregue"/"lida" chegam com o ID em outro formato
-- (inclusive com @lid, o novo identificador anonimo do WhatsApp).
-- Como bump_message_status compara o external_id inteiro, ele nunca
-- encontra a mensagem: a chamada responde 200, atualiza 0 linhas, e o
-- check nunca fica azul.
--
-- SOLUCAO
-- O hash final da mensagem (o trecho depois do ultimo "_") e o mesmo em
-- todos os formatos. Esta funcao localiza a mensagem por esse hash e
-- delega para a bump_message_status ja existente — que continua sendo a
-- unica dona da regra de "status nunca retrocede".
--
-- Nada e alterado na bump_message_status nem nos dados ja gravados.
-- =====================================================================

create or replace function public.bump_message_status_by_hash(
  p_external_id text,
  p_new_status  text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash    text;
  v_match   text;
  v_count   int := 0;
begin
  if p_external_id is null or btrim(p_external_id) = '' then
    return 0;
  end if;

  -- Hash estavel: ultimo trecho apos "_" (se nao houver "_", e o proprio ID).
  v_hash := split_part(
    p_external_id,
    '_',
    array_length(string_to_array(p_external_id, '_'), 1)
  );

  if v_hash is null or btrim(v_hash) = '' then
    return 0;
  end if;

  -- Encontra o external_id realmente gravado, seja qual for o formato,
  -- e aplica a regra oficial de status via bump_message_status.
  for v_match in
    select distinct m.external_id
      from public.messages m
     where m.external_id is not null
       and (
             m.external_id = p_external_id   -- formato identico
          or m.external_id = v_hash          -- gravado so com o hash (Evolution)
          or m.external_id like '%\_' || v_hash escape '\'  -- composto (WAHA)
       )
  loop
    perform public.bump_message_status(v_match, p_new_status);
    v_count := v_count + 1;
  end loop;

  return v_count;   -- quantas mensagens casaram (0 = nao achou)
end;
$$;

comment on function public.bump_message_status_by_hash(text, text) is
  'Atualiza o status de leitura localizando a mensagem pelo hash final do ID '
  '(invariante entre os formatos @c.us / @lid / Evolution). Delega a regra de '
  'nao-retrocesso para bump_message_status. Retorna quantas mensagens casaram.';

grant execute on function public.bump_message_status_by_hash(text, text) to service_role;
