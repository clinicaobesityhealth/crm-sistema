# CRM Obesity v48.163 — Prontuário completo + resumo por IA

## O que foi adicionado

**Prontuário** agora aparece em dois lugares:

1. **No menu do paciente** (painel lateral da conversa) — nova aba "Prontuário".
2. **Na Agenda Médica** — botão "Ver prontuário" dentro do card de uma consulta ocupada.

A tela mostra:

- **Alergias sempre destacadas no topo**, em vermelho.
- Botão **"Resumir com IA"** — lê todo o histórico de evolução do MedX e monta um
  resumo: data da 1ª e da última consulta, **exames em ordem** (ex: "EDA out/26",
  "USc abr/26"...) com o resultado anotado, **medicamentos em uso**, **conduta da
  última consulta** (o que foi decidido/orientado), **antecedentes** (patologias
  prévias, trocas de medicação ao longo do tempo) e **cirurgias já realizadas**.
- Botão **"Abrir no MedX"** — abre a página de login do MedX numa aba nova
  (o endereço que você passou).
- **Histórico completo** de evolução (todas as anotações, mais recente primeiro),
  disponível em "Ver histórico completo de evolução", caso queira conferir o
  texto original de qualquer anotação.

O resumo por IA é gerado só quando você clica no botão (não é automático) — assim
não gasta IA toda vez que alguém só quer dar uma olhada rápida nos exames/alergias.

## Como foi feito (e por que falta um passo seu)

O MedX tem dois endereços novos que você me passou (`GetProntuarioPage` e
`GetMedicalHistorySummary`), além do "resumir com IA" que é tudo novo.

- **A parte de IA eu já criei e já publiquei no n8n** sozinho: workflow
  **"CRM - Resumir Prontuario (IA)"**, usando a mesma IA (Gemini) que já usamos
  para as sugestões de mensagem no CRM. Não precisa fazer nada aqui.
- **A parte que busca no MedX eu não posso fazer eu mesmo.** Esses dois
  endereços novos exigem login no MedX, e esse login (usuário/senha) já existe
  configurado dentro de alguns workflows do n8n — mas eu não tenho permissão de
  tocar nesse login nem de reproduzi-lo em um workflow novo (é uma regra de
  segurança do meu lado, para nunca haver risco de esse tipo de credencial
  aparecer em algum lugar errado). Então preciso que você faça esse pedaço,
  copiando/colando — é rápido, o login em si você não precisa digitar nem ver,
  só duplicar um workflow que já funciona.

### Passo a passo (uns 3-4 minutos)

1. No n8n, abra o workflow **"Enviar resumo exames MedX (Área Evolução)"**.
2. No menu "..." (três pontinhos, canto superior direito), clique em
   **Duplicate**. Isso abre uma cópia nova, com os mesmos nós (incluindo o
   login no MedX, que fica intacto).
3. Renomeie essa cópia para **"CRM - Buscar Prontuario MedX"** (clique no nome
   no topo).
4. Clique no node **"Webhook"** (o primeiro) e troque o campo **Path** para:
   ```
   tool-buscar-prontuario-medx
   ```
5. Apague os nós **"InsertMedicalHistory"** e **"Respond Success"** (clique em
   cada um, tecla Delete). **Não toque** em "Login MedX2" nem em
   "Desconectar MedX" — esses ficam exatamente como estão.
