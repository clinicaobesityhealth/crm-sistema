# Implantação — coluna de Instagram e atalho de agendar mensagem v46.52

## O que mudou

- Tela de Contatos: nova coluna "Instagram" ao lado de "Telefone", mostrando o nome da conta vinculada (verde) ou "Não vinculado" (cinza), usando o mesmo campo já usado no cadastro do contato (`custom_fields.ig_account_name`).
- Menu de atendimento (ícone "⋮" no topo da conversa, no Atendimentos): novo item "Agendar mensagem", que abre o mesmo modal de novo disparo da Agenda de Mensagens já com o paciente da conversa pré-selecionado.

## O que foi preservado

- Nenhuma lógica de vinculação de Instagram ou de envio de mensagens foi alterada — só a exibição na tela de Contatos e um atalho para o modal que já existia na Agenda de Mensagens.
- Nenhuma migração de banco é necessária.

## Observação importante

A coluna de Instagram vai mostrar "Não vinculado" para contatos que hoje já recebem/enviam mensagens por Instagram mas não têm o campo `ig_account_name` preenchido — isso é esperado e é justamente o problema que ainda estou investigando (item separado, meu diagnóstico até agora: o vínculo automático/manual do Instagram não está preenchendo esse campo corretamente).

## Arquivos alterados

- `app/contacts/page.tsx`
- `app/inbox/page.tsx`
- `app/agenda/page.tsx` (exportou o modal de novo disparo para reuso)

## Ordem segura de implantação

1. Suba o ZIP no EasyPanel (mesmo processo já usado nas versões anteriores).
2. Confira: coluna "Instagram" na tela de Contatos, e o item "Agendar mensagem" no menu "⋮" de uma conversa aberta em Atendimentos.
