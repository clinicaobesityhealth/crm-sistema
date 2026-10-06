# CRM Obesity v48.171 — "Deseja avisar o paciente?" só para quem mudou a situação

## O problema

Quando alguém muda a situação de uma cirurgia (ex.: Daniella marca "Cirurgia
autorizada pelo convênio"), a janela "Deseja avisar o paciente?" aparecia
para ela — certo — e **também para qualquer outro atendente logado na
hora**, incluindo você. Devia aparecer só para quem fez a mudança.

## Por que acontecia

O aviso nasce de um gatilho no banco, sem saber qual tela/pessoa mudou a
situação — e a tela que mostra a janela busca todos os avisos pendentes
para todo mundo, de propósito: assim nada se perde mesmo que ninguém
estivesse olhando na hora (por exemplo, uma mudança feita por sincronização
automática).

## A correção

O gatilho agora grava **quem** mudou a situação, e a janela só aparece para
essa pessoa. Para não perder nada:

- Se a mudança veio de algo sem um usuário logado por trás (ex.: uma
  sincronização automática via chave de serviço), continua aparecendo para
  todo mundo, como sempre.
- Se a pessoa que mudou não decidir em até **2 horas**, a janela passa a
  aparecer para qualquer um — rede de segurança, caso ela saia sem decidir
  ou esqueça.

Os outros avisos (paciente parado no pré-operatório, medicamentos
pendentes) **não mudaram** — continuam aparecendo para todo mundo, como já
era.

## Implantação

1. Rode o SQL (Supabase → SQL Editor):
   `supabase/migrations/20261005_aviso_cirurgia_por_agente_v48_171.sql`
2. Suba o zip no EasyPanel como sempre.
