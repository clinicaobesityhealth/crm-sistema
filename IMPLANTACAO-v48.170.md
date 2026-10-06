# CRM Obesity v48.170 — corrige o duplo check e reduz a oscilação online/offline

## 1) Por que o duplo check não aparecia — ATENÇÃO, provável causa

O código do check de leitura (v48.169) precisa da coluna `read_at`, que é
criada pelo SQL que mandei junto daquela versão. **Se esse SQL ainda não foi
rodado**, é exatamente isso que explica o que você viu: o check fica sempre
simples (✓), porque o pedido para marcar a mensagem como lida estava
falhando inteiro (coluna que não existe) — e, pior, nem o "lida" básico
(usado na contagem de não lidas) estava sendo gravado mais.

**Corrigi os dois lados:**
- Agora, se a coluna ainda não existe, o sistema tenta marcar como lida do
  jeito antigo (sem travar nada) — então a contagem de não lidas volta a
  funcionar mesmo sem o SQL.
- O check também ganhou um degrau do meio: mensagem lida mas sem a coluna
  nova mostra check duplo cinza (sem o azul e sem hora exata); com a coluna
  já criada, vira check duplo azul com a hora.

**Mas o ideal é rodar o SQL** (se ainda não rodou) para ter a hora exata de
leitura — é o mesmo arquivo de antes, pode rodar agora sem problema:
`supabase/migrations/20261005_leitura_chat_interno_v48_169.sql`

Depois de rodar, dá para conferir: abra uma conversa no chat da equipe,
mande uma mensagem, peça para a outra pessoa abrir do lado dela — o check
deve virar azul na hora, sem precisar atualizar a página.

## 2) Oscilando online/offline — tolerância aumentada

A presença "online" tinha só 12 segundos de tolerância antes de marcar
alguém como offline quando a conexão em tempo real cai por um instante —
comum em celular (app em segundo plano, tela apagando, uma oscilação normal
de 4G/wi-fi). Isso é rápido demais: a reconexão (que ia acontecer de
qualquer jeito) chegava depois dos 12s, e por isso parecia "piscar"
online/offline repetidamente.

Subi essa tolerância para **40 segundos**, e ajustei as janelas de
segurança usadas em outras telas (convite de atendimento, chat da equipe)
para **60 segundos**, para que todos os lugares que mostram online/offline
concordem entre si e parem de discordar por alguns segundos a cada queda.

Isso reduz bastante a oscilação, mas não garante 100%: se a conexão de
alguém realmente ficar instável por mais de 40s seguidos (rede muito ruim),
ainda vai aparecer offline naquele momento — porque, de fato, a pessoa
ficou sem conexão com o servidor por tempo real o suficiente.

## Implantação

1. Se ainda não rodou, rode o SQL da v48.169:
   `supabase/migrations/20261005_leitura_chat_interno_v48_169.sql`
2. Suba o zip no EasyPanel como sempre. Não tem SQL novo nesta versão — só
   código.
