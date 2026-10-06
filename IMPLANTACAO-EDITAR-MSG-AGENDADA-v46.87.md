# Implantação — editar mensagem agendada v46.87

## O que foi acrescentado

- Na aba **"Mensagens agendadas"** do painel do paciente (mesmo lugar onde já dava pra Cancelar/Apagar), cada mensagem ainda ativa agora tem um botão **"Editar"**.
- Clicando em Editar, aparecem os campos de **data** e **hora** do envio (mesmo padrão já usado no "Agendar mensagem" do Inbox) junto com o texto, todos editáveis ali mesmo, com **Salvar** e **Descartar**. Salvar grava o novo texto e/ou a nova data/hora direto na mensagem agendada (`scheduled_messages.content` e `scheduled_for`) — útil pra ajustar manualmente um lembrete específico (como fizemos hoje pra incluir o link de confirmação no teste do João Jorge, ou pra adiar o disparo) sem precisar mexer no banco.

## Correção incluída (bug pequeno, já existia)

- O botão **"Cancelar"** dessa mesma aba só aparecia para mensagens com status `pending` — mas o lembrete automático de confirmação de consulta usa status `scheduled`, então na prática o botão nunca aparecia pra ele. Corrigi pra usar a mesma regra que já era usada pro rótulo "Agendado" (qualquer status que não seja enviado/falhou/cancelado/substituído). O botão **Editar** novo usa essa mesma regra. Nada mudou no processamento/envio automático das mensagens — só essa condição de exibição dos botões na tela.

## O que foi preservado

- Nenhuma mudança em como as mensagens são criadas, enviadas ou nos gatilhos do banco.
- Apagar (individual ou "apagar tudo") continua exatamente igual.

## Arquivos alterados

- `components/ConversationSidePanel.tsx` (componente `ScheduledTab`).

## Ordem segura de implantação

1. Suba o ZIP `crmobesity_deploy_v46.87_EDITAR_MSG_AGENDADA.zip` no EasyPanel — já contém tudo do v46.86 (link de confirmação + correção do redirecionamento pro login) mais essa novidade.
2. Teste: abra o painel de um paciente com mensagem agendada → aba "Mensagens agendadas" → Editar → altere o texto e/ou a data/hora → Salvar → recarregue a aba e confira que o novo texto e o novo horário persistiram.
3. Confira que "Cancelar" agora aparece também nos lembretes automáticos de confirmação de consulta (status `scheduled`), não só nos manuais antigos (`pending`).
