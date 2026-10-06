# Implantação — envio automático do resumo de exame pro MedX v46.90

## O que foi acrescentado

Completa a segunda parte do recurso de análise de exame por IA (a primeira, v46.88, já estava no ar). Agora, depois de gerar e revisar o resumo, dá pra clicar em **"Enviar ao MedX (Área Evolução)"** e o texto vai direto pra anotação clínica do prontuário — sem precisar copiar e colar manualmente. O botão "Copiar texto" continua ali como alternativa, caso o envio automático falhe por qualquer motivo.

**Importante — não mexi em nada do que já funciona.** O fluxo de anexar exame/documento (`Anexar Exame Medx`, botão "Adicionar ao prontuário MedX") continua exatamente igual, com o mesmo workflow n8n de sempre. O envio da anotação é um **workflow novo e separado** no n8n, só pra essa finalidade.

## Como funciona por baixo dos panos

Segue o mesmo padrão do fluxo de anexar exame que você já usa (login → ação → logout), usando o **mesmo usuário do MedX que a automação já usa hoje** (não o seu login pessoal):

1. CRM manda o resumo revisado pro novo webhook do n8n.
2. n8n faz login no MedX com o usuário da automação (mesma credencial já configurada no workflow "Anexar Exame Medx").
3. n8n grava a anotação na Área Evolução do prontuário do paciente.
4. CRM mostra "Anotação gravada" ou, se der erro, mostra a mensagem e você pode usar "Copiar texto" como plano B.

## Sobre a atribuição da anotação

Como o login é o da automação (o mesmo que já usa hoje pra anexar exame), a anotação fica registrada no MedX como tendo sido feita pela Sofia — igual ao que já acontece hoje quando qualquer pessoa da equipe anexa um exame por ali, só que lá isso não aparece porque quem "assina" no MedX é sempre a mesma conta, independente de quem clicou no CRM. Já ajustei o campo `Id_do_Usuario` com o ID correto da Sofia no MedX que você passou.

## Arquivos alterados

- `components/ConversationSidePanel.tsx` (componente `AttachmentItem`) — novo botão e função de envio, nada removido do que já existia.
- `n8n/tool-enviar-anotacao-medx-v46.90.json` (novo) — workflow pronto pra importar no n8n.

## Ordem segura de implantação

1. **No n8n**: crie um workflow novo (não mexa no "Anexar Exame Medx") → menu "⋯" no canto superior direito → **Import from File** → selecione `tool-enviar-anotacao-medx-v46.90.json`. Confira que o Webhook do novo workflow ficou com o path `tool-enviar-anotacao-medx` e **ative o workflow** (toggle "Inactive/Active" no topo).
   - Opcional, mas recomendado: copie o node **"Desconectar MedX1"** do workflow "Anexar Exame Medx" (clique nele → Ctrl+C → abra o workflow novo → Ctrl+V) e conecte ele depois do node "InsertMedicalHistory", pra fechar a sessão de login igual o outro fluxo já faz. Sem isso o recurso funciona do mesmo jeito, só não desloga explicitamente no final.
2. **No CRM**: suba o ZIP `crmobesity_deploy_v46.90_ENVIO_MEDX.zip` no EasyPanel (já contém tudo das versões anteriores).
3. **Teste**: abra a conversa de um paciente com exame em PDF anexado e já vinculado ao MedX → clique no exame → "Analisar exame com IA" → revise o resumo → **"Enviar ao MedX (Área Evolução)"**. Confira no prontuário do paciente (aba Evolução) se a anotação apareceu certinho, com os títulos em negrito.
4. Se der erro no passo 3, me manda a mensagem que aparece na tela (ou abre o node "InsertMedicalHistory" no n8n → aba Executions → última execução, e me manda o que aparecer lá) que eu ajusto.
