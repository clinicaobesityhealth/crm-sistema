# Implantação — correção da foto quebrada dos contatos v46.89

## O bug

Em Contatos (e em alguns outros lugares que mostram a fotinho do paciente), quando o `avatar_url` salvo no contato apontava pra uma imagem que não carrega mais (link expirado do WhatsApp, foto removida, etc.), a tela mostrava o ícone de imagem quebrada em vez de cair pras iniciais — foi o caso do Thiago Esteves Candido Dias que você reportou.

Causa: o código só decidia "mostra foto ou mostra iniciais" olhando se existia uma URL salva (`avatar_url`), sem checar se essa imagem realmente carregava no navegador. Se a URL existia mas o carregamento falhava, não tinha nenhum fallback — ficava quebrado.

## O que foi corrigido

Criei um componente único de avatar (`components/ContactAvatar.tsx`) que tenta carregar a foto e, se o carregamento falhar (`onError`), cai automaticamente pras iniciais coloridas — igual já acontecia quando não tinha foto nenhuma cadastrada.

Apliquei esse componente em todos os lugares do sistema que mostram foto de contato, porque todos tinham exatamente o mesmo problema:

- **Contatos** (lista principal)
- **Inbox** — lista de conversas, cabeçalho da conversa aberta, e balõezinho de mensagem recebida
- **Painel de atendimento do paciente** (`ConversationSidePanel`) — cabeçalho
- **Cadastro do contato** (`ContactDetailModal`)
- **Histórico do contato** (`ContactHistoryModal`)

## O que foi preservado

- Nenhuma mudança em como as fotos são buscadas, salvas ou exibidas quando carregam normalmente — visualmente é idêntico.
- Nenhuma mudança em banco de dados, MedX, WhatsApp ou qualquer integração.
- As cores e as iniciais de fallback continuam calculadas do mesmo jeito de sempre.

## Arquivos alterados

- `components/ContactAvatar.tsx` (novo)
- `app/contacts/page.tsx`
- `app/inbox/page.tsx`
- `components/ConversationSidePanel.tsx`
- `components/ContactDetailModal.tsx`
- `components/ContactHistoryModal.tsx`

## Ordem segura de implantação

1. Suba o ZIP `crmobesity_deploy_v46.89_FOTO_CONTATO_FALLBACK.zip` no EasyPanel — já contém tudo das versões anteriores (v46.86, v46.87, v46.88) mais essa correção.
2. Teste: abra Contatos e procure o Thiago Esteves Candido Dias (ou outro contato com foto quebrada) — deve aparecer as iniciais dele em vez do ícone quebrado.
3. Confira rapidamente um contato com foto que funciona normalmente (em Contatos e no Inbox) — a foto precisa continuar aparecendo normal.
