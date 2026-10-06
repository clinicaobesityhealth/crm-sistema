# CRM Obesity v46.40 — contatos bloqueados

## Recursos

- Nova opção **Bloquear contato** no menu de três pontos do atendimento.
- Confirmação obrigatória antes de aplicar o bloqueio.
- O contato é retirado das filas e o atendimento é fechado.
- A Sofia fica bloqueada para esse contato.
- Integrações não conseguem reabrir automaticamente o atendimento enquanto o bloqueio estiver ativo.
- Mensagens externas enfileiradas, inclusive automações, não são enviadas ao contato bloqueado.
- Nova tela **Configurações > Contatos bloqueados**, com busca e desbloqueio mediante confirmação.
- O histórico existente é preservado.

## Implantação

1. Execute `supabase/migrations/20260803_blocked_contacts_v46_40.sql` no Supabase.
2. Suba o ZIP v46.40 no Easypanel.
3. Não é necessário alterar o n8n: a proteção do banco mantém o contato fechado e a flag individual já utilizada pelo fluxo impede a Sofia de responder.

## Desbloqueio

Ao desbloquear, o contato permanece fechado até enviar uma nova mensagem ou até um usuário iniciar um novo atendimento. A preferência anterior de bloqueio permanente da Sofia é restaurada.
