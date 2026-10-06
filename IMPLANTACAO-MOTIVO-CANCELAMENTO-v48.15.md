# v48.15 — Motivo do cancelamento

**1.** Rode `20260915_motivo_cancelamento_v48_15.sql` no Supabase.
**2.** Suba o zip.

## Como funciona

No instante em que a situação escolhida é de cancelamento, **aparece na hora**
um bloco vermelho pedindo o motivo — não numa tela seguinte, não depois de
salvar. É agora que a pessoa sabe o que houve; perguntar depois é receber
"não lembro".

O campo é **obrigatório**: sem ele, o salvar não passa.

Vale para **NEGADA PELO CONVÊNIO** também, e não só para CANCELADA. As duas são
cancelamento, e no caso do convênio o motivo costuma ser o mais importante de
todos — carência, falta de documento, glosa.

## Onde o motivo aparece

**No cartão da lista**, nas canceladas, numa tarja vermelha logo abaixo dos
valores. Você entende a lista inteira sem abrir uma por uma — que era o ponto
de ter isso no cartão.

**No cadastro**, sempre que a cirurgia estiver cancelada, editável.

## Duas decisões

**Campo próprio, não a observação.** Só assim dá para exigir o preenchimento e
mostrar no cartão. Texto enterrado numa observação livre não se pode cobrar nem
exibir com destaque.

**O motivo não é apagado** se a cirurgia voltar a ficar ativa — uma cirurgia
cancelada e depois remarcada faz parte da história daquele paciente, e é bom
que fique registrado que houve um cancelamento antes.

O histórico de situações continua guardando **quando** e **quem** cancelou. O
campo novo responde o **porquê**, que é o que alguém pergunta meses depois,
quando o paciente volta.

## Nas 14 canceladas que vieram da planilha

Elas entraram sem motivo, porque a planilha não tinha esse campo. Ficam sem a
tarja até alguém abrir e preencher. Se quiser, dá para ir preenchendo aos poucos
— ou deixar em branco, já que são histórico.
