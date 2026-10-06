# Administrador em atendimento ativo — v46.25

- Administradores entram imediatamente em uma conversa já atribuída, sem solicitar autorização.
- O responsável original permanece como titular e continua vendo o atendimento normalmente.
- O administrador é incluído em `conversation_participants`.
- O histórico recebe o aviso interno: `Administrador(a) Nome entrou na conversa`.
- Entrar novamente não duplica a participação nem o aviso.
- Usuários comuns continuam usando a solicitação de participação ou transferência.
- Administradores mantêm leitura dos setores exclusivos ao participar da conversa.
