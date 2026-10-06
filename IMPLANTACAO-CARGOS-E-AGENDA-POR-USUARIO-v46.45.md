# CRM Obesity v46.45 — cadastro de Cargos + Agenda Médica por usuário

## 1) Cargos (Configurações → Cargos), nova tela

Problema: o campo "Função / Cargo" no cadastro de atendente (Configurações →
Atendentes) e no perfil (editar meus dados) era texto livre — já existiam
"Médico" e "Médico(a)" cadastrados como cargos diferentes na base real, o
que quebra qualquer verificação por cargo (ex: a regra do link de avaliação
do Google, que só pergunta pra quem tem cargo "Secretária/Secretário").

Criada tabela `public.job_titles` (sem RLS, mesmo padrão de `sectors` e
`agents`) e a tela **Configurações → Cargos**, clone do padrão já usado em
"Setores": lista, criar, editar, apagar. Semeada com os 3 valores que já
existiam nos dados reais (Médico, Médico(a), Secretária) + mais alguns
comuns (Secretário, Nutricionista, Administrador(a), Recepção) pra já sair
funcional.

O campo "Função / Cargo" virou `<select>` (lista fixa) tanto em
Configurações → Atendentes quanto no modal de editar meu perfil. Se um
atendente já tiver um cargo salvo que não está mais na lista, ele continua
aparecendo selecionado (com aviso "não está mais na lista") pra não perder
o dado — só não dá pra escolher esse valor de novo do zero.

**Não há FK entre `agents.job_title` e `job_titles.name`** — de propósito,
pra não arriscar quebrar nada que já existe. A tela só oferece os valores
cadastrados como opção; o campo em si continua texto livre no banco.

## 2) Agenda Médica: usuário comum vê só a própria agenda

Vínculo por e-mail: nova coluna `professionals.email` (nullable — migration
`20260805_professional_login_email_v46_43.sql`). Se o e-mail de login do
profissional (cadastrado em Configurações → Config. Agenda, campo novo
"E-mail de login") bater com o e-mail do agente logado, e esse agente **não**
for admin nem tiver cargo de secretária, a Agenda Médica mostra só a agenda
dele — some a aba "Todos" e as abas dos outros médicos, e a data trava
automaticamente no profissional dele.

Regras:
- **Admin**: sempre vê tudo, como antes.
- **Cargo Secretária/Secretário** (mesma checagem já usada pro link de
  avaliação do Google, `isSecretaryJobTitle`): sempre vê tudo.
- **Usuário comum com e-mail vinculado a um profissional**: vê só a própria
  agenda.
- **Usuário comum sem vínculo cadastrado ainda**: continua vendo tudo (não
  quebra ninguém — só passa a filtrar depois que o Jorge preencher o e-mail
  do profissional em Config. Agenda).

Nenhuma mudança de permissão em nenhum outro lugar do sistema (Inbox,
Contatos etc.) — só na tela Agenda Médica.

Sem alteração de flow n8n nesta versão.
