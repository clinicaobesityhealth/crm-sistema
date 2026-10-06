-- v48.64 — Texto da mensagem que vai ao paciente junto da descrição cirúrgica.
--
-- Rode depois da 20260922_agenda_google_e_rgo_v48_59.sql. Pode rodar de novo
-- sem problema.
--
-- Por que numa coluna e não no programa: é texto que a clínica vai querer
-- ajustar (tom, assinatura, instrução de reembolso), e mudar texto não pode
-- depender de subir uma versão nova do sistema.
--
-- Campos que o sistema troca na hora de enviar:
--   {saudacao}      Prezado(a) Sr(a). João,
--   {primeiro_nome} João
--   {paciente}      João de Barros
--   {cirurgia}      nome do procedimento
--   {data}          data da cirurgia (dd/mm/aaaa)

alter table public.clinic_settings
  add column if not exists rgo_mensagem text;

-- Quando o cirurgião deu o envio por encerrado no link.
--
-- Enquanto está vazio, ele ainda pode olhar a foto que tirou e apagar a que
-- saiu tremida. Depois de concluído o arquivo é registro da clínica: some o
-- botão de apagar do link, e só pelo CRM se remove.
alter table public.cirurgias
  add column if not exists rgo_concluida_em timestamptz;

-- Anotações que o cirurgião escreve no próprio link, junto da foto da RGO
-- (intercorrência, achado, o que for). Fica separado de cirurgias.observacao,
-- que é a observação do pré-operatório e vai para o evento da agenda — uma
-- coisa não pode apagar a outra.
alter table public.cirurgias
  add column if not exists rgo_observacoes text;

update public.clinic_settings
set rgo_mensagem = '{saudacao}

Segue a descrição cirúrgica ({cirurgia}) para a solicitação de reembolso junto ao seu convênio.

Qualquer dúvida, estamos à disposição.'
where rgo_mensagem is null or btrim(rgo_mensagem) = '';
