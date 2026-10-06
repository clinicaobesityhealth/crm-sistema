# CRM Obesity v48.168 — documentos de cirurgia (editar/apagar/reenviar) + 2 correções por SQL

## 1) Orçamento/Solicitação/Internação/Reembolso: editar, apagar e reenviar

**O problema:** gerar um documento (ex.: Orçamento) e não enviar na hora
deixava o PDF preso para sempre na lista "Já gerados" — sem jeito de editar,
apagar ou mandar depois. Qualquer ajuste no texto virava um PDF novo, e a
lista só crescia.

**O que mudou**, na tela de Documentos da cirurgia, em cada item da lista
"Já gerados":

- **Editar** (lápis) — só em quem ainda não foi enviado. Recarrega o
  título/texto daquele documento no editor; o botão "Gerar PDF" vira
  **"Salvar alteração"** e substitui o mesmo documento (não cria um novo).
- **Apagar** (lixeira) — só em quem ainda não foi enviado. Remove o registro
  e o PDF do armazenamento. Um documento **já enviado** não pode ser
  apagado nem editado — ele é o registro do que o paciente recebeu, e isso
  não muda.
- **Reenviar** (avião de papel) — em qualquer documento desse tipo (enviado
  ou não). Recarrega o PDF já pronto no painel de envio, sem precisar gerar
  de novo; se já tinha sido enviado antes, o botão mostra "Enviar
  novamente".

Nada disso muda a Solicitação de procedimento (que vai para o hospital por
fora do WhatsApp) além de poder ser editada/apagada enquanto não for
gravada como enviada, igual aos outros tipos.

## 2) Texto do Orçamento (via SQL, sem precisar subir código)

Você pediu para trocar, no Orçamento, a frase "Solicito análise de prévia
de reembolso para o(a) paciente referido(a)..." por algo como "Segue o
orçamento referente à cirurgia...". Essa frase mora no banco (tabela
`cirurgia_cartas`), não no código — por isso é só SQL, já incluído no pacote
(`supabase/migrations/20261005_orcamento_texto_v48_168.sql`):

Troca:
> Solicito análise de prévia de reembolso para o(a) paciente referido(a) que
> necessita ser submetido(a) ao(s) tratamento(s) cirúrgicos abaixo
> relacionados que está prevista para ocorrer em {data} no hospital
> {hospital}.

Por:
> Segue o orçamento referente à cirurgia prevista para ocorrer em {data} no
> hospital {hospital}.

**Fiquei em dúvida em duas frases que sobraram** e que ainda pressupõem
convênio — não troquei sem confirmar com você:
- a saudação **"Ao convênio,"** no topo da carta;
- a frase final **"Este documento deve ser enviado ao convênio para análise
  de prévia de reembolso, se for o caso."**

Se o Orçamento também vai direto para paciente particular (sem convênio),
me diga que eu ajusto essas duas também — é mais uma linha de SQL.

## 3) Busca de paciente duplicando cadastro (caso Nathalia)

**O que aconteceu:** no link de agendamento do cirurgião, a busca de
paciente olha o cadastro do CRM e o espelho do MedX, e tenta reconhecer
quando os dois são a mesma pessoa comparando o telefone. O problema: o
WhatsApp grava o telefone do CRM com o "55" (código do país) na frente, e o
MedX grava sem — então a comparação **nunca batia** quando isso acontecia,
e o cadastro do MedX aparecia como se fosse gente nova. Se quem agenda
clica nesse resultado, nasce um cadastro novo — foi o que aconteceu com a
Nathalia.

**A correção** (SQL, `supabase/migrations/20261005_busca_paciente_medx_v48_168.sql`):
a comparação agora ignora o "55" extra de qualquer um dos lados, e também
reconhece como a mesma pessoa quando o cadastro do CRM já está vinculado ao
MedX (medx_id), mesmo que o telefone não bata. Isso cobre o caso da
Nathalia e deve reduzir bastante as duplicidades — mas não é 100%: se uma
pessoa aparecer pela PRIMEIRA vez com telefone diferente nos dois sistemas e
ainda sem vínculo nenhum, ainda pode escapar. Nesses casos, o caminho
continua sendo o que você já usou: abrir o cadastro duplicado e clicar em
**"Buscar no MedX"** para vincular certo (ou apagar o duplicado, se for o
caso).

## Implantação

1. Rode os dois arquivos SQL (Supabase → SQL Editor), em qualquer ordem:
   - `supabase/migrations/20261005_orcamento_texto_v48_168.sql`
   - `supabase/migrations/20261005_busca_paciente_medx_v48_168.sql`
2. Suba o zip no EasyPanel como sempre.

Nenhum dos dois SQLs tem efeito colateral em agendamento feito pela Sofia ou
pelo CRM manual — um só troca um texto fixo de carta, o outro só melhora
como a busca de paciente reconhece duplicidade.
