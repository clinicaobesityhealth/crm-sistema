# v48.17 — "Iniciar conversa" pelo cadastro, e busca sem acento

**Sem SQL.** É só subir o zip.

## 1. O botão Iniciar conversa

O balãozinho da lista e o botão dentro do cadastro faziam **coisas diferentes**.

O balãozinho chama um caminho que sabe tratar cada caso: contato bloqueado,
conversa que está com outro atendente, conversa encerrada — e é esse último que
importa aqui. Quando a conversa está encerrada ou nunca existiu, ele abre o
histórico com a opção de iniciar.

O botão do cadastro pulava tudo isso e ia direto para o inbox com o contato na
URL. Só que o inbox **recusa de propósito** abrir conversa encerrada por esse
caminho — existe uma trava para que atualizar a página não ressuscite uma
conversa fechada. Resultado: você era levado ao inbox e nada acontecia.

Agora o botão do cadastro usa exatamente o mesmo caminho do balãozinho. A trava
do inbox fica como está, porque ela protege de outra coisa.

## 2. Busca sem acento

Procurar "jose" não encontrava "José". "conceicao" não encontrava "Conceição".
A comparação era feita letra a letra, e acento é outra letra para o computador.

Agora a busca ignora acento e maiúscula, nos dois sentidos: digitando com ou
sem acento, encontra do mesmo jeito. Vale para nome, telefone, e-mail e tags.

Apliquei a mesma correção na **busca de cirurgias**, que tinha o mesmo defeito
— lá afeta paciente, hospital e cirurgião.

Testei com os casos que aparecem no dia a dia da clínica: José, João,
Conceição, Muñoz, e um nome da sua própria lista.

## 3. Um problema que encontrei no caminho

A lista de contatos carregava os **500 mais recentes**, e a busca acontecia só
sobre esses. Um paciente que não conversa há bastante tempo simplesmente não
era encontrado pelo nome — e não havia nenhum aviso disso na tela.

Aumentei para 2.000. Se a sua base já passou disso, me avise: aí a busca
precisa ir ao banco em vez de filtrar o que está carregado, e isso é uma
mudança um pouco maior.
