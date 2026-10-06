# v47.04 — Mensagens agendadas limpas + selo de cobrança da última consulta

## 1. Painel "Mensagens agendadas" (menu do paciente, dentro do atendimento)

**Problema:** a lista mostrava tudo — agendadas, substituídas (quando o horário da
consulta muda, a mensagem antiga vira `superseded`), canceladas e enviadas. Ficava
poluída e era difícil ver o que realmente ainda vai sair.

**Como ficou:**

- Aba principal **Agendadas (n)** — só o que ainda vai ser enviado (`scheduled` / `pending`).
- Sub-aba **Enviadas (n)** — histórico do que já saiu (`sent`), apenas para conferência.
- Substituídas e canceladas não aparecem mais em tela (continuam no banco; o botão
  "Apagar todo o histórico" segue limpando tudo).
- O botão de apagar tudo só aparece na aba **Agendadas**, para não dar a impressão
  de que apagaria só as enviadas.

## 2. Selo verde "Consulta (paga)" no card da aba MedX

**Problemas:**

1. O aviso azul **"✉️ Mensagem de retorno agendada"** é largo e dividia a mesma linha
   com o selo de cobrança — empurrava o verde para fora da área visível, e no celular
   ele simplesmente sumia.
2. Quando o MedX não devolvia o campo `retorno` preenchido, o selo não era renderizado
   — ficava a dúvida entre "não veio o dado" e "quebrou a tela".

**Como ficou:**

- O selo de cobrança (verde "Consulta (paga)" / âmbar "Retorno (não pago)") fica agora
  logo ao lado da data, e o aviso azul desceu para a linha de baixo, com espaço inteiro.
- A linha usa `flex-wrap`, então em telas estreitas os elementos quebram em vez de cortar.
- Nova função `normalizarRetornoUltima()`: além de `retorno`, também interpreta
  `retorno_gratuito`, `cobranca` ("COBRAR" / "NÃO COBRAR") e a modalidade/tipo de consulta
  quando contêm a palavra "retorno".
- Se ainda assim não der para afirmar nada, aparece um selo cinza
  **"Cobrança não informada"** — assim fica claro que o dado não veio do MedX.

## Arquivo alterado

- `components/ConversationSidePanel.tsx`

## Implantação

Subir o zip no Easypanel normalmente (build Next.js). Nenhuma migração de banco
é necessária nesta versão.
