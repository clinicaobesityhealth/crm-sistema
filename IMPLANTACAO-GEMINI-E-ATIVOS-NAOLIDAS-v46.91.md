# Implantação v46.91 — troca pro Gemini + não lidas em cima nos Ativos

## 1. Análise de exame por IA agora usa Gemini (em vez de Claude)

Mesmo botão, mesmas regras de resumo, mesma tela de revisão antes de enviar — só trocou o motor por baixo, a pedido do Jorge (a API do Gemini tem nível gratuito).

**O que fazer no EasyPanel:**
1. Gere sua chave em **aistudio.google.com** → "Get API key" (não precisa cartão pro nível gratuito).
2. No serviço do CRM, adicione a variável `GEMINI_API_KEY` com esse valor.
3. Pode remover a variável antiga `ANTHROPIC_API_KEY` se quiser (não é mais usada por essa função) — mas não tem problema nenhum se deixar ela aí, simplesmente fica sem uso.
4. (Opcional) Pra trocar o modelo do Gemini usado, dá pra configurar `GEMINI_EXAM_MODEL` — sem configurar, usa `gemini-2.5-pro`.

Sem a `GEMINI_API_KEY` configurada, o botão "Analisar exame com IA" mostra "ainda não disponível" — o resto do CRM não é afetado.

## 2. Aba "Ativos" do Inbox: não lidas sempre em cima

Dentro de cada setor (grupo) da aba Ativos, os pacientes com mensagem não lida agora aparecem sempre no topo da lista daquele setor — antes a ordem era só por data da última mensagem, então uma não lida podia ficar escondida lá embaixo se o paciente não tivesse mandado mensagem recente. As demais conversas (sem não lida) continuam ordenadas por data, como sempre.

Isso é só na aba Ativos — Inbox e Pendentes não foram alteradas.

## O que foi preservado

- Nenhuma mudança no fluxo de anexar exame/documento no MedX, nem no envio da anotação (v46.90) — o Gemini é só pra gerar o texto do resumo; o envio pro MedX continua exatamente igual.
- Nenhuma mudança em Sofia, agendamentos, confirmação de consulta, ou qualquer outra função.
- Agrupamento por setor nos Ativos continua igual, só a ordem dentro de cada grupo mudou.

## Arquivos alterados

- `app/api/interpretar-exame/route.ts` — troca de Anthropic pra Gemini.
- `app/inbox/page.tsx` — ordenação de não lidas na aba Ativos.

## Ordem segura de implantação

1. Configure `GEMINI_API_KEY` no EasyPanel (veja acima).
2. Suba o ZIP `crmobesity_deploy_v46.91_GEMINI_E_ATIVOS.zip`.
3. Teste a análise de exame: abra um PDF de exame já anexado → ☁️ → Exame → "Analisar exame com IA" → confira o resumo (compare com os valores reais do PDF).
4. Teste a aba Ativos: confira que pacientes com mensagem não lida aparecem no topo de cada setor.
