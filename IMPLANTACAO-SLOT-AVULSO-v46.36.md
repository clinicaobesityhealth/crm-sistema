# CRM Obesity v46.36 — slot de horário avulso

- Ao confirmar um horário avulso, o CRM cria primeiro o registro correspondente em `agenda_slots`.
- Em seguida, o agendamento usa o mesmo webhook e o mesmo fluxo dos slots configurados.
- Se o horário já estiver ocupado, o CRM impede a tentativa e solicita outro horário.
- Se o MedX ou o fluxo de agendamento falhar, o slot avulso temporário é removido.
- Em caso de sucesso, o slot permanece ocupado e aparece corretamente na Agenda Médica.
- A correção vale tanto para o agendamento pelo atendimento quanto pela Agenda Médica.

Não há uma nova migração SQL nesta versão. A migração da v46.34 continua incluída para quem ainda não a executou.
