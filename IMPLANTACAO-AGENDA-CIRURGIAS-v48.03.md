# v48.03 — Agenda de cirurgias: lançamento, lista e histórico

Agora o CRM anda sozinho. Dá para lançar uma cirurgia do começo ao fim sem
abrir a planilha.

## Ordem de implantação

**1.** Rode `20260914_agenda_cirurgias_v48_03.sql` no Supabase (depois da v48.01
e da v48.02, que você já rodou).

**2.** Suba o zip no EasyPanel.

Aparece **Cirurgias** no menu principal, entre Agenda Médica e Disparos.

## O que muda em relação à planilha

**O paciente é o mesmo cadastro do CRM.** Ao lançar, você digita três letras e
escolhe da lista de contatos. Na planilha o nome é redigitado toda vez, e
"José da Silva" e "Jose da Silva" viram duas pessoas com dois históricos. Aqui
a cirurgia, a conversa no WhatsApp e as cobranças ficam na mesma pessoa.

Dá para lançar sem vincular, quando o paciente ainda não está cadastrado — a
cirurgia aparece na lista com um aviso "sem cadastro", para alguém ligar os
dois depois.

**Realizada e cancelada não mudam de lugar.** A planilha move a linha para
outra aba. Aqui a cirurgia troca de situação e os botões no alto da lista
filtram: Em andamento, Realizadas, Canceladas, Todas.

**Toda troca de situação fica registrada.** Quem mudou, de quê para quê, e
quando. O botão do relógio, no alto do cadastro da cirurgia, mostra a linha do
tempo. Hoje isso não existe: a célula é sobrescrita e o que havia antes some.

O registro é feito pelo banco, não pela tela. Quando a sincronização com a
planilha entrar, ou uma automação do n8n mudar a situação, o histórico acontece
do mesmo jeito.

## Uma dúvida que preciso que você resolva

Peguei a cirurgia do Leandro na planilha como referência:

- CCC, que na tabela vale **R$ 10.000 de equipe + R$ 2.000 de anestesista**
- na planilha, **prévia R$ 13.000** e **cobrado R$ 10.000**
- condição: particular com convênio

Os números não fecham com a soma simples, então existe uma regra que ainda não
conheço — provavelmente ligada à condição (particular total x com convênio) e à
composição da equipe. **Qual é a conta?** Com ela na mão eu faço os dois campos
se preencherem sozinhos.

Por enquanto: ao escolher a cirurgia, a tela **sugere** prévia = equipe +
anestesista e cobrado = equipe. É só sugestão, nunca sobrescreve o que você já
digitou, e os dois campos são livres. Preferi sugerir o óbvio a inventar uma
fórmula que eu não conferi.

## O que continua como está

A planilha e o formulário do médico seguem funcionando, intocados. A
sincronização entre os dois é a próxima etapa — e é ela que vai permitir
desligar a planilha depois, sem susto.

As mensagens de pré e pós-operatório e as cartas continuam saindo dos scripts
da planilha por enquanto.
