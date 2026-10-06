# Implantação — link de confirmação de consulta pelo paciente v46.86

## O que foi acrescentado

- A mensagem automática de confirmação de consulta (a mesma que já existia, 1 dia antes às 10:00 por padrão) agora vem com um **link clicável**: `crm.obesityhealth.com.br/confirmar/<id>`.
- Página pública nova (sem precisar de login) onde o paciente vê a data/hora da consulta e escolhe:
  - **"Sim, vou comparecer"** → marca a consulta como confirmada pelo paciente.
  - **"Não vou poder, quero remarcar"** → marca a recusa, move a conversa pro setor **Atenção** e avisa a equipe. Se a Sofia estiver ativa para aquele contato, ela também manda uma mensagem oferecendo já ir vendo novos horários; se a Sofia estiver pausada, só o aviso interno mesmo (remarcação manual).
- No painel do paciente (aba MedX), o card da próxima consulta e a lista de outras consultas agora mostram um selo verde **"Confirmado pelo paciente ✓"** ou amarelo **"Paciente não poderá comparecer"**, conforme o caso.
- De brinde: o selo "Retorno agendado" (dos lembretes de exame/retorno) também ficou mais visível — antes era só um emojizinho solto, hoje é um selo com fundo, igual aos novos.

## O que foi preservado (não mudou)

- A coluna `status` de `agendamentos` continua **exclusivamente** sob controle do sync automático com o MedX. O "Confirmado pelo paciente" é um indicador **separado** (colunas novas `patient_confirmed_at` / `patient_declined_at`), só um selo visual a mais — não interfere em nada que já dependia de `status`.
- Toda a lógica de quando/quanto tempo antes enviar o lembrete, idempotência, cancelamento por remarcação etc. continua idêntica — só o texto da mensagem ganhou uma linha a mais com o link.
- `sofia_paused` do contato não é tocado por este fluxo. Se a Sofia já estava ativa numa conversa, continua ativa depois da recusa (diferente do "Assumir/Transferir" manual do Inbox, que sempre pausa a Sofia — aqui não).
- Nenhum workflow do n8n foi alterado. A leitura/gravação da confirmação roda inteiramente numa rota nova do próprio CRM (`app/api/confirmacao/[id]`), sem depender de nenhuma automação adicional no n8n.

## Arquivos novos/alterados nesta versão

- `lib/supabaseAdmin.ts` **(novo)** — cliente Supabase com a chave `service_role`, usado só no servidor (nunca no navegador).
- `app/api/confirmacao/[id]/route.ts` **(novo)** — API que a página de confirmação usa (GET carrega os dados da consulta, POST registra confirmação/recusa).
- `app/confirmar/[id]/page.tsx` **(novo)** — a página pública que o paciente vê ao clicar no link.
- `lib/supabase.ts` — tipo `Agendamento` ganhou os campos `patient_confirmed_at` e `patient_declined_at` (só tipagem, sem mudança de comportamento).
- `components/ConversationSidePanel.tsx` — carrega os dois novos campos e mostra os selos "Confirmado pelo paciente ✓" / "Paciente não poderá comparecer" / "Retorno agendado" (mais visível).
- `supabase/migrations/20260826_patient_confirmation_link_v46_86.sql` **(novo)** — colunas novas + a mensagem do lembrete ganhando o link.
- `lib/AuthContext.tsx` — **correção adicionada depois do teste do dia 26/08**: o app tem um guarda de login global que redireciona qualquer página sem sessão pra `/login` (só a própria `/login` era exceção). Isso derrubava a página pública de confirmação, que precisa funcionar sem o paciente estar logado. Adicionei `/confirmar/*` como segunda exceção — nada mais mudou nesse arquivo, login/logout/sessão dos atendentes continuam exatamente iguais.

## ⚠️ Passo obrigatório antes do deploy: variável de ambiente

Este é o primeiro recurso do CRM que precisa da chave `service_role` do Supabase (a chave "master", que ignora as permissões normais — por isso mora só no servidor, nunca é enviada pro navegador).

