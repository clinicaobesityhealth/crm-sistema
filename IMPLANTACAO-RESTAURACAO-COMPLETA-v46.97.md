# Implantação — restauração completa (v46.97)

## Contexto

Depois do v46.95 (montado em cima do v46.94_FORMATACAO_RESUMO), você mandou
mais um ZIP: **v46.96_EDICAO_VISUAL_RESUMO** — a correção da edição manual do
resumo de exames (negrito/itálico/sublinhado passaram a ser aplicados de
verdade no texto, com toggle ao clicar de novo no mesmo trecho, em vez dos
marcadores `**`/`*`/`_` de antes).

Este pacote (v46.97) refaz a mesma reconstrução, mas agora **a partir do
v46.96** — que já tem essa correção — em vez do v46.94. Ou seja: tudo que
estava certo ontem continua certo, incluindo essa última correção da edição
do resumo, e por cima só entram as três mudanças de hoje (mesmas do v46.95):

1. Correção do lembrete de confirmação não sair em remarcações perto do
   horário padrão (banco de dados) — sem alteração, é a mesma migração SQL
   de antes.
2. Botão **"Reenviar confirmação"**, sem o bug do "ON CONFLICT" (veja
   detalhes no fim).
3. Rótulo "📅 Retorno agendado" → **"✉️ Mensagem de retorno agendada"**, e
   troca do emoji de calendário por envelope nos indicadores de "mensagem já
   agendada" (Próximo agendamento, Outros agendamentos, Última consulta).

Não toquei em mais nada do v46.96 — a edição visual do resumo (negrito real,
toggle ao clicar de novo, campo único editável) está intacta, só conferida
pelo build.

**Se você aplicou o v46.95 antes deste**: pode subir o v46.97 por cima
tranquilamente — ele já parte do v46.96, então a correção da edição visual
do resumo, que não estava no v46.95, volta junto. Não precisa rodar o SQL de
novo (é o mesmo arquivo, idempotente, mas não muda nada se já rodou).

## Bug do "Reenviar confirmação" corrigido

O erro **"there is no unique or exclusion constraint matching the ON
CONFLICT specification"** acontecia porque o botão tentava
`.upsert(..., {onConflict: 'idempotency_key'})`, mas o índice único dessa
coluna no banco é **parcial** (`where idempotency_key is not null`) — o
Supabase/PostgREST não consegue montar um `ON CONFLICT` que respeite essa
condição. Resultado: o clique marcava a confirmação ativa como substituída e
depois **falhava** ao criar a nova, deixando a consulta sem confirmação
agendada. Troquei por uma busca manual (procura pelo `idempotency_key`; se
existir, atualiza; se não, insere) — sem depender de `ON CONFLICT`.

## Sobre a consulta de teste (07/09/2026, JOÃO JORGE DE BARROS NETO)

Ficou com duas mensagens "Substituído" e nenhuma ativa por causa desse bug.
Não precisa apagar nada — "Substituído" só significa que aquela linha não
será mais enviada. Rodar a migração SQL (passo 1 abaixo) já revalida todas
as consultas futuras não canceladas e recria a confirmação ativa que faltou,
inclusive para essa.

## Arquivos alterados (em relação ao v46.96)

- `components/ConversationSidePanel.tsx` — botão "Reenviar confirmação"
  (bug corrigido) + rótulo/emoji do indicador de retorno.
- `supabase/migrations/20260830_confirmation_reschedule_and_link_v46_93.sql`
  — sem mudança de conteúdo, só reaplicada (idempotente).

## Ordem segura de implantação

1. (Só se ainda não rodou) Execute no Supabase SQL Editor a migração
   `20260830_confirmation_reschedule_and_link_v46_93.sql` — idempotente,
   pode rodar de novo sem problema.
2. Suba o ZIP `crm-obesity-v46.97-restauracao-completa.zip` no EasyPanel.

## Testes obrigatórios

1. Abra a conversa do paciente de teste: o card "Próximo agendamento" deve
   mostrar ✉️ ao lado da data, e a aba Agendadas deve ter uma linha
   **Agendado** (não Substituído) com o link.
2. Confira o indicador ✉️ em "Próximo agendamento" e "Outros agendamentos".
3. Card "Última consulta": mensagem de retorno agendada deve aparecer como
   "✉️ Mensagem de retorno agendada".
4. Clique em "Reenviar confirmação": deve aparecer "Confirmação agendada!"
   sem erro.
5. **Edição do resumo de exame**: gere um resumo, clique em negrito numa
   parte do texto — deve ficar em negrito de verdade na tela; clique de novo
   no mesmo trecho — deve voltar ao normal. Os títulos automáticos (LAB
   set/26, Exames Alterados, Exames em Destaque, Exames Normais) devem
   continuar em negrito automaticamente, e o resto do texto normal, editável
   na mão.
6. Confira rapidamente: interpretação de exames por IA, "Confirmado pelo
   paciente" no card, "Agendar msg de retorno" — todas de volta.

## Reversão

Se algo der errado, volte ao ZIP `v46.96_EDICAO_VISUAL_RESUMO` (o que você
me enviou) no EasyPanel — sem o botão "Reenviar confirmação" nem os rótulos
de hoje, mas com tudo o mais intacto. A migração SQL não precisa ser
revertida — só adiciona/corrige, não remove nada.
