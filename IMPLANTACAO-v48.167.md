# CRM Obesity v48.167 — nome do paciente sempre atualizado (Agenda Médica + Agenda Cirúrgica)

## O problema

A Agenda Médica e a Agenda Cirúrgica guardam uma **cópia** do nome do
paciente, feita no momento em que a consulta/cirurgia foi criada ou
vinculada ao cadastro. Corrigir o cadastro depois (foi o caso da Bruna:
"Bruna Polidoro" → "Bruna Puggina") não atualizava essa cópia — a tela
continuava mostrando o nome antigo mesmo com o cadastro já certo.

## A correção

Agora, sempre que a consulta ou a cirurgia já está vinculada a um cadastro
(`contact_id` preenchido), a tela busca o nome **atual** do cadastro e usa
esse — a cópia antiga só aparece quando não há vínculo nenhum. Vale pra:

- Agenda Médica: grade do dia, da semana, do mês, e as listas de
  Realizadas/Canceladas.
- Agenda Cirúrgica: lista de cirurgias.

Não muda nada no banco de dados — é só na hora de exibir, então não tem
risco de sobrescrever algo digitado à mão num registro sem paciente
vinculado.

## Sobre o SQL da Bruna

Se você já rodou o `update agendamentos set paciente_nome = ...` que te
passei, ótimo — não tem problema nenhum ter rodado, fica tudo consistente
dos dois jeitos agora. Se não rodou ainda, não precisa mais: a partir desta
versão a tela já mostra o nome certo sozinha (contanto que o agendamento da
Bruna esteja vinculado ao cadastro dela — o que parece já ser o caso, já que
você mudou pelo cadastro).

## Também incluído

Esta versão já inclui tudo da v48.166 (Descrição do MedX / retorno manual /
emoji no cadastro do paciente) — é só subir esta, não precisa das duas.

## Implantação

Suba o zip no EasyPanel como sempre. Sem SQL novo nem alteração de n8n nesta
versão (os 2 ajustes no n8n e o SQL da v48.166 continuam valendo, se ainda
não tiver feito).
