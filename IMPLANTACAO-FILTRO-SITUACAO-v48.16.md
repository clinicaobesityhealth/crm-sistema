# v48.16 — Filtro por situação

**Sem SQL.** É só subir o zip.

Faltava mesmo. As abas filtram por **estado geral** (em andamento, realizada,
cancelada), e você precisa da **situação exata**: AUTORIZADA, PRÉ-OPERATÓRIO,
AGENDAR, SOLICITADO AO CONVÊNIO, AG. PAGAMENTO 1ª PARCELA.

## Como ficou

Um quarto seletor, ao lado de Hospital, Cirurgião e Cirurgia:
**Todas as situações**.

**Com o número de cada uma ao lado** — "AUTORIZADA (4)", "PRÉ-OPERATÓRIO (2)".
Você já vê onde as cirurgias estão paradas antes mesmo de escolher.

**Na ordem do fluxo de trabalho, não em ordem alfabética.** PRÉ-OPERATÓRIO,
AGENDAR, SOLICITADO ORÇAMENTO, ORÇAMENTO APROVADO, SOLICITADO AO HOSPITAL...
até AUTORIZADA e CIRURGIA REALIZADA. É a ordem em que a cirurgia caminha, e
procurar nela é mais rápido do que procurar num alfabeto.

**Só aparecem situações que têm cirurgia.** Das 21 cadastradas, a lista mostra
as que de fato estão em uso — sem rolar por opções vazias.

## Um detalhe que evita uma armadilha

Escolher uma situação **leva junto para a aba certa**. Se você está em "Em
andamento" e escolhe CIRURGIA REALIZADA, a aba muda sozinha para Realizadas.

Sem isso a lista apareceria vazia, e a conclusão natural seria que o filtro
está quebrado — quando na verdade os registros estão na aba do lado.

## Junto

Situação que não está mais no cadastro, mas que alguma cirurgia ainda usa,
continua aparecendo no filtro. Se ela sumisse da lista, aquelas cirurgias
ficariam impossíveis de achar por esse caminho.

Os quatro filtros agora quebram em duas linhas quando a tela é estreita, em vez
de se espremerem.
