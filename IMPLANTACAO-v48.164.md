# CRM Obesity v48.164 — cores da grade + modalidade vinda do MedX

## 1) Cores da grade da Agenda Médica

- **Ocupado (paciente confirmou)**: antes usava a cor da marca da clínica
  (que aqui está configurada como um verde bem escuro — de longe parecia
  preto). Trocado por um verde claro fixo, que não depende da cor da marca.
- **Ocupado (paciente não confirmou)**: era preto, agora é **vermelho claro**
  — mais fácil de diferenciar de "confirmado" e mais intuitivo como "atenção,
  falta confirmar".

A legenda no topo da grade já reflete as cores novas.

## 2) Presencial/Online: agora também vem do MedX

Até aqui, "Presencial"/"Online" era um campo só manual — alguém da equipe
precisava clicar para marcar, e enquanto ninguém clicava, não aparecia nada
(nem na grade, nem no modal). Era o caso da Bruna Polidoro: presencial no
MedX, mas sem ninguém ter clicado ainda no CRM, então a grade não mostrava o
📍 e o modal mostrava os dois botões (Presencial/Online) sem nenhum marcado.

Agora, quando ninguém marcou manualmente ainda, a tela usa a modalidade que
o MedX já informa (a mesma busca que já trouxe "Com/sem retorno" e
"Cobrar/não cobrar" na v48.162):

- **Na grade**: o emoji (💻/📍) aparece mesmo sem ninguém ter clicado.
- **No modal**: o botão correspondente (Presencial ou Online) já aparece
  destacado, com um textinho "Sugestão do MedX — clique para confirmar"
  embaixo, pra ficar claro que é uma sugestão e não algo que alguém já
  confirmou. Clicar nele grava normalmente no cadastro, como sempre foi.
- Se alguém já marcou manualmente antes, isso continua valendo — a sugestão
  do MedX só aparece quando o campo manual está vazio.

## Implantação

Suba o zip no EasyPanel como sempre. Não há SQL nem alteração de flow n8n
nesta versão.
