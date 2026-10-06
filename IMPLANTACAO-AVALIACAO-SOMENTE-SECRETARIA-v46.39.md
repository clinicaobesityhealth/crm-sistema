# CRM Obesity v46.39 — avaliação do Google somente pela secretaria

## Regra

A pergunta **“Deseja enviar o link de avaliação do Google para o paciente?”** agora aparece somente quando quem encerra definitivamente o atendimento possui o cargo **Secretária** ou **Secretário** no cadastro de usuários.

- Administradores sem esse cargo finalizam sem a pergunta.
- Médicos e demais usuários finalizam sem a pergunta.
- Se ainda houver outra pessoa no atendimento, a secretária encerra apenas sua participação e o link não é oferecido, pois a conversa continua ativa.
- Uma secretária que também seja administradora continua recebendo a pergunta, porque a verificação é feita pelo cargo.

Não há SQL nem alteração de flow n8n nesta versão.
