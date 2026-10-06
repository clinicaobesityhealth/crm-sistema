# CRM Obesity v48.165 — correção: sugestão de modalidade errada (Rodrigo apareceu online, sendo presencial)

## O problema

Na v48.164, quando ninguém marcava manualmente "Presencial"/"Online", o CRM
passou a sugerir a modalidade usando o que o MedX manda no agendamento. Só
que, além de reconhecer a palavra "presencial"/"online" no texto (confiável),
esse código também tentava adivinhar a partir de um campo numérico que o
MedX às vezes manda (um "1" virava ONLINE, um "0" virava PRESENCIAL) — e,
quando nada disso aparecia, assumia PRESENCIAL por padrão.

O caso do Rodrigo (05/10) mostrou que esse número nem sempre quer dizer
online/presencial — pode ser outro código (tipo de consulta, sala etc.) — e
o resultado saiu errado: o MedX e a agenda por WhatsApp diziam presencial,
mas o CRM mostrou online.

## A correção

Tirado o palpite pelo número e o "assume presencial por padrão". Agora a
sugestão só aparece quando o MedX diz a palavra "presencial" ou "online" de
forma explícita (no campo de modalidade ou na descrição da consulta). Sem
isso, o CRM não mostra nada — exatamente como já era antes da v48.164 — em
vez de arriscar mostrar errado.

Ou seja: quando o MedX for claro, a sugestão aparece certa (como já
funcionou para a Bruna, que está correta). Quando o MedX não for claro, a
equipe marca manualmente como sempre fez, em vez de confiar numa sugestão
arriscada.

Isso também corrige o mesmo tipo de palpite na aba "MedX" do cadastro do
paciente (o selinho de modalidade ao lado de cada consulta), que usava a
mesma lógica.

## Implantação

Suba o zip no EasyPanel como sempre. Não há SQL nem alteração de flow n8n
nesta versão. Vale conferir o agendamento do Rodrigo depois de implantar —
deve voltar a aparecer sem modalidade sugerida (já que o MedX, pelo visto,
não está mandando o texto explícito "presencial" para essa consulta) ou,
se o MedX passar a mandar esse texto, já aparecerá certo.
