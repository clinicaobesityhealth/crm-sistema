# CRM Obesity v46.46 — fix: Configurações inteira quebrando (ícone inexistente)

## Problema

Desde a v46.45 (tela de Cargos), abrir qualquer aba de Configurações
(Aparência, Atendentes, Tags, Setores etc.) resultava em:

  Application error: a client-side exception has occurred (see the browser
  console for more information).

Console mostrava `Error: Minified React error #130` (tentativa de renderizar
um componente `undefined`).

## Causa

O item de menu "Cargos" (`components/Sidebar.tsx`) e a própria tela de Cargos
(`app/settings/job-titles/page.tsx`) importavam o ícone `IdCard` de
`lucide-react`. A versão instalada no projeto (`lucide-react@^0.383.0`) **não
tem** um ícone com esse nome — só foi adicionado em versões mais novas da
lib. Resultado: `IdCard` chegava `undefined` em runtime.

Como o item "Cargos" faz parte do menu lateral **compartilhado por todas as
telas de Configurações**, o crash derrubava a seção inteira, não só a tela de
Cargos.

## Correção

Trocado `IdCard` por `Contact` (ícone que existe na versão instalada e
representa bem "cargo/pessoa") em:
- `components/Sidebar.tsx` (ícone do item de menu "Cargos")
- `app/settings/job-titles/page.tsx` (ícone usado na lista e no estado vazio
  da própria tela)

Nenhuma outra mudança. Confirmado que não há mais nenhuma referência a
`IdCard` no projeto.
