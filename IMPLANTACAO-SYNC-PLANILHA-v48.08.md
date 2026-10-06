# v48.08 — Sincronização com a planilha: carga inicial

Esta versão faz **metade** da sincronização, de propósito: traz a planilha para
o CRM e **não escreve nada de volta**. A volta vem depois que você conferir que
a ida ficou certa.

O motivo é simples. Essa planilha alimenta a contabilidade. Um erro de
mapeamento na direção CRM → planilha escreveria por cima do que a contabilidade
lê, e a gente descobriria pelo lado errado. Já a direção planilha → CRM não
toca em nada da planilha: se vier errado, apaga-se no CRM e tenta de novo.

## Passo 1 — SQL e zip

1. Rode `20260915_sync_planilha_v48_08.sql` no Supabase.
2. Suba o zip no EasyPanel.

## Passo 2 — a chave de sincronização

A rota de sincronização escreve no banco da clínica, então ela exige uma chave.

1. **Invente uma chave longa** — 32 caracteres ou mais, letras e números
   misturados, sem espaço. Não precisa ser bonita, precisa ser difícil de
   adivinhar. Um gerador de senha serve.
2. No **EasyPanel**, no serviço do CRM → Environment, adicione:
   `CIRURGIA_SYNC_TOKEN=<sua chave>` e reinicie o serviço.
3. No **n8n**, em Settings → Variables (ou nas variáveis de ambiente do serviço
   do n8n), crie a mesma `CIRURGIA_SYNC_TOKEN` com o mesmo valor.

Enquanto a chave não existir no CRM, a rota responde
*"Sincronização não configurada"* — de propósito, para não haver endereço
aberto escrevendo no banco.

## Passo 3 — importar o fluxo no n8n

Importe `n8n/CRM - SINCRONIZAR CIRURGIAS - v48.08.json`.

Ele usa a credencial **Google Sheets dr joao jorge**, que você já tem — pode ser
que o n8n peça para reassociar depois da importação. Nenhuma autorização nova é
necessária.

O fluxo tem gatilho **manual**. Nesta etapa é isso mesmo: você aperta, olha o
resultado, decide.

## Passo 4 — rodar e conferir

Execute o fluxo. O último nó, **Resumo**, mostra:

- `linhas_lidas_na_planilha`
- `cirurgias_criadas_no_crm`
- `ja_existiam_ignoradas`
- `erros` e `detalhe_dos_erros`

Depois, abra **Cirurgias** no CRM, filtro **Todas**, e confira contra a
planilha: nomes, datas, situações, valores. É esta conferência que autoriza a
segunda metade.

## O que o CRM faz com cada linha

**Linha que ele ainda não conhece** vira cirurgia nova. A sigla vira
procedimento, o hospital e o cirurgião viram os cadastros correspondentes, a
situação vira situação, e a frase da equipe ("2 AUXILIARES, 1 INSTRUMENTADOR")
vira números.

**Linha que ele já conhece** é ignorada — reconhecida pelo id ou, nas antigas
que ainda não têm id, por nome + data da cirurgia. Rodar o fluxo duas vezes não
duplica nada.

**O paciente é procurado no cadastro** pelo telefone e depois pelo nome exato.
Se não achar, a cirurgia entra sem vínculo e aparece na lista com a marca
"sem cadastro", para alguém ligar depois. **O CRM não cria contato a partir da
planilha** — inventar cadastro com texto digitado é como uma base se enche de
duplicados.

**Valores vindos da planilha entram como manuais.** Um valor que já foi
combinado com o paciente não pode ser substituído pelo cálculo automático.

**O carimbo original vem junto**, então a regra das pendências de 30 dias conta
do dia certo, e não do dia da importação.

## Sobre as abas REALIZADAS e CANCELADAS

Você pediu para trazer tudo, e é o que faremos — mas não às cegas. Preciso
conferir se essas duas abas têm as colunas na mesma ordem da CIRURGIAS. Se a
ordem for diferente e eu importar assim, cada campo cai no lugar errado, em
silêncio.

Rodamos a CIRURGIAS primeiro (que é a que a contabilidade lê), eu confiro o
layout das outras duas, e aí incluo.

## O que vem depois

Conferida a carga, a segunda metade: o CRM passa a escrever de volta na aba
CIRURGIAS, com o fluxo rodando sozinho. A linha nunca muda de aba — a
contabilidade lê a CIRURGIAS, então realizada e cancelada continuam lá, com a
situação dizendo o que houve.

Para isso a planilha vai ganhar **uma coluna nova no fim (AE)** com o id do
CRM. Ela vai no fim justamente para não deslocar nenhuma coluna existente nem
quebrar fórmula da contabilidade.
