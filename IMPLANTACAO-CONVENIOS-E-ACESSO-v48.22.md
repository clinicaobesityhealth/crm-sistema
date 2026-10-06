# v48.22 — Convênios, preços por convênio, acesso por cargo e botão de sincronizar

**1.** Rode `20260915_convenios_v48_22.sql` no Supabase.
**2.** Suba o zip.
**3.** Reimporte o fluxo do n8n (ganhou um gatilho novo).

## 1. Convênios, planos e tabela de preços

Em **Configurações → Cad. Cirurgias → Convênios**. Cada convênio tem planos e
uma tabela de preços própria.

O preço é procurado do mais específico para o mais geral, e para no primeiro
que encontra:

1. preço daquele procedimento **naquele convênio e naquele plano**
2. preço daquele procedimento **naquele convênio** (qualquer plano)
3. **preço particular** — o que já está no cadastro da cirurgia

É essa ordem que deixa cadastrar pouco: você põe o preço do convênio inteiro e
só depois a exceção de um plano. Sem ela, seria preciso repetir o mesmo valor
em cada plano.

**Campo em branco significa "não tem preço próprio"** — cai para o de cima. É
diferente de zero: zero é um preço, e cobraria nada do paciente.

A grade de preços mostra todas as cirurgias de uma vez, com o valor particular
ao lado de cada uma para comparar, e um salvar só.

**Na tela da cirurgia**, o resumo de valores agora diz de onde o número veio:
*"Valores da tabela do convênio"*, *"da tabela do plano"* ou *"da tabela
particular"*. Um preço de convênio e um particular são indistinguíveis olhando
só o número, e a diferença costuma ser grande.

Se você escolher um convênio que ainda não tem preço para aquela cirurgia, ele
avisa: *"tabela particular (sem preço cadastrado para este convênio)"*.

## 2. Convênio do paciente

No **cadastro do paciente**: convênio, plano, número da carteirinha, **nome
como está na carteirinha** e **validade**.

O nome separado não é capricho — nome de solteira, nome social, titular
diferente do paciente. O convênio recusa a guia quando diverge.

Na cirurgia os mesmos campos aparecem e ficam **congelados naquele registro**:
o paciente pode trocar de convênio depois, e a guia daquela cirurgia não muda
por isso.

Se a validade da carteirinha for anterior à data da cirurgia, a tela avisa em
vermelho na hora.

## 3. Quem enxerga a agenda cirúrgica

Nutricionista, psicólogo e clínico não veem mais — some do menu **e** a tela
recusa, porque esconder um item não impede ninguém de digitar o endereço.

Fica por **cargo**, em Configurações → Cargos: cada um tem uma marca ao lado
dizendo se enxerga. Administrador enxerga sempre.

Já deixei ligado para os cargos administrativos, de secretaria e recepção.
**Médico(a) ficou desligado de propósito** — esse cargo não distingue cirurgião
de clínico. Ligue nele, ou crie um cargo "Cirurgião(ã)" e mova os três para lá.

## 4. Hospital e situação podem ser criados na hora

No lançamento da cirurgia, ao lado de Hospital e de Situação há um **+**.
Aparece um hospital novo, você cadastra ali mesmo e ele entra na lista — sem
sair da tela e sem perder o que já preencheu.

Se o nome já existir com outro acento ou outra caixa, ele escolhe o que existe
em vez de criar um irmão gêmeo. É assim que uma lista vira "BLANC", "Blanc" e
"blanc".

## 5. Botão "Atualizar planilha"

No alto da tela de Cirurgias, ao lado de Nova cirurgia. Sincroniza na hora, sem
esperar a rodada de 15 minutos, e mostra o resultado: quantas vieram da
planilha, quantas linhas seriam atualizadas, e se a escrita ainda está
desligada.

O botão chama o CRM, e é o **servidor** do CRM que chama o n8n. Se o navegador
chamasse direto, a chave de sincronização precisaria estar no código que roda
na máquina do usuário — à vista de qualquer um.

Por isso o fluxo do n8n ganhou um gatilho novo, **Botao do CRM**, protegido pela
mesma credencial Header Auth que você já criou. Reimporte o fluxo e confirme
que esse nó está com a credencial **CRM Sync Token** selecionada.

## O que testei

Rodei a migração num Postgres de verdade, duas vezes, e conferi:

- os cargos certos ligados e os errados desligados
- a trava que impede dois preços para a mesma combinação de convênio +
  procedimento + plano — inclusive no caso do plano em branco, que é onde esse
  tipo de trava costuma falhar

Esse último teste mudou o código: a grade de preços agora apaga e regrava o
escopo em vez de usar upsert, porque a comparação de "nulo com nulo" não é
confiável para esse fim.

## Vindo a seguir

Você pediu mais duas coisas que ficaram para a próxima:

- **trocar a situação clicando na marca do cartão**, preenchendo a data
  correspondente com a de hoje
- **mais de uma cirurgia no mesmo lançamento**, para os procedimentos
  conjugados
