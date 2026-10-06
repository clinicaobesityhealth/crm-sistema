# CRM Obesity v46.34

## Correções

- Ao clicar em Sair, fechar a aba ou fechar a janela, a secretária é marcada offline e a Sofia global é reativada.
- No celular, 30 minutos sem interação encerram a sessão. Ao retornar de uma tela suspensa, o tempo real decorrido é conferido e o usuário é enviado ao login.
- Uma sessão inexistente ou expirada não mantém a interface vazia: o CRM redireciona para o login.
- Ao iniciar ou assumir um paciente sem setor, o CRM procura e aplica o setor `Atendimento`.
- O agrupamento de segurança de registros antigos sem setor usa a cor verde em vez de preto/cinza.

## Migração

Execute no SQL Editor do Supabase:

`supabase/migrations/20260803_fix_mobile_logout_sofia_default_sector_v46_34.sql`

Ela move somente atendimentos ativos sem setor, ou ligados a um setor que não existe mais, para o setor `Atendimento`. Se esse setor não existir, a migração não altera registros.
