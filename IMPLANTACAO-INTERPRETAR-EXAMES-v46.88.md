# Implantação — resumo de exames por IA v46.88 (parte 1)

## O que foi acrescentado

- No mesmo lugar onde já dava pra "Adicionar ao prontuário MedX" (ícone de upload num anexo, painel do paciente), quando o tipo é **Exame**, agora tem um botão **"Analisar exame com IA"**.
- Só roda quando alguém clica — nunca automático, nunca envolve a Sofia.
- A IA lê o PDF já anexado na conversa e gera o resumo no formato exato que você pediu (LAB mês/ano, Exames Alterados, Normais em destaque, Exames não alterados, seguindo à risca as regras de não inventar valor, avaliar todas as páginas, ignorar contexto de conversas anteriores etc).
- O resultado aparece numa caixa de texto **editável** — a equipe revisa/corrige antes de usar.
- Tem um botão **"Copiar texto"** pra colar na anotação clínica do MedX.

## O que falta (parte 2, ainda não implantada)

- O envio **automático** direto pro MedX como anotação clínica — isso depende de eu descobrir a URL/formato exatos que o MedX usa pra salvar uma anotação. Combinamos que você vai gravar uma anotação de teste no MedX com o DevTools (Network) aberto e me passar o "Copy as cURL" da requisição. Assim que eu tiver isso, faço uma parte 2 rapidinha que troca o botão "Copiar texto" por um envio automático de verdade.
- Até lá, o fluxo já funciona de ponta a ponta, só com esse último passo manual (copiar e colar no MedX).

## ⚠️ Passo obrigatório antes do deploy: variável de ambiente nova

1. Pegue uma chave de API da Anthropic (console.anthropic.com → API Keys). Essa chave é diferente de tudo que o CRM já usa.
2. No EasyPanel, no serviço do CRM, adicione a variável `ANTHROPIC_API_KEY` com esse valor.
3. Sem essa variável, o resto do CRM continua funcionando normal — só o botão "Analisar exame com IA" mostra uma mensagem de indisponível.
4. (Opcional) Se um dia quiser trocar o modelo de IA usado, dá pra configurar via `ANTHROPIC_EXAM_MODEL` — sem configurar, usa o padrão atual.

## O que foi preservado

- Nenhuma mudança no fluxo já existente de anexar exame/documento no MedX (o botão "Adicionar ao prontuário MedX" continua idêntico).
- Nenhuma mudança em Sofia, agendamentos, confirmação de consulta ou qualquer outra função.

## Arquivos novos/alterados

- `app/api/interpretar-exame/route.ts` **(novo)** — chama a IA com o PDF e as regras do resumo, devolve o texto.
- `components/ConversationSidePanel.tsx` — botão "Analisar exame com IA", caixa de revisão editável e "Copiar texto" dentro do painel de anexo (`AttachmentItem`).

## Ordem segura de implantação

1. Configure `ANTHROPIC_API_KEY` no EasyPanel.
2. Suba o ZIP `crmobesity_deploy_v46.88_INTERPRETAR_EXAMES.zip`.
3. Teste com um PDF de exame de sangue real já anexado a alguma conversa: clique em "Analisar exame com IA", confira o resumo gerado (compare com os valores reais do PDF), edite se precisar, e teste o "Copiar texto".