1. No painel do Supabase: **Project Settings → API → Project API keys → service_role** (é uma chave longa, secreta — diferente da `anon` que o CRM já usa).
2. No EasyPanel, no serviço do CRM: adicione a variável de ambiente `SUPABASE_SERVICE_ROLE_KEY` com esse valor.
3. Sem essa variável configurada, o CRM continua funcionando normalmente em tudo o mais — só a página de confirmação mostra uma mensagem de "indisponível no momento" em vez de quebrar o resto do sistema.

## Ordem segura de implantação

1. Configure a variável `SUPABASE_SERVICE_ROLE_KEY` no EasyPanel (passo acima) **antes** de subir o ZIP, ou logo em seguida — sem ela a página de confirmação não funciona, mas nada mais é afetado.
2. Suba o ZIP `crmobesity_deploy_v46.86_CONFIRMACAO_PACIENTE.zip` no EasyPanel, do mesmo jeito de sempre.
3. Depois que o deploy concluir e o app novo estiver no ar, **só então** execute no Supabase SQL Editor a migração `supabase/migrations/20260826_patient_confirmation_link_v46_86.sql`.
   - **Por quê nessa ordem:** a migração é o que faz o link passar a aparecer nas mensagens. Se ela rodar antes do app novo estar no ar, os links seriam enviados apontando pra uma página que ainda não existe em produção.
   - A migração também atualiza o conteúdo dos lembretes que já estão agendados (ainda não enviados) pra consultas futuras, pra que ganhem o link também, sem precisar esperar uma nova sincronização do MedX.
4. Teste um link de verdade (veja abaixo) antes de considerar publicado pra valer.

## Testes obrigatórios (faça antes de avisar a equipe)

1. **Link chega na mensagem:** depois de rodar a migração, crie ou edite uma consulta futura (ou espere o próximo lembrete natural) e confira que a mensagem de confirmação enviada ao paciente inclui o link `https://crm.obesityhealth.com.br/confirmar/<id>`.
2. **Abrir o link:** cole a URL de um `id` de consulta real no navegador (sem estar logado) e confira que a página abre normalmente, mostrando a data/hora certas.
3. **Confirmar:** clique em "Sim, vou comparecer" → a página deve mostrar a tela de sucesso, e no painel do paciente (aba MedX) deve aparecer o selo verde "Confirmado pelo paciente ✓" no card da consulta. A coluna `status` da consulta **não deve mudar**.
4. **Recusar com Sofia ativa:** escolha um contato com a Sofia ativa, use um link de confirmação dele e clique em "Não vou poder". Confira que: a conversa foi pra o setor Atenção, apareceu um aviso interno no histórico, e chegou uma mensagem da Sofia oferecendo remarcar.
5. **Recusar com Sofia pausada:** repita com um contato de Sofia pausada — deve ir pro setor Atenção e aparecer só o aviso interno, sem mensagem automática ao paciente.
6. **Clicar duas vezes:** clique em confirmar (ou recusar) de novo no mesmo link — não deve duplicar mensagem nem repetir a transferência de setor.
7. **Link de consulta cancelada:** teste com o `id` de uma consulta cancelada — a página deve avisar que consta como cancelada, mas ainda permite responder (só por segurança, caso seja engano do sync).
8. **Nada quebrou:** confira que o sync com o MedX, a confirmação automática por status e o restante do fluxo de agenda continuam funcionando exatamente como antes.

## Reversão

Se precisar desligar rapidamente só o link (sem reverter o app inteiro):

```sql
-- Volta a mensagem de confirmação a sair sem o link, sem remover nada do banco.
```

Não existe um "desfazer" automático da função, porque ela foi recriada por cima da versão anterior. Se precisar voltar exatamente ao texto de antes, me avise que eu preparo a migração de reversão (reaplicando o `v_content` da v46.49) — não fiz isso preventivamente aqui pra não deixar SQL não testado no pacote.

Pra desligar o recurso por completo sem mexer no banco, basta não subir esta versão do app (ou voltar pra uma anterior) — as colunas novas (`patient_confirmed_at`/`patient_declined_at`) ficam paradas no banco sem afetar nada, mesmo sem o app usá-las.
