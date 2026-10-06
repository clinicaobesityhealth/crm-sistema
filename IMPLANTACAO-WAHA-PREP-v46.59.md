# Implantação — preparação da instância WAHA (não ativa ainda) v46.59

_(atualizado: inclui também o fluxo de login por passkey/extensão Chrome)_

## O que é isso

Você pediu para preparar o suporte ao **WAHA** (a instância será `obesitycrm`) sem mudar nada no que já está funcionando. Este pacote faz exatamente isso: adiciona uma seção nova, separada e desligada por padrão, na tela **Configurações > WhatsApp** do CRM. Nada do fluxo atual (Evolution API, número da clínica em produção) é alterado.

**Nada aqui muda o WhatsApp que está em produção hoje.** Você pode subir esse deploy quando quiser, sem risco — a seção WAHA fica ali, pronta, esperando você configurar/usar quando decidir migrar.

**Base usada:** este pacote foi montado em cima do zip que você mandou (o que está realmente publicado em produção agora), com apenas as mudanças do WAHA aplicadas — nada mais foi tocado. Não inclui as mudanças de outra sessão (busca fonética, fix mensagem cancelada, fix ordem agenda, Instagram+Supabase) que estavam no pacote do Mac, já que aquelas nunca foram publicadas e não fazem parte do que está no ar hoje.

## O que foi adicionado

1. **Tela Configurações > WhatsApp**: nova seção "WAHA (em preparação)", separada visualmente (borda tracejada, cor âmbar) da seção da Evolution que já existe. Nela você pode:
   - Configurar URL, API Key e nome da instância (já vem sugerido `obesitycrm`).
   - Gerar QR Code e conectar um número de teste na instância WAHA (isso é isolado — não afeta o WhatsApp da clínica em produção).
   - Ver status da instância WAHA e desconectar quando quiser.
   - **Login por passkey**: alguns números pedem uma verificação extra do WhatsApp em vez do QR simples. Nesse caso a tela detecta automaticamente e mostra um botão pra baixar a extensão oficial da WAHA para o Chrome (ou, se já estiver instalada, um botão "fazer login" que completa a verificação). Isso segue o fluxo oficial documentado pela WAHA (extensão assina a verificação em web.whatsapp.com, já que o navegador só permite isso na origem certa).
   ⚠️ Este fluxo de passkey eu montei com base na documentação oficial da WAHA, mas **não consegui testar de ponta a ponta** (não tenho uma instância WAHA real rodando aqui). Vale testar com calma no dia da conexão real, antes de depender dele.

2. **Banco de dados (Supabase)**: 3 colunas novas em `clinic_settings` (`waha_url`, `waha_key`, `waha_instance`) — todas opcionais, não afetam nada existente.

## ⚠️ Importante — o que ISSO NÃO FAZ

Conectar a instância WAHA aqui **não muda quem envia/recebe as mensagens dos pacientes**. Isso continua 100% pela Evolution API através dos fluxos do n8n. Migrar de verdade exige, no dia que você decidir:

1. Atualizar os nós do n8n que hoje chamam a Evolution API (`n8n-evolution-api.5k3mqv.easypanel.host`) para chamar a WAHA no lugar. Os principais pontos identificados nos fluxos atuais:
   - Node **"Enviar via Evolution"** (workflow CRM - PRINCIPAL) — envio de mensagens (texto/mídia/áudio).
   - Node **"Buscar Foto WhatsApp"** — busca de foto de perfil do contato.
   - Node que resolve `whatsapp_lid` para telefone (`findContacts`).
   - O **webhook de recebimento** (que hoje espera o formato de eventos da Evolution: `messages.upsert`, `messages.update`, `messages.reaction`) precisa ser adaptado pro formato de eventos da WAHA.
2. Atualizar a URL/instância que o CRM usa para status/QR do número **em produção** (isso já existe hoje, na seção de cima da mesma tela — é só apontar pra WAHA quando for a hora).

Ou seja: este pacote deixa a peça do CRM pronta (a parte que dava pra preparar sem mexer em produção); o lado do n8n ainda precisa ser feito manualmente no dia da migração, com todo o cuidado de sempre (de preferência testando em horário de baixo movimento).

## Ordem segura de implantação

1. **Rode a migração SQL primeiro**, no SQL Editor do Supabase (projeto `CRM Obesity`):
   `supabase/migrations/20260818_waha_provider_prep_v46_59.sql`
   (Isso só adiciona colunas novas — não apaga nem altera nada existente.)
2. Depois, suba este ZIP no EasyPanel, do jeito de sempre.
3. Acompanhe o build — deve rodar normal (testei local aqui e o build completo passou sem erros, incluindo a página nova).
4. Depois do deploy, confira que a tela **Configurações > WhatsApp** continua mostrando o WhatsApp da clínica conectado normalmente (seção de cima, inalterada), e que agora aparece a seção "WAHA (em preparação)" mais embaixo.

## Nota sobre as mudanças do Mac (v46.54–v46.58)

Encontrei, numa outra sessão no seu Mac, um pacote mais avançado (v46.58) com funcionalidades que aparentemente nunca foram publicadas: busca fonética de contatos, fix da mensagem cancelada, fix da ordem da agenda/disparos, e colunas de Instagram+Supabase. Como você confirmou que o zip do Windows é o que está no ar, este pacote WAHA não inclui essas mudanças do Mac — mas elas continuam lá, prontas, caso você queira publicá-las em outro momento (é só avisar).

## Arquivos alterados/adicionados nesta versão

- Alterado: `app/settings/whatsapp/page.tsx`
- Adicionado: `supabase/migrations/20260818_waha_provider_prep_v46_59.sql`
- Nenhum outro arquivo foi tocado.
