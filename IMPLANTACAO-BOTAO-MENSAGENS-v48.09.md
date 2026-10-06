# v48.09 — Botão de programar as mensagens, com estado visível

**Sem SQL.** É só subir o zip.

Você tinha razão: um comando SQL que alguém precisa lembrar de rodar não é
solução. Virou botão — e, o que importa mais, virou **estado visível**.

## Como fica

Ao abrir uma cirurgia, logo abaixo da Situação, aparece o bloco
**"Mensagens de pré e pós-operatório"**, em um de dois estados:

**Já programadas** — cada mensagem aparece com tipo, data e hora
("Pré-operatório · programada para 25/09/2026 09:00"). As já enviadas aparecem
com visto verde e a data do envio. Cada pendente tem um × para cancelar
individualmente, se aquele paciente não deve receber.

**Ainda não programadas** — aparece o botão
**"Programar mensagens de pré e pós"**.

Não existe terceiro estado. Ou você vê as datas, ou vê o botão. Nunca "não se
sabe se foi".

## Quando o botão não consegue

Aqui está a parte que eu mais queria acertar: se você apertar e nada for
programado, a tela **diz o motivo**, em vez de parecer quebrada. Ela consulta o
banco e responde qual das cinco causas foi:

- os modelos de mensagem estão desligados
- a cirurgia não está vinculada a um paciente do cadastro
- a cirurgia está sem data
- a situação atual não dispara mensagens (e diz qual dispara)
- as datas de envio já passaram — nesse caso o contato precisa ser à mão

Um botão que parece não fazer nada é pior do que não ter botão.

## Por dentro

O botão não repete a regra de quando e o que enviar: ele apenas **toca** na
cirurgia, e o gatilho do banco faz o resto — o mesmo gatilho que age quando a
cirurgia é autorizada normalmente.

Isso é de propósito. Se a regra estivesse escrita também aqui, um dia as duas
cópias discordariam, e a mensagem sairia diferente conforme o caminho.

## A ordem certa, agora

**1. Desligue o gatilho da planilha primeiro.** Você apontou isso e está certo:
enquanto os dois estiverem ativos, o paciente recebe em dobro.

No Apps Script da planilha: menu **Acionadores** (o ícone de relógio, na barra
esquerda) → ache o que chama `agendarMensagemPreePos` → **excluir**. A função
continua no arquivo; o que sai é o disparo automático. Nada mais do script é
afetado.

**2.** Leia e ajuste os dois textos em Cad. Cirurgias → Mensagens.

**3.** Cadastre o WhatsApp dos cirurgiões em Cad. Cirurgias → Equipe.

**4.** Marque **ligada** nos dois modelos.

**5.** Abra o **Leandro** (é a única das 4 importadas que está AUTORIZADA com
data futura) e aperte **Programar mensagens de pré e pós**. Devem aparecer duas
linhas: 25/09 e 27/09.

**6.** Confira na Agenda de Mensagens, filtro por remetente
**"Agenda cirúrgica"**, antes de confiar.

As outras três cirurgias importadas estão em PRÉ-OPERATÓRIO e situações
anteriores — elas se programam sozinhas quando chegarem em AUTORIZADA, sem
ninguém apertar nada. O botão é só para as que já passaram desse ponto antes
de o sistema existir.