6. Clique numa área vazia do canvas (fora de qualquer node) e cole (Ctrl+V /
   Cmd+V) o conteúdo abaixo. O n8n vai criar 3 nós novos automaticamente
   ("Buscar Prontuario", "Buscar Resumo Clinico", "Responder Prontuario"):

   ```json
   {
     "nodes": [
       {
         "parameters": {
           "method": "GET",
           "url": "https://care-app65.medx.med.br/api/prontuario/GetProntuarioPage",
           "sendQuery": true,
           "queryParameters": {
             "parameters": [
               { "name": "PacId", "value": "={{ $('Webhook').first().json.body.pacId }}" },
               { "name": "page", "value": "={{ $('Webhook').first().json.body.page || 1 }}" },
               { "name": "pageSize", "value": "={{ $('Webhook').first().json.body.pageSize || 50 }}" }
             ]
           },
           "sendHeaders": true,
           "headerParameters": {
             "parameters": [
               { "name": "Authorization", "value": "=Bearer {{ typeof $('Login MedX2').first().json === 'string' ? $('Login MedX2').first().json : ($('Login MedX2').first().json.data ?? $('Login MedX2').first().json) }}" }
             ]
           },
           "options": {}
         },
         "id": "a1b2c3d4-aaaa-4aaa-8aaa-000000000001",
         "name": "Buscar Prontuario",
         "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2,
         "position": [736, -224]
       },
       {
         "parameters": {
           "method": "GET",
           "url": "https://care-app65.medx.med.br/api/prontuario/GetMedicalHistorySummary",
           "sendQuery": true,
           "queryParameters": {
             "parameters": [
               { "name": "Pacid", "value": "={{ $('Webhook').first().json.body.pacId }}" }
             ]
           },
           "sendHeaders": true,
           "headerParameters": {
             "parameters": [
               { "name": "Authorization", "value": "=Bearer {{ typeof $('Login MedX2').first().json === 'string' ? $('Login MedX2').first().json : ($('Login MedX2').first().json.data ?? $('Login MedX2').first().json) }}" }
             ]
           },
           "options": {}
         },
         "id": "a1b2c3d4-aaaa-4aaa-8aaa-000000000002",
         "name": "Buscar Resumo Clinico",
         "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2,
         "position": [976, -224]
       },
       {
         "parameters": {
           "respondWith": "json",
           "responseBody": "={{ { historico: $('Buscar Prontuario').first().json.Items, resumoClinico: $('Buscar Resumo Clinico').first().json } }}",
           "options": {}
         },
         "id": "a1b2c3d4-aaaa-4aaa-8aaa-000000000003",
         "name": "Responder Prontuario",
         "type": "n8n-nodes-base.respondToWebhook",
         "typeVersion": 1.1,
         "position": [1216, -224]
       }
     ],
     "connections": {
       "Buscar Prontuario": { "main": [[{ "node": "Buscar Resumo Clinico", "type": "main", "index": 0 }]] },
       "Buscar Resumo Clinico": { "main": [[{ "node": "Responder Prontuario", "type": "main", "index": 0 }]] }
     }
   }
   ```

7. Agora é só ligar as pontas (arrastar uma linha da bolinha de saída de um
   node até a bolinha de entrada do outro):
   - **Login MedX2** → **Buscar Prontuario**
   - **Responder Prontuario** → **Desconectar MedX**
8. Salve e **ative** o workflow (botão no canto superior direito).
9. Pronto — pode testar abrindo a aba "Prontuário" de um paciente que já tenha
   sido sincronizado com o MedX, ou o botão "Ver prontuário" na Agenda Médica.

**Se der erro ao testar:** o mais provável é o método da chamada (GET vs POST)
ou o nome do campo de paciente (`PacId` vs `Pacid` vs `pacId`) estar diferente
do que esses dois endereços esperam — as letras maiúsculas/minúsculas variam
de um endpoint do MedX para outro, como no próprio exemplo que você me mandou
("PacId" num, "Pacid" no outro). Me manda a mensagem de erro que aparecer no
n8n (clique no node que ficou vermelho → "Error") e eu ajusto o texto para
você colar de novo, sem precisar refazer o resto.

## Onde fica guardado o token de IA

O resumo por IA usa a mesma credencial Gemini que já estava configurada no
n8n para as sugestões de mensagem — nenhuma chave nova foi criada.

## Implantação

Suba o zip no EasyPanel como sempre. Depois de implantado, só funciona de
ponta a ponta depois que o passo a passo acima (no n8n) for feito — até lá,
a tela mostra "não foi possível buscar o prontuário".
