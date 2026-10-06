# v48.04 — Cálculo automático dos valores da cirurgia

**1.** Rode `20260914_valores_cirurgia_v48_04.sql` no Supabase.
**2.** Suba o zip.

## A conta

```
valor cobrado (o orçamento)
   = valor da equipe do procedimento
   + valor do anestesista, SE houver anestesista na equipe
     E ele não for cobrar direto do paciente
   + ajuste

valor da prévia
   = valor cobrado + percentual da modalidade
```

Conferido contra o caso do Leandro: CCC, equipe de 2 auxiliares e 1
instrumentador, **sem anestesista** → cobrado **R$ 10.000**. Particular com
convênio, 30% → prévia **R$ 13.000**. Igual à planilha.

## O que mudou na tela

**A composição da equipe virou número.** Auxiliares, instrumentadores e uma
caixa para anestesista, em vez de texto solto. Tinha que ser assim: é a
presença do anestesista que decide se o valor dele entra na conta, e frase não
entra em conta. O texto da carta continua saindo no formato de sempre —
*"2 AUXILIARES, 1 INSTRUMENTADOR"* — só que gerado a partir dos números.

**O anestesista tem duas situações.** Marcando "tem anestesista", o valor dele
entra no orçamento. Marcando também "cobra direto do paciente", ele sai da
conta — é o caso que você descreveu, que varia conforme o acordo entre
paciente, clínica e anestesista. A linha aparece riscada no resumo, para ficar
claro que existe e não está sendo cobrada.

**Os 30% ficam na modalidade, não no programa.** Em Configurações → Cad.
Cirurgias → Modalidades, cada uma tem o seu percentual ao lado do nome:
*Particular com convênio* = 30, *Particular total* = 0. Zero significa que
aquela condição não tem prévia — o campo aparece desabilitado, em vez de
mostrar R$ 0,00 e parecer valor combinado. Se um dia o percentual mudar, é uma
edição na tela, não um deploy.

**Um resumo mostra de onde veio o número.** Equipe, anestesista, ajuste e o
total calculado, antes dos campos. A secretária vê a conta, não só o resultado.

## O ponto que você levantou sobre acordo

*"às vezes fazemos a alteração manualmente do valor conforme acordo"* — isso é
respeitado. Enquanto ninguém digita, os dois campos seguem a conta e se
atualizam sozinhos ao trocar o procedimento, marcar o anestesista ou mudar a
condição. **No instante em que você digita por cima, aquele campo para de ser
recalculado** e aparece um atalho *"usar o calculado (R$ X)"* para voltar.

Sem essa trava, trocar qualquer coisa depois do acordo apagaria o valor
combinado — e ninguém perceberia até o paciente reclamar.

## Próxima etapa

Sincronização CRM ↔ planilha, que é o que permite desligar a planilha depois
sem susto.
