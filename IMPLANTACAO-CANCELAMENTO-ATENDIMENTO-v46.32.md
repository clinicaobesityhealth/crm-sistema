# Cancelamento pela tela de atendimento — v46.32

- Remove a dependência de existir uma linha prévia na tabela `agendamentos` do CRM.
- Cancela diretamente no MedX pelo flow `tool-cancelar-agendamento`.
- Envia o ID MedX quando disponível e mantém como alternativa a identificação por
  profissional, data, hora, nome, telefone e CPF.
- Depois do sucesso real, libera o slot correspondente e atualiza novamente a aba MedX.
- Mantém todas as melhorias existentes na v46.31, inclusive modalidade e cobrança.
