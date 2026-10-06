# v48.11 — "Vinculei mas não aparece vinculado"

**Sem SQL.** É só subir o zip.

## O que estava errado

A vinculação **funcionava**. O que não funcionava era a tela.

Para decidir se mostrava "vinculado", o CRM olhava o campo **nome da conta** —
que é opcional no formulário. Quando ele ficava em branco, a união acontecia de
verdade, o identificador ia para o cadastro de WhatsApp, as mensagens dos dois
canais passavam a cair na mesma conversa, e mesmo assim a tela continuava
dizendo **"Não vinculado"**.

O efeito prático é o pior possível: a pessoa tenta vincular de novo, achando
que falhou. Por isso isso já tinha acontecido antes com você.

A tela agora decide pelo **identificador**, que é o que de fato une os dois
cadastros. O nome da conta virou o que sempre foi: um rótulo, mostrado quando
existe.

## O que você vai ver

No cadastro de WhatsApp, o campo Instagram mostra **"Instagram vinculado"** com
o identificador embaixo, copiável. Se houver nome de conta, ele aparece junto.

Na lista de contatos, a coluna Instagram mostra o nome da conta quando existe e
**"Vinculado"** quando não existe — em vez do "Não vinculado" que estava
errado.

## Duas vinculações antigas para conferir

Como esse defeito é de exibição e não de dados, **as vinculações que você fez
antes e achou que tinham falhado provavelmente estão lá**. Depois de subir esta
versão, vale abrir aqueles contatos: se aparecerem como vinculados, eram
falso-alarme desde o começo.

Se algum aparecer vinculado ao identificador errado — porque você tentou de
novo — me avise que eu desfaço.

## Um ajuste junto

A lista de contatos agora recarrega ao fechar o cadastro. Uma união muda
**dois** contatos: o que recebeu e o temporário, que é arquivado. Antes a tela
atualizava só o que estava aberto, e o outro ficava desatualizado até você
recarregar a página na mão.
