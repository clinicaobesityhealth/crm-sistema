# CRM Obesity v48.169 — aviso de recebimento/leitura no chat interno da equipe

## O pedido

No chat interno (atendente → atendente, o balãozinho de mensagens da
equipe), não tinha como saber se quem recebeu a mensagem já abriu e leu —
só dava para ver quando a pessoa está online ou não.

## O que mudou

Cada mensagem sua, no chat da equipe, agora mostra um check ao lado do
horário — igual ao WhatsApp:

- **✓ (um check)** — mensagem enviada, a outra pessoa ainda não abriu.
- **✓✓ (check duplo, colorido)** — a outra pessoa abriu a conversa e leu.
  Passando o mouse/dedo no check aparece a hora exata da leitura.

O check vira duplo em tempo real: não precisa fechar e abrir o chat de novo
para ver que a pessoa leu — assim que ela abre a conversa do lado dela, o
seu check já atualiza.

## Sobre a Daniella aparecer offline no chat da equipe

Isso é **outro sinal, sem relação com o Sofia pausada**. "Sofia pausada"
grava uma vez, quando a secretária entra no sistema (é por login, não é um
sinal de "está olhando a tela agora"). Já o "online"/"offline" do chat da
equipe depende da conexão em tempo real do navegador dela ficar ativa — e
em celular, isso cai sozinho poucos segundos depois que a tela trava ou o
app vai para segundo plano, mesmo que a pessoa continue entrando e saindo
do sistema o tempo todo. Por isso ela pode estar de fato trabalhando (ter
respondido o paciente há pouco) e aparecer "offline" no indicador.

**Por isso o check de leitura desta versão é a resposta mais confiável** à
sua pergunta "será que ela está recebendo?" — ele só fica duplo quando ela
de fato abriu a conversa, independente do indicador de online/offline. Se
quiser, posso também deixar o indicador de online/offline mais tolerante
(hoje considera "offline" depois de ~45 segundos sem sinal do navegador) —
me avise se valer a pena ajustar isso também.

## Implantação

1. Rode o SQL (Supabase → SQL Editor):
   `supabase/migrations/20261005_leitura_chat_interno_v48_169.sql`
   (só adiciona a coluna `read_at` — não tem risco, não apaga nada.)
2. Suba o zip no EasyPanel como sempre.
