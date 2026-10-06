# v48.12 — O nome deixa de passar por cima da coluna vizinha

**Sem SQL.** É só subir o zip.

## A causa

O botão do nome não conseguia encolher. Faltava uma instrução de layout
(`block w-full`) para que o corte com reticências funcionasse — sem ela, o
botão mantinha a largura do texto inteiro, ignorava o limite da coluna e o nome
avançava por cima da coluna de telefone.

Não era largura insuficiente: era o texto não respeitando a própria coluna.
Aumentar o campo sem corrigir isso só empurraria o problema para nomes um
pouco mais longos.

## Três mudanças

**O nome agora corta com reticências** dentro da própria coluna, e o nome
completo aparece ao passar o mouse.

**A coluna do nome nasce maior** — 280 em vez de 200, que cortava a maioria dos
nomes completos. Se você já tinha arrastado essa coluna alguma vez, a sua
escolha é mantida; se estava no tamanho antigo de fábrica, recebe o novo.

**Dois cliques no divisor ajustam a coluna ao conteúdo.** Aquela listra fina na
borda direita do cabeçalho: arrastar continua funcionando como antes, e agora
um duplo clique mede o nome mais longo que está na tela e ajusta a largura a
ele. Vale também para Telefone e Instagram.

A medição usa a fonte real da tela, não uma conta por número de caracteres —
"Wladimir" e "Ilili" têm o mesmo tamanho em letras e larguras bem diferentes.
Há um teto de 520 pixels, para um nome fora do comum não engolir a tabela.

As larguras continuam sendo salvas por usuário, como já eram: o que você
ajustar vale só para você.
