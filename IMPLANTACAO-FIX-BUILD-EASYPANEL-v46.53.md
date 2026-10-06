# Implantação — correção do erro de build no EasyPanel v46.53

## O que aconteceu

O deploy no EasyPanel estava falhando no passo `pnpm i --frozen-lockfile` com o erro:

```
ERROR  packages field missing or empty
```

Isso aconteceu porque o projeto tinha um arquivo `pnpm-workspace.yaml` (deixado de uma configuração antiga) sem a lista de pacotes exigida. O EasyPanel, ao detectar esse arquivo junto com um `pnpm-lock.yaml`, tentou instalar as dependências usando `pnpm` como se este fosse um "workspace" (monorepo) — o que este projeto nunca foi. O projeto sempre usou `npm` (é isso que o `package.json` e o `Dockerfile` do projeto sempre indicaram).

Isso quer dizer que **os pacotes v46.51 (Agenda de Mensagens) e v46.52 (coluna Instagram + atalho Agendar mensagem) nunca chegaram a ir para produção** — o build falhava antes de gerar a nova versão do app. Ou seja, essas duas melhorias ainda não estão no ar.

## O que foi corrigido

- Removidos os arquivos `pnpm-workspace.yaml` e `pnpm-lock.yaml` do projeto (não deveriam estar lá).
- Build local testado do zero (`npm install` + `npm run build`) e concluído com sucesso, gerando as 30 páginas normalmente.
- Nenhuma alteração de código/funcionalidade — só a limpeza desses arquivos de configuração de build.

## Importante — sobre a tela de log que você me mandou

Reparei que o log do EasyPanel que você colou mostra, em texto puro, a senha do e-mail de envio (`SMTP_PASSWORD`) e a chave pública do Supabase. Isso é normal aparecer no log de build (não é uma falha de segurança do sistema), mas como boa prática, sugiro trocar essa senha de SMTP depois que tudo estiver estabilizado, já que ela ficou visível na tela.

## Ordem segura de implantação

1. Suba este ZIP (`crm-obesity-v46.53.zip`) no EasyPanel, do mesmo jeito de sempre.
2. Acompanhe o log de build — agora deve rodar `npm install` e `npm run build` sem o erro de `pnpm`.
3. Depois que o deploy concluir, confira:
   - Agenda de Mensagens funcionando normalmente (v46.51).
   - Coluna "Instagram" na tela de Contatos e item "Agendar mensagem" no menu de atendimento (v46.52).

## Arquivos alterados nesta versão

- Removidos: `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- Mantém todas as mudanças das versões v46.51 e v46.52 (Agenda de Mensagens, coluna Instagram em Contatos, atalho "Agendar mensagem")
