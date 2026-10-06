# v48.10 — O identificador do Instagram deixa de ser invisível

**Sem SQL.** É só subir o zip.

## O que estava acontecendo

Para unir um contato de Instagram ao cadastro de WhatsApp da mesma pessoa, o
CRM pedia o **PSID** — o identificador da conversa no Instagram. Só que esse
identificador não aparecia em tela nenhuma.

Na lista de contatos, a coluna Telefone mostrava a palavra "Instagram" no lugar
do valor. Na coluna Instagram, "Não vinculado". No cadastro aberto, "Somente
Instagram (sem WhatsApp vinculado ainda)". Em nenhum desses lugares o número
que o sistema pedia estava escrito.

Era um pedido impossível de atender. Por isso você não conseguiu associar a
Gisele.

## O que mudou

**Na lista**, a coluna Instagram agora mostra o identificador do contato, com
um botão de copiar ao lado. A coluna Telefone diz "Sem WhatsApp", que é a
informação útil ali.

**No cadastro aberto**, aparece o identificador em campo próprio, também com
botão de copiar, e a explicação de para que ele serve.

**E, melhor, você não precisa mais copiar nada.** No cadastro do contato de
Instagram há agora o botão **"Unir a um contato de WhatsApp"**: você digita o
nome, escolhe o cadastro certo na lista, e pronto. O sistema usa o
identificador por baixo, sozinho.

A busca só oferece contatos que tenham telefone de verdade — unir dois
cadastros de Instagram não resolveria nada, e oferecer isso só geraria erro.

O caminho antigo continua existindo: abrir o contato de WhatsApp e colar o
PSID. Agora ele funciona, porque o PSID pode ser copiado. Mas o caminho novo é
mais curto.

## Para a Gisele

Abra **Contatos**, ache a Gisele que veio do Instagram, clique no nome, e no
campo Instagram use **"Unir a um contato de WhatsApp"**. Digite "Gisele",
escolha o cadastro com o telefone dela, e os dois viram um só — as mensagens
dos dois canais passam a cair na mesma conversa.
