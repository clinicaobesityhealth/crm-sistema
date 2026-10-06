# CRM Obesity v46.41 — confirmação visual e validação de dono real ao finalizar

## Contexto

Em 2026-08-04 o link de avaliação do Google foi enviado indevidamente em uma
conversa (paciente de teste "João Jorge") que a secretária não tinha
finalizado de fato — ela abriu a conversa pela busca (não pela lista de
atendimentos) e clicou "Finalizar atendimento" mesmo sem estar mais
participando dela. O popup nativo do navegador (`window.confirm`) também
facilitava confirmar sem querer ao fechar várias conversas em sequência.

## O que mudou

- **Nova verificação de dono/participante real**: ao clicar em "Finalizar
  atendimento", o CRM agora busca o estado atual da conversa direto do banco
  (dono e participantes) em vez de usar os dados já carregados na tela. Se o
  atendente não for mais o dono nem participante daquela conversa, a ação é
  bloqueada com o aviso "Você não está mais neste atendimento — a conversa
  foi atualizada. Abra-a novamente na lista." — nada é finalizado e nenhum
  link é enviado.
- **Popup de confirmação substituído**: o antigo `window.confirm` nativo do
  navegador foi trocado por uma tela de confirmação própria do CRM
  (`ReviewConfirmModal`), que mostra claramente o nome do paciente que vai
  receber o link e exige um clique explícito em "Sim, enviar avaliação para
  [nome]" — reduz o risco de confirmar sem querer ao fechar várias conversas
  rapidamente.
- A regra de que só quem tem cargo Secretária/Secretário recebe essa
  pergunta (v46.39) continua igual, sem alteração.
- O link, quando enviado, continua indo somente para o paciente da conversa
  que está sendo finalizada de fato (agora com a verificação acima).

## Arquivos alterados

- `components/ReviewConfirmModal.tsx` (novo)
- `app/inbox/page.tsx` (função `handleCloseConversation`)

## Implantação

1. Suba este ZIP no Easypanel como nas versões anteriores.
2. Não é necessário executar SQL novo para esta correção.
3. Não há alteração de flow n8n nesta versão.

## Verificação recomendada após subir

- Abrir uma conversa que já foi finalizada por outra pessoa (ex: pela busca)
  e tentar clicar em "Finalizar atendimento" — deve aparecer o aviso de
  bloqueio, sem popup de avaliação.
- Finalizar um atendimento normalmente como secretária — deve aparecer a
  nova tela com o nome do paciente, e só enviar o link ao clicar em "Sim".
- Finalizar como médico/administrador — deve finalizar direto, sem
  nenhuma pergunta sobre avaliação (igual antes).
