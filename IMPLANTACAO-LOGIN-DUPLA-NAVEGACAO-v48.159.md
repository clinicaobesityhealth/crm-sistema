# CRM Obesity v48.159 — Login: corrige "só entra na segunda tentativa"

## Problema relatado

No celular, ao fazer login com email e senha: a primeira tentativa parece
entrar e volta pra tela de login sozinha; só na segunda tentativa entra de
verdade.

## Causa provável

Depois de validar a senha, a própria tela de login buscava o perfil do
usuário e decidia pra onde navegar (`/inbox` ou `/pending`). Ao mesmo tempo,
o `AuthProvider` global (que fica ouvindo todo login da aplicação) fazia
**exatamente a mesma busca e a mesma navegação**, de forma independente.
Resultado: duas buscas do perfil e dois `router.replace` concorrentes depois
de um único login. Em rede mais lenta (celular), é mais fácil um atropelar o
outro e a navegação falhar na primeira vez.

## Correção

A tela de login não decide mais a navegação sozinha — só valida a senha e
mostra erro se a senha estiver errada. Quem navega agora é só o
`AuthProvider`, que já fazia essa checagem corretamente. Se por algum motivo
ele não navegar, o botão "Aguarde..." libera sozinho depois de 8 segundos
para tentar de novo, em vez de travar.

Arquivo alterado: `app/login/page.tsx`.

## Se ainda acontecer depois de subir esta versão

Vale testar uma vez numa aba anônima/privada do celular. Se lá funcionar de
primeira, o problema é uma sessão antiga guardada no navegador daquele
celular — nesse caso, limpar os dados do site do CRM nas configurações do
navegador (ou desinstalar/reinstalar se for atalho de tela inicial) resolve
de vez.

## Implantação

Suba o zip no EasyPanel como sempre. Não há SQL nem alteração de flow n8n
nesta versão.
