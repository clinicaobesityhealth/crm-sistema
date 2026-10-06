-- v48.137 — Apagar mensagem já enviada (pedido do Jorge): "poder deletar uma
-- msg enviada — se passou do prazo do WhatsApp, avisar que não pode; se
-- puder, deletar do WhatsApp do paciente e deixar cinza claro (tachado, mas
-- ainda legível) no CRM — nunca sumir daqui".
--
-- Pode rodar mais de uma vez.
--
-- Junto: a mensagem "CRM - Apagar Mensagem WhatsApp" no n8n (mesmo padrão da
-- "CRM - Editar Mensagem WhatsApp"), que chama a API do WAHA
-- (DELETE /api/{session}/chats/{chat}/messages/{id}) e devolve sucesso/erro —
-- o WhatsApp mesmo recusa quando passou a janela permitida, e o app relata
-- isso ao usuário em vez de fingir que apagou.

alter table public.messages
  add column if not exists apagado_em timestamptz,
  add column if not exists apagado_por uuid references public.agents(id);

comment on column public.messages.apagado_em is 'Quando a mensagem foi apagada do WhatsApp do paciente pelo CRM. A linha nunca é excluída — fica marcada e some só do lado do paciente.';
comment on column public.messages.apagado_por is 'Quem apagou (agents.id), quando apagado pela equipe.';

notify pgrst, 'reload schema';
