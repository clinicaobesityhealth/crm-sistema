# Implantação v46.92 — alerta pop-up quando o paciente confirma pelo link

## O que foi acrescentado

Quando um paciente confirma a consulta clicando no link ("Sim, vou comparecer"), agora aparece um **card no canto da tela** — em qualquer página do CRM que a pessoa estiver, não só no Inbox — com o nome do paciente e a data/hora da consulta, junto com um **som curto** de aviso. O card some sozinho depois de alguns segundos, ou dá pra fechar na hora, e tem um botão "Ver conversa" que já leva direto pro paciente.

Isso não muda nada do que já existia: a confirmação continua marcando `patient_confirmed_at` do mesmo jeito, sem tocar em `status`; nada foi alterado na recusa (`patient_declined_at`), no aviso interno de recusa, nem no fluxo da Sofia.

## ⚠️ Passo extra obrigatório no banco (sem isso o alerta não aparece)

O CRM escuta essa confirmação em tempo real, mas isso só funciona se a tabela `agendamentos` estiver habilitada pro **Realtime** do Supabase — hoje ela não está (conferi e ela não aparece na lista de tabelas com Realtime ativo). É um ajuste de configuração, não muda nada em nenhuma automação existente. Rode isso no SQL Editor:

```sql
alter publication supabase_realtime add table agendamentos;
```

Se der erro dizendo que a tabela já está na publicação, pode ignorar — significa que já está tudo certo.

## Lembrete: o fix urgente de ontem

Se ainda não rodou o `FIX-URGENTE-link-confirmacao-v46.92.sql` que mandei antes (as colunas `patient_confirmed_at`/`patient_declined_at` + a função do trigger com o link), roda ele também — sem isso a página de confirmação continua indisponível e esse alerta novo nunca vai disparar (porque a coluna nunca é preenchida).

## Arquivos alterados

- `components/PatientConfirmationNotification.tsx` (novo) — o card + som.
- `components/ClientProviders.tsx` — passou a montar o componente novo (igual já fazia com os outros avisos globais do sistema, tipo pedido de acesso e novo cadastro).

## Ordem segura de implantação

1. No SQL Editor do Supabase, rode (se ainda não rodou) o `FIX-URGENTE-link-confirmacao-v46.92.sql`.
2. Rode `alter publication supabase_realtime add table agendamentos;`.
3. Suba o ZIP `crmobesity_deploy_v46.92_ALERTA_CONFIRMACAO.zip` no EasyPanel.
4. Teste: abra o CRM em uma aba (qualquer página) → em outra aba/dispositivo, abra o link de confirmação de um agendamento de teste e clique em "Sim, vou comparecer" → confira se o card aparece com som na primeira aba.
