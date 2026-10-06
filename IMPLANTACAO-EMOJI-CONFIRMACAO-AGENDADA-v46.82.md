# Emoji de agenda (📅) nos cards de consulta — v46.82

Pedido do Jorge: mostrar um indicador visual quando a mensagem automática
(confirmação de consulta ou retorno) já está agendada para aquele paciente,
direto no card, sem precisar abrir a aba "Agendadas" pra conferir.

## O que mudou

Arquivo: `components/ConversationSidePanel.tsx` (aba MedX do paciente).

Adicionado um 📅 ao lado da data, em três lugares:

1. **Card "Próximo agendamento"** (consulta em destaque) — acende quando já
   existe uma confirmação automática agendada pra aquele agendamento
   específico (`scheduled_messages.reminder_type = 'confirmar_consulta'`,
   status `scheduled`/`pending`, casando por `medx_agendamento_id`). Essa
   confirmação é criada automaticamente pelo trigger do banco (v46.49) toda
   vez que um agendamento novo ou atualizado tem data futura — é exatamente o
   caso do Jesse: assim que a consulta dele é criada/sincronizada, o gatilho já
   agenda a confirmação, e agora isso aparece no card.

2. **"Outros" agendamentos** (demais consultas futuras da mesma lista) — mesmo
   indicador, mesma lógica, por consistência.

3. **Card "Última consulta"** — acende quando já existe uma mensagem de
   retorno agendada pra esse paciente (`scheduled_messages.origin =
   'retorno_followup'`, criada pelo botão "📅 Agendar msg de retorno"). Essa
   mensagem não é vinculada a um agendamento específico (é por paciente), por
   isso o indicador aqui é por contato, não por consulta.

## Como funciona

Nova função `carregarIndicadoresAgendados()`, chamada num `useEffect`
independente (roda em paralelo à busca no MedX, não depende dela). Faz uma
única consulta em `scheduled_messages` filtrada por `contact_id` e
`status in ('scheduled','pending')`, e separa localmente em:

- `confirmacoesAgendadasIds`: `Set` com os `medx_agendamento_id` /
  `agendamento_id` que já têm confirmação ativa.
- `retornoJaAgendado`: `boolean` — true se existe qualquer msg de retorno
  ativa pra esse contato.

Depois de salvar uma nova "msg de retorno" pelo modal, `retornoJaAgendado` é
setado pra `true` na hora (sem esperar reload), pra feedback imediato.

## Sem mudança de banco

Não precisou de migração nova — só leitura da tabela `scheduled_messages`
que já existe desde a v46.49. Testado com `npx tsc --noEmit` (zero erros
novos) e `npm run build` (build de produção completo, sem erros).
