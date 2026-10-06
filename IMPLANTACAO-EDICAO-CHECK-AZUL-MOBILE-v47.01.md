# v47.01 — Edição de mensagem, check azul e rolagem no mobile

Três problemas, três causas diferentes. Abaixo o que cada um era e o que fazer.

---

## 1. Editar mensagem nunca funcionou de verdade

**A causa:** o CRM nunca falava com o WhatsApp. Ao editar, ele fazia só duas coisas:

1. trocava o texto na tabela `messages` (só no banco do CRM);
2. gravava um "pedido de edição" na tabela `message_edits` com `status: 'pending'`.

Só que **nada lia a tabela `message_edits`** — não existe fluxo no n8n que a consuma, e a
tabela sequer tem migration no projeto. O aviso *"Mensagem editada (enviando ao
WhatsApp...)"* era enganoso: nada era enviado. Por isso o texto mudava no CRM e continuava
o antigo no celular do paciente.

**A correção:** o CRM agora chama um fluxo novo no n8n, que chama a API do WAHA de verdade
— mesmo padrão que as reações já usavam. E o aviso na tela passou a ser honesto: se o
WhatsApp recusar, aparece *"Editada no CRM, mas NÃO no WhatsApp"* com o motivo.

### Limites do próprio WhatsApp (não são do CRM)

- Só dá para editar até **~15 minutos** depois do envio. Depois disso o WhatsApp recusa.
- Só mensagens de **texto** enviadas por você.
- O motor da sessão do WAHA precisa suportar edição. Se o motor atual (GOWS) não suportar,
  o fluxo devolve a mensagem *"o motor atual do WhatsApp (WAHA) não suporta edição"* — e aí
  a saída é trocar o motor da sessão para **NOWEB** (exige ler o QR code de novo, uma vez).

---

## 2. Check azul (status de leitura) não acendia

**A causa:** quando o envio migrou da Evolution API para o WAHA, o formato do ID da
mensagem mudou:

| origem | formato do ID |
|---|---|
| Evolution (antigo) | `3EB08F9B4A31AB0B599BAE` |
| WAHA | `true_5511999999999@c.us_3EB08F9B4A31AB0B599BAE` |
| WAHA (hoje, com LID) | `true_81866522669304@lid_3EB08F9B4A31AB0B599BAE` |

O CRM grava em `messages.external_id` o ID que o WAHA devolve no envio. Mas o aviso de
"entregue"/"lida" chega depois com o ID em **outro** formato. Como a função do banco
comparava o ID inteiro, ela nunca achava a mensagem: respondia 200, atualizava **zero**
linhas, e o check ficava cinza para sempre.

O `@lid` é um identificador anônimo novo que o WhatsApp passou a usar no lugar do número
de telefone em várias conversas. É uma mudança do WhatsApp/WAHA, não do CRM.

**A correção:** o pedaço final do ID (o hash da mensagem) é igual em todos os formatos.
A função nova `bump_message_status_by_hash` acha a mensagem por esse pedaço e repassa para
a `bump_message_status` que já existe — que continua sendo a única dona da regra de
"status nunca retrocede". Nada do que já existe foi alterado.

Isso conserta os **dois** caminhos ao mesmo tempo: o novo (WAHA) e o antigo (Evolution),
que ainda está ativo e disparando. Ou seja, vira redundância.

---

## 3. Tela de mensagens rolando de lado no celular

**As causas** (`app/inbox/page.tsx`):

- a lista de mensagens tinha `overflow-y-auto` sem `overflow-x-hidden` — pelo padrão do
  CSS, isso deixa o eixo horizontal rolável;
- os botõezinhos de ação (reagir/responder/editar) ficam invisíveis mas **ocupam largura**;
  somados ao avatar e ao balão de 70%, estouravam a largura da tela;
- os balões não quebravam palavras longas (um link grande furava o limite).

**A correção:** `overflow-x-hidden` na lista, `min-w-0` nos balões (deixa encolher),
`break-words` + `whitespace-pre-wrap` no texto. De brinde, o `whitespace-pre-wrap` faz as
quebras de linha das mensagens do WhatsApp voltarem a aparecer.

---

# Como aplicar

## Passo 1 — Banco (Supabase)

Supabase → **SQL Editor** → cola o conteúdo de
`supabase/migrations/20260831_status_leitura_por_hash_v47_01.sql` → **Run**.

Cria só uma função nova. Não altera dados nem a função existente.

## Passo 2 — n8n: importar o fluxo de edição

1. n8n → **Workflows** → botão **⋯** (canto superior direito) → **Import from File**
2. escolhe `n8n/CRM - EDITAR MENSAGEM WHATSAPP - v47.01.json`
3. abre o nó **"Editar no WAHA"** → no header `X-Api-Key`, troca
   `COLE_AQUI_A_CHAVE_DO_WAHA` pela chave real
   (dá para copiar do nó **"Enviar via WAHA"** do fluxo CRM - PRINCIPAL)
4. **Publish** e deixa o fluxo **ativo**

## Passo 3 — n8n: apontar o status para a função nova

Trocar a URL em **dois** nós — é só o final da URL que muda:

de  `.../rest/v1/rpc/bump_message_status`
para `.../rest/v1/rpc/bump_message_status_by_hash`

| fluxo | nó |
|---|---|
| CRM - WAHA Ack Status (Leitura WhatsApp) | `Atualizar Status da Mensagem (Ack)` |
| CRM - PRINCIPAL | `Atualizar Status da Mensagem1` |

No fluxo *WAHA Ack Status*, o nó `Buscar Mensagem por Hash` fica desnecessário depois
disso (a função do banco já faz a busca) — pode deixar ou remover, não atrapalha.

**Publish** nos dois.

## Passo 4 — CRM

Deploy do zip `crm-obesity-v47.01-edicao-check-mobile.zip` como de costume.

---

# Como testar

**Check azul:** manda uma mensagem pelo CRM → abre no celular do destinatário → o check
tem que ficar azul e **continuar** azul. (Se o destinatário desativou a confirmação de
leitura no WhatsApp dele, o check azul nunca vem — é regra do WhatsApp.)

**Edição:** manda uma mensagem pelo CRM, edita **dentro de 15 minutos** → o texto tem que
mudar no celular do paciente, com a marca "editada" do próprio WhatsApp. Se aparecer
*"o motor atual do WhatsApp (WAHA) não suporta edição"*, me avisa: aí a saída é trocar o
motor da sessão para NOWEB.

**Mobile:** abre uma conversa no celular e tenta arrastar a tela para os lados — não pode
mais mexer.
