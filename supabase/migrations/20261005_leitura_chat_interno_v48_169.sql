-- v48.169 — Jorge: no chat interno da equipe (atendente → atendente) não dá
-- para saber se quem recebeu já leu a mensagem — pedido: um aviso de
-- recebimento/leitura, como o duplo check do WhatsApp.
--
-- A tabela internal_messages já tem a coluna "read" (true/false), usada para
-- a contagem de não lidas — só faltava QUANDO a pessoa leu, para mostrar na
-- tela ("lido às 14:32"). Esta migração só adiciona essa coluna; quem marca
-- com a hora é o código (components/InternalChat.tsx, v48.169).
--
-- Pode rodar de novo sem problema.

alter table public.internal_messages
  add column if not exists read_at timestamptz;

notify pgrst, 'reload schema';
