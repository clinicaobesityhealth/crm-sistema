# Implantação — melhorias na Agenda de Mensagens v46.51

## O que mudou

- Menu lateral: "Agenda" foi renomeado para "Agenda de Mensagens" (`components/Sidebar.tsx`).
- Data/hora nas listas de Enviadas e Falha: antes qualquer mensagem com `scheduled_for` no passado aparecia como "Atrasado", mesmo já enviada/falhada. Agora "Atrasado" só é exibido para mensagens ainda ativas (`scheduled`/`pending`); enviadas e falhadas mostram a data real.
- Reenvio manual: mensagens com status "Falha" agora têm um botão de reenviar (ícone de setas) que volta o status para `scheduled` e limpa `error_message`, para o disparador automático tentar novamente.
- Ordenação: as listas (Programadas, Enviadas, Falha, Todas) agora ordenam da mais recente para a mais antiga.
- Filtro "Somente automáticas (Auto)": disponível na aba Programadas, filtra só as mensagens com origem automática (lembretes de confirmação de consulta).
- Autor da programação: cada mensagem agora mostra quem programou. Mensagens automáticas aparecem como "Sofia" (nome da IA configurado); mensagens manuais mostram o nome do atendente que criou (via `scheduled_messages.created_by` → `agents.name`).

## O que foi preservado

- Nenhuma lógica de criação/cancelamento/disparo de mensagens foi alterada — só a exibição na tela e a ação manual de reenvio (que apenas reabre o status para `scheduled`).
- Nenhuma migração de banco é necessária: todas as colunas usadas (`error_message`, `created_by`) já existem em `scheduled_messages`.

## Arquivos alterados

- `app/agenda/page.tsx`
- `components/Sidebar.tsx`

## Ordem segura de implantação

1. Suba o ZIP do CRM v46.51 no EasyPanel (mesmo processo já usado nas versões anteriores).
2. Confira a Agenda de Mensagens: aba Programadas com filtro "Somente automáticas", aba Falha com botão de reenviar, e o nome do menu lateral atualizado.
