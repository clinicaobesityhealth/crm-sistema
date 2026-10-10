# CRM Obesity v48.177 — Aviso de WhatsApp: inclui secretária + aviso de Inbox

## 1. O aviso de "paciente aguardando" agora vale pra secretária também

Você perguntou: o aviso que manda uma mensagem pro WhatsApp pessoal do
atendente (quando um paciente já em atendimento com ele manda mensagem
estando ele offline, ou é transferido pra ele) — vale pra todo mundo?

**Não valia.** Desde que esse aviso foi criado (v48.158), ele nasceu
**desligado por padrão pra secretária/recepção** — só médico, cirurgião,
nutricionista etc. recebiam. Agora liguei pra secretária/recepção também.

Se quiser ligar ou desligar esse aviso pra um cargo específico depois, tem um
selo novo em **Configurações → Cargos** — "avisa atendimento" (sino laranja).

## 2. Novo: aviso quando um paciente cai no Inbox

Pedido seu: se um paciente chega no **Inbox** (mensagem nova, ainda sem
atendente) e **nenhuma secretária está com o CRM aberto**, avisa no WhatsApp
pessoal dela(s):

- Se a **Sofia está atendendo** essa conversa normalmente: "👋 *Fulano*
  chegou no Inbox do CRM. A Sofia está atendendo."
- Se a **Sofia está pausada** nessa conversa (ninguém respondendo
  automaticamente): a mesma mensagem que o médico recebe hoje — "💬 O(a)
  Sr(a). *Fulano* enviou uma mensagem... e aguarda atendimento."

Esse aviso vai pra **todas** as secretárias cadastradas com telefone pessoal
(WhatsApp) salvo no perfil — assim quem estiver por perto pode assumir. Se
uma mensagem nova chegar do mesmo paciente enquanto ele ainda espera, não
repete o aviso antes de 20 minutos (pra não lotar o celular de ninguém).

Quem recebe esse aviso específico também é por cargo — selo novo "avisa
inbox" (sino azul) em Configurações → Cargos, já ligado pra secretária/
recepção.

## Passo necessário no Supabase (1x, 1 minuto)

Abra o **SQL Editor** do Supabase e rode o arquivo
`supabase/migrations/20261010_aviso_inbox_secretaria_v48_177.sql` (cole o
conteúdo dele lá).

Não precisa mexer em nada no n8n — o fluxo que já manda essas mensagens
continua o mesmo, só passou a entender os dois avisos novos.

## Implantação

Suba esta versão como sempre (GitHub → EasyPanel implanta sozinho). Depois
rode o SQL acima no Supabase.
