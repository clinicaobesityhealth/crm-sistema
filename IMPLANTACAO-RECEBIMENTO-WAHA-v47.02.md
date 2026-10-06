# v47.02 — Migração do recebimento para o WAHA (em duas etapas)

Hoje: instalar em **modo observação** (risco zero, nada muda).
Amanhã: virar a chave, testar, e só então desligar a Evolution.

---

## Por que precisa de um adaptador

O WAHA e a Evolution descrevem a mesma mensagem de formas diferentes. Dois pontos
são críticos:

**1. O telefone do paciente não vem no campo óbvio.**

Numa mensagem de entrada real, o WAHA manda:

```
from                  : 253519185576031@lid      <- código anônimo, NÃO é telefone
_data.Info.Chat       : 253519185576031@lid
_data.Info.SenderAlt  : 5511940460907@s.whatsapp.net   <- o telefone real está aqui
_data.Info.PushName   : Lilica
```

Quem lesse `from` (que é o campo natural) identificaria **todo paciente por um código
anônimo** — o vínculo com o cadastro, com o MedX e com o histórico quebraria em massa.
O adaptador lê `SenderAlt` e só cai no `Chat` quando ele não é um `@lid`.

**2. A mídia vem como link interno, não como arquivo.**

```
media.url : http://localhost:3000/api/files/crmobesity/2AF016ADC8BE1D946117.jpeg
```

Esse endereço só existe **dentro** do container do WAHA — o n8n não alcança. E o CRM
espera o arquivo em base64 (é como a Evolution entrega). Sem tratar isso, foto de exame,
PDF e áudio chegariam vazios, **sem erro visível**. O adaptador reescreve para o endereço
público, baixa com a chave e converte.

---

## Etapa 1 — hoje (modo observação, não muda nada)

### 1.1 Importar o fluxo

n8n → **Workflows** → seta ▾ ao lado de *Create Workflow* → **Import from File** →
`n8n/CRM - WAHA INBOUND ADAPTER - v47.02.json`

### 1.2 Colar a chave do WAHA

Abrir o nó **"Baixar Midia (base64)"** e trocar, na primeira linha do código:

```js
const CHAVE_WAHA = 'COLE_AQUI_A_CHAVE_DO_WAHA';
```

pela chave real (dá para copiar do nó **"Enviar via WAHA"** do CRM - PRINCIPAL).

### 1.3 Publicar e ativar

**Publish** e deixar o workflow **ativo**.

> Ele já nasce em `MODO = 'observacao'`: traduz tudo e registra, mas **não entrega**
> nada ao CRM. Nesta etapa é impossível ele atrapalhar o atendimento.

### 1.4 Mandar o WAHA enviar uma cópia

No painel do WAHA → sessão `crmobesity` → engrenagem → **adicionar um segundo webhook**
(ao lado do "Webhook 1" que já existe — **não substituir** o atual):

- **URL:** `https://n8n-n8n.5k3mqv.easypanel.host/webhook/waha-inbound`
- **Eventos:** `message` e `message.any`

Salvar (a sessão reinicia sozinha, sem QR).

Pronto. A partir daí o adaptador recebe uma cópia de tudo e vai acumulando evidência a
noite toda, enquanto o atendimento continua normalmente pela Evolution.

---

## O que observar até amanhã

Nas execuções do adaptador, cada mensagem deve mostrar:

| campo | esperado |
|---|---|
| `telefone_resolvido` | `true` |
| `telefone` | o número real do paciente |
| `hash` | o código da mensagem |
| `tem_midia` / `midia_ok` | `true` / `true` quando houver anexo |
| `midia_bytes` | tamanho > 0 |

**Sinais de alerta** (me avise se aparecer):

- `telefone_resolvido: false` → apareceu um caso em que o WAHA não entrega o telefone
- `midia_ok: false` → o download da mídia falhou (o campo `midia_erro` diz o motivo)
- `motivo: "sem_id_de_mensagem"` → formato inesperado

---

## Etapa 2 — amanhã (a virada)

**Só fazer depois de conferir a observação da noite.**

1. No nó **"Traduzir WAHA para formato CRM"**, trocar uma palavra:
   ```js
   const MODO = 'observacao';   →   const MODO = 'producao';
   ```
   **Publish.**

2. No painel do WAHA, **remover o webhook antigo** (`/webhook/waha-message-ack` continua;
   o que sai é a duplicidade de entrada, se houver) — na prática: garantir que só o
   adaptador esteja recebendo `message` / `message.any`.

3. **Desligar o recebimento da Evolution** (webhook da instância `recados`), para a
   mensagem não entrar duas vezes e a Sofia não responder em dobro.

4. **Testar em conversa de teste, nesta ordem:** texto → foto → PDF → áudio →
   paciente novo (número que não está na agenda). Só considerar migrado depois que os
   cinco passarem.

### Como voltar atrás (30 segundos)

1. `MODO = 'observacao'` + **Publish**
2. Religar o webhook da Evolution

Volta na hora ao estado de hoje. A configuração da Evolution está de volta em
**Configurações → WhatsApp** no CRM (v47.01), para reconectar pelo QR se a sessão
dela tiver caído.

---

## O que este adaptador NÃO faz (de propósito)

- **Reações, edições e mensagens apagadas** continuam pela Evolution. São secundárias e
  cada uma tem seu próprio formato; entram depois, com calma.
- **Avisos de leitura** continuam no fluxo `CRM - WAHA Ack Status`, que já funciona.
- **Grupos** não foram testados. Se a clínica usa algum grupo, avisar antes da virada.
