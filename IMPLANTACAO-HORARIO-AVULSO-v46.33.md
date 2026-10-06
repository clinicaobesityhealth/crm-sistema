# CRM Obesity v46.33 — horário avulso

## Alteração

- Atendimento > MedX > Agendar nova consulta: campo `Horário avulso` após os slots configurados.
- Agenda Médica > visão Dia: campo `Horário avulso` ao selecionar um profissional.
- O horário final é calculado pela duração configurada para o profissional.
- A requisição ao webhook `crm-agendar-consulta` recebe `horario_avulso: true` e um `slot_id` iniciado por `avulso_`.
- Nenhum novo slot disponível é criado no Supabase; por isso o horário digitado não entra na lista consultada pela Sofia.

## Implantação

Substitua o CRM atual pelo conteúdo deste ZIP e faça o redeploy. Não há migração SQL nesta versão.

O webhook existente continua sendo usado e recebe os mesmos dados de data, início, fim, profissional e paciente. O novo campo apenas identifica a origem manual.
