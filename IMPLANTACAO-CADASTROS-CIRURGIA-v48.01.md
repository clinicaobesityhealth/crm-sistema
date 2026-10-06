# v48.01 — Cadastros da agenda de cirurgias

Primeira etapa do módulo de cirurgias. Aqui o CRM ganha os dados que hoje moram
nas abas **DADOS** e **DADOS CARTAS** da planilha *CIRURGIAS OBESITY*. A planilha
continua funcionando normalmente — nada nela é alterado.

## Ordem de implantação

**1. Rode o SQL primeiro.** No Supabase → SQL Editor, cole e execute:

    supabase/migrations/20260914_cadastros_cirurgia_v48_01.sql

Ele só cria tabelas novas. Pode ser rodado mais de uma vez sem duplicar nada e
sem desfazer edições feitas pela tela — já testei isso rodando duas vezes seguidas.

**2. Depois suba o zip** no EasyPanel, como de costume.

## O que aparece no CRM

**Configurações → Cirurgias**, com seis abas:

- **Cirurgias** — as 18 da aba DADOS CARTAS, já carregadas
- **Equipe** — os 6 nomes da aba DADOS, com CRM/CPF e função
- **Hospitais** — os 7 hospitais
- **Situações** — as 21 situações da coluna L
- **Modalidades** — Particular total / Particular com convênio
- **Formas de pagamento** — Dinheiro, Pix, Safra, Rede, Ton, Link Safra

## Três decisões que vale conferir

**TUSS e CID saíram do nome.** Na planilha eles vivem dentro do texto
("HERNIORRAFIA UMBILICAL (TUSS 31009166)"). Aqui cada código é uma linha
própria, porque uma cirurgia pode ter mais de um: o cisto sacro-coccígeo tem
dois TUSS, as hemorroidas têm três, a hérnia ventral por vídeo tem dois. A guia
do convênio pede o número isolado, não o nome com o número no meio.

**O sino nas Situações.** A situação marcada com o sino é a que dispara as
mensagens de pré e pós-operatório. Veio marcada em **AUTORIZADA**, que é o que
o script da planilha faz hoje. Só uma pode estar marcada — marcar outra
desmarca a anterior, senão o paciente receberia a mensagem duas vezes.

**Realizada e cancelada viraram categoria, não aba.** Na planilha a linha é
*movida* para outra aba quando a cirurgia é realizada ou cancelada. No CRM ela
fica no lugar e muda de categoria. Nada se perde no caminho, e o histórico
continua junto do paciente.

## Uma correção que fiz e você precisa validar

Na aba DADOS CARTAS, a linha **HIDr** está com o nome
*"HERINORRAFIA INGUINAL ESQUERDA - ROBÓTICA"* — igual à linha HIEr logo acima.
Pela abreviação, deveria ser **direita**. Cadastrei como *Herniorrafia Inguinal
Direita - Robótica*. Se eu entendi errado, é só editar na tela.

Também padronizei alguns CIDs que estavam sem o ponto (K409 → K40.9,
k429 → K42.9) e tirei as duplicações de digitação dos nomes. Os valores não
foram tocados: estão exatamente como na planilha.

## O que ainda não existe

Esta versão é só o cadastro. Ainda não dá para lançar uma cirurgia — isso é a
próxima etapa, junto com a lista/agenda. As mensagens automáticas e as cartas
continuam saindo da planilha até lá.
