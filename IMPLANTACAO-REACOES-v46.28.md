# Implantação das reações — v46.28

## Arquivos alterados

- `app/inbox/page.tsx`
- `n8n/CRM - PRINCIPAL - v46.28-REACOES-CORRIGIDAS.json`
- `n8n/CRM - REAGIR MENSAGEM WHATSAPP - v46.28.json`

## Ordem de implantação

1. Confirme que a migration `supabase/migrations/20260803_message_reactions_v46_23.sql` já foi executada no Supabase.
2. Importe o flow `CRM - REAGIR MENSAGEM WHATSAPP - v46.28.json` no n8n e deixe-o **ativo**. O webhook de produção deve continuar em `/webhook/crm-reagir-mensagem`.
3. Substitua o flow principal pelo arquivo `CRM - PRINCIPAL - v46.28-REACOES-CORRIGIDAS.json`, preservando as credenciais vinculadas, e ative-o.
4. Faça o deploy desta pasta do CRM no Easypanel.

## Testes mínimos

1. Paciente reage a uma mensagem enviada pela clínica: o emoji deve aparecer na mensagem correspondente no CRM sem criar nova mensagem e sem acionar a Sofia.
2. Atendente reage a uma mensagem recebida: o emoji deve aparecer imediatamente no CRM e também no WhatsApp do paciente.
3. Atendente toca novamente no mesmo emoji: a reação deve ser removida.
4. Atendente troca o emoji: a reação anterior deve ser substituída.
5. No celular, abra o seletor em mensagens próximas às duas bordas: ele deve permanecer centralizado e totalmente dentro da tela.

## Observação

O flow exportado anteriormente estava com `active: false`. Mesmo após a importação, confira visualmente no n8n se o botão **Active** está ligado, pois algumas instalações não preservam o estado ativo ao importar workflows.
