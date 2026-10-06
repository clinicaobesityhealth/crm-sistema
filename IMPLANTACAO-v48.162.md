# CRM Obesity v48.162 — retorno/cobrança na Agenda Médica

## O que mudou

A Agenda Médica (grade do dia + modal ao clicar num horário) agora mostra,
para cada consulta ocupada, a mesma informação que já aparecia na aba MedX
do contato:

- **Com retorno / Sem retorno**
- **COBRAR / NÃO COBRAR**

Exemplo: a Dra. Bruna, presencial e sem retorno, agora aparece na grade com
"PRESENCIAL" + "Sem retorno" (e, se for o caso, "· não cobrar" — "cobrar" é o
caso comum e não é destacado, pra não poluir o card). No modal de detalhe,
embaixo do seletor de modalidade, aparecem dois selinhos: "Sem retorno" e
"COBRAR"/"NÃO COBRAR".

## Como foi feito

Esse dado só existe no MedX — a tabela `agendamentos` do CRM não guarda
retorno/cobrança (só guarda `modalidade`, que é outro campo, preenchido à
mão na própria tela). Em vez de duplicar a lógica de busca/parse que já
existia na aba MedX do contato (`ConversationSidePanel.tsx`), ela foi
extraída para um arquivo novo, `lib/medxAgendamentos.ts`, e agora as duas
telas chamam a mesma função — o comportamento da aba MedX não mudou em nada,
só passou a vir de um lugar compartilhado.

A Agenda Médica busca essa informação ao vivo no MedX (por nome/telefone do
paciente) ao carregar o dia, agrupando por paciente pra não repetir a busca
quando a pessoa tem mais de uma consulta no mesmo dia, e com um cache de 2
minutos pra não repetir a mesma busca em rajada ao navegar entre telas. A
grade aparece na hora com o que já tinha (horário, paciente, confirmação);
os selos de retorno/cobrança completam em seguida, conforme a busca no MedX
responde.

**Por ora, isso está ligado só na visão "Dia"** (a tela que foi usada nos
exemplos) — grade e modal. As visões Semana/Mês continuam como estavam.

## Implantação

Suba o zip no EasyPanel como sempre. Não há SQL nem alteração de flow n8n
nesta versão.
