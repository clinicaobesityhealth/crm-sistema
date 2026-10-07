# v48.172 — Auditoria da pesquisa por IA de suspensão de medicamentos

## O que mudou (resumo para o Jorge)

1. **A IA agora busca de verdade na internet** antes de responder sobre
   suspensão de um medicamento (antes só respondia do que já sabia de
   memória — por isso nunca trazia referência real nem divergência).
2. Toda pesquisa volta um **motivo em linguagem simples** (não só o prazo),
   com as **fontes que ela realmente abriu agora** (links clicáveis) e um
   **selo de confiabilidade** (alta / média / baixa).
3. **Erro de digitação no nome é corrigido automaticamente** (ex.:
   "Coondroflex" → "Condroflex") — e isso agora é aplicado de verdade no
   cadastro, não só mostrado na tela e esquecido.
4. A janela roxa ("Auditoria da IA") passou a ficar fixa também quando você
   reabre o remédio depois — não só na hora da pesquisa.
5. O erro 502 que apareceu na Sinvastatina era, com grande chance, o nosso
   próprio sistema desistindo de esperar a IA (45 segundos) antes dela
   terminar a busca — uma busca de verdade mede entre ~1 e ~2 minutos. Esse
   tempo de espera subiu bastante (veja "Se o 502 voltar" abaixo).

## Passo 1 — Rodar a migração no Supabase

Abra o SQL Editor do Supabase do CRM (não o do PausaMed) e rode o arquivo:

```
supabase/migrations/20261007_auditoria_medicamentos_ia_v48_172.sql
```

Pode rodar mais de uma vez sem problema.

## Passo 2 — Publicar o código (GitHub Desktop)

1. Substitua a pasta do projeto pelo conteúdo deste zip (mantendo a pasta
   `.git` que já vem dentro — é o que faz o GitHub Desktop reconhecer que é
   a mesma versão e mostrar só o que mudou).
2. Abra o GitHub Desktop, confira as mudanças (os mesmos arquivos citados
   abaixo) e publique (commit + push) como sempre.
3. O deploy automático (EasyPanel) deve pegar a partir daí.

## Se o "Erro 502" voltar a aparecer

O tempo de espera do nosso lado subiu de 45s para quase 3 minutos — então,
se mesmo assim continuar dando 502, o próximo lugar para olhar é o
**tempo limite do proxy reverso do EasyPanel/Traefik** na frente do CRM e do
n8n (muitos vêm configurados com um padrão de 60 segundos, que cortaria a
conexão antes da IA terminar, mesmo com o nosso código esperando mais).
Quem administra o EasyPanel consegue aumentar esse limite lá.

## Testado ao vivo antes de entregar

Três cenários testados de verdade no workflow do n8n antes desta entrega:

- **"Coondroflex" (digitado errado)** → corrigiu para "Condroflex", achou o
  prazo (14 dias) e o motivo (risco de sangramento), com fontes reais.
- **"Sinvastatina"** (o caso que deu 502) → respondeu certo: não suspender,
  com o motivo (proteção cardiovascular) e fontes da ASA/AHA-ACC.
- **Nome inventado ("Xerplonitazatrix 500")** → corretamente devolveu "não
  encontrado", confiabilidade baixa, sem inventar nenhuma informação.

## Arquivos alterados nesta versão

- `supabase/migrations/20261007_auditoria_medicamentos_ia_v48_172.sql` (novo)
- `lib/pausamed.ts`
- `app/api/cirurgias/[id]/medicamentos/resolver/route.ts`
- `components/cirurgias/MedicamentosCirurgia.tsx`
- `components/cirurgias/CirurgiaModal.tsx` (botão de abrir prontuário)
- `components/ContactDetailModal.tsx` (botão de abrir prontuário)
- `app/contacts/page.tsx` (botão de abrir prontuário no nome e no balãozinho)
- Workflow n8n **"CRM - Pesquisar Remédio (IA)"** — já publicado direto no
  n8n, não precisa fazer nada aqui.
