# CRM Obesity v46.35

## Correções no atendimento

- Cancelamento passa a usar o mesmo webhook da Agenda Médica (`crm-cancelar-consulta`).
- Antes de cancelar, o CRM localiza o registro ativo e envia seu `agendamento_id` real.
- O menu de três pontos ganhou o atalho `Agendar consulta`, abrindo diretamente MedX > agendamento.
- O acesso original pela aba MedX continua disponível.
- Clicar em um slot agora apenas seleciona o horário.
- `Usar horário` apenas seleciona o horário avulso.
- O envio ao MedX acontece somente após clicar no novo botão `Agendar`.

Esta versão inclui também as correções e a migração da v46.34.
