# v47.06 — Cobrança PIX pelo CRM + Evolution escondido

## 1. Enviar cobrança via PIX (novo)

No menu do paciente, no Inbox, entra o item **"Enviar cobrança via PIX"**. Abre uma
janela com a logo do Banco Safra, campo de **valor** e uma **descrição opcional**.

Ao confirmar, o paciente recebe **três mensagens em sequência** pelo WhatsApp:

1. O **link** da página de pagamento (hospedada pelo próprio CRM)
2. A **imagem do QR Code**
3. O **PIX Copia e Cola** em texto

### Por que sem o meuairgo

A página do meuairgo não tem API: ela monta o código **no navegador do paciente**,
a partir de uma chave PIX estática. Não há cobrança registrada nem conciliação do
lado deles — o dinheiro simplesmente cai na conta. Como o padrão do BR Code é
público (manual do Banco Central), o CRM gera o mesmo código sozinho, sem depender
de site de terceiro, e ainda **registra a cobrança**.

### Como o código foi validado

- A estrutura gerada bate **caractere por caractere** com o exemplo publicado no
  manual do BR Code.
- O CRC16 confere com o vetor canônico do algoritmo (`"123456789"` → `29B1`).
- O QR gerado foi **decodificado de volta** e devolveu exatamente o mesmo código.
- O build de produção foi executado do zero (`npm install` + `npm run build`) e
  concluiu gerando todas as páginas.

### Página pública de pagamento

`/pagar/{id}` — mesmo molde da tela de confirmação de consulta: logo e cor da
clínica, valor em destaque, QR grande, botão **Copiar código PIX Copia e Cola** e
botão **Compartilhar link de pagamento**.

### Registro

Nova tabela `cobrancas_pix`: valor, descrição, código gerado, quem enviou, quando,
e campos para dar baixa depois (`status`, `pago_em`). Hoje não existe registro
nenhum de quanto foi cobrado de quem — isso passa a existir.

## 2. Configuração — Configurações → Cobrança PIX

Tela nova para a clínica informar **chave PIX, tipo, nome do recebedor, cidade e
banco**. Fica em `clinic_settings.pix_config`, **nunca no código**. A tela mostra
uma prévia de um código de R$ 1,00 para conferência.

## 3. Evolution escondido das configurações

Desde 08/09 todo o WhatsApp roda no WAHA. A seção do Evolution foi **escondida**
(não removida) na tela de Configurações → WhatsApp. Para voltar, é trocar
`SHOW_EVOLUTION_SECTION` para `true`. A instância segue conectada no servidor,
só com o webhook desligado.

## Arquivos

Novos:
- `lib/pixBrCode.ts`
- `app/api/cobranca-pix/route.ts`
- `app/api/cobranca-pix/[id]/route.ts`
- `app/pagar/[id]/page.tsx`
- `app/settings/pagamentos/page.tsx`
- `public/logo-safra.png`
- `supabase/migrations/20260912_cobranca_pix_v47_06.sql`

Alterados:
- `app/inbox/page.tsx` (item do menu + janela)
- `components/Sidebar.tsx` (link da configuração)
- `app/settings/whatsapp/page.tsx` (esconder Evolution)
- `package.json` (dependência `qrcode`)

Inclui também o **v47.05** (correção do Assistente de IA), que não chegou a ser subido.

## Ordem de implantação

1. **Rodar a migração** `supabase/migrations/20260912_cobranca_pix_v47_06.sql`
   no SQL Editor do Supabase.
2. Subir o zip no Easypanel (serviço `crm-obesity`).
3. Abrir **Configurações → Cobrança PIX** e preencher a chave.
4. **Teste obrigatório antes de usar com paciente:** gerar uma cobrança de
   R$ 1,00 para o seu próprio WhatsApp e conferir no app do banco se o nome do
   recebedor e o valor aparecem corretos.

---

# v47.07 — Ajustes depois do primeiro teste em produção

## 1. O QR não chegava no WhatsApp (corrigido no n8n, já no ar)

O WAHA aceitava o envio e devolvia id, por isso nada aparecia como erro. Mas o
fluxo montava o arquivo assim:

```
mimetype:  application/octet-stream     (deveria ser image/png)
filename:  "QR Code para pagamento de R$ 200,00"   (era a legenda, sem extensão)
```

O WhatsApp recebia como arquivo genérico sem extensão e não entregava.

**Isso não era só do PIX:** o trecho vale para toda mídia enviada pelo CRM — foto
ou PDF mandados pelo Inbox saíam com o mesmo defeito. Provavelmente ninguém
testou envio de mídia pelo CRM desde a migração para o WAHA.

Corrigido no node `Montar Payload WAHA` do `CRM - PRINCIPAL`: o tipo e o nome
passam a ser deduzidos da URL do arquivo (`.png` → `image/png`, `.pdf` →
`application/pdf`, etc.), com `application/octet-stream` só quando não há
extensão. **Já publicado** — não depende deste zip.

## 2. Descrições prontas na cobrança

Na janela de cobrança aparecem botões de atalho (Consulta presencial, Consulta
online, Cirurgia...). A lista é cadastrada em **Configurações → Cobrança PIX**,
onde dá para adicionar, editar e remover. O campo de digitação livre continua lá.

Além de poupar digitação, mantém a descrição padronizada — o que importa na hora
de conferir as cobranças depois.

## 3. Localização da clínica mudou de lugar

Saiu de **Configurações → WhatsApp** e foi para **Configurações → Feriados**.

Antes de mover, verifiquei quem lê esse dado: a própria tela de Feriados já
consultava `clinic_settings.cidade` para sugerir a cidade do feriado municipal.
Nenhum outro lugar do CRM usa. Ou seja, o dado agora mora onde é usado.

## Arquivos alterados nesta rodada

- `app/inbox/page.tsx` (atalhos de descrição)
- `app/settings/pagamentos/page.tsx` (cadastro das descrições)
- `app/settings/feriados/page.tsx` (localização da clínica)
- `app/settings/whatsapp/page.tsx` (localização removida daqui)
