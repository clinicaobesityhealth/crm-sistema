# v48.23 — Cirurgia buscável no catálogo TUSS, hospital editável e situação pelo cartão

**Sem SQL.** É só subir o zip. (A v48.22 precisa estar no ar antes.)

## 1. O campo Cirurgia virou um buscador

Digite duas letras e ele procura em dois lugares:

**Nas cadastradas** — as 18 da clínica, com valores, materiais, TUSS e CID
prontos. Busca por abreviação e por nome, ignorando acento.

**No catálogo TUSS inteiro** — os 5.966 procedimentos da ANS que você importou.
Aparecem em âmbar, com o código, e a opção **"cadastrar esta cirurgia"**.

Escolhendo uma do catálogo, abre um cadastro curto ali mesmo: **abreviação**
(já vem sugerida pelas iniciais do nome), **valor da equipe** e **valor do
anestesista**. Salva, entra na tabela da clínica e já fica escolhida no
lançamento — sem sair da tela e sem perder o que você preencheu.

O código TUSS vai junto: foi por ele que a cirurgia foi encontrada, e é ele que
o convênio pede na guia.

Materiais, CID e orientações ficam para depois, em Configurações → Cad.
Cirurgias, quando houver calma.

## 2. Corrigir a cirurgia pelo próprio lançamento

Com a cirurgia escolhida, um **lápis** ao lado abre a correção de **nome,
abreviação e valores** — e salva **na tabela da clínica**, não só neste
lançamento.

É o que você pediu: ajustar o padrão a partir do agendamento. A tela avisa que
a mudança vale para a tabela inteira; lançamentos com valor digitado à mão não
são afetados, porque aquele valor virou acordo.

## 3. Hospital: buscar, cadastrar e apagar

Mesmo campo de busca. Digite para filtrar; se não existir, aparece
**"Cadastrar X e usar"**. Cada item da lista tem uma lixeira.

Hospital em uso não pode ser apagado — o banco não deixa, e ainda bem. Nesse
caso ele oferece **tirar da lista de escolhas**, o que resolve o mesmo problema
sem quebrar as cirurgias que já apontam para ele.

## 4. Trocar a situação clicando no cartão

Clique na **marca colorida da situação**, na lista. Abre um seletor agrupado
por estado — em andamento, realizada, cancelada — e a troca é imediata, sem
abrir o cadastro inteiro.

Mudar de situação é o que mais acontece no dia, várias vezes por cirurgia.
Obrigar a abrir o formulário completo para isso é o caminho para a situação
ficar desatualizada, que é o pior estado possível para esta lista.

Cancelar por ali continua pedindo o motivo, como no cadastro.

## 5. A data se carimba sozinha

Ao mudar de situação — pelo cartão ou pelo cadastro — a data daquele passo
recebe a de hoje:

| Situação | Data preenchida |
|---|---|
| Pré-operatório | Data pré-operatório |
| Solicitado ao hospital | Data solicitado ao hospital |
| Solicitado ao convênio | Data solicitado ao hospital |
| Autorizada | Data autorização |

**Só preenche o que está vazio.** Voltar para uma situação pela qual a cirurgia
já passou não apaga a data original — ela é o marco do prazo, e reescrevê-la
daria mais 21 dias úteis de graça ao convênio.

É isso que mantém o relógio dos 21 dias confiável: ele conta a partir dessas
datas, e antes elas dependiam de alguém lembrar de digitar.

## Ainda na fila

**Procedimentos conjugados** — mais de uma cirurgia no mesmo lançamento. É a
próxima, e vai junto com o acerto do cálculo de valores (hoje quatro linhas da
sua planilha têm "BP, HH, BX HEPÁTICA" numa célula só).
