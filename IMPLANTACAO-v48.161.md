# CRM Obesity v48.161 — 4 ajustes pedidos

## 1) Agenda Médica — preto para quem o paciente não confirmou + emoji online/presencial

Na grade (Dia/Semana), um horário ocupado agora aparece em duas cores:
- **Verde/brand (como já era)** — o paciente confirmou pelo link de WhatsApp (`patient_confirmed_at`).
- **Preto (novo)** — o paciente ainda não confirmou.

Antes, a cor "ocupado" dependia só do status vindo do MedX (`status = 'Confirmada'`
ou `'Realizada'`), que não tem relação com o paciente ter respondido ao link —
por isso toda consulta marcada parecia igual, confirmada ou não.

Também foi trocado o ícone pequeno de modalidade pelo emoji 💻 (online) ou
📍 (presencial), direto no card do horário, para bater o olho sem precisar abrir.

## 2) Modal da consulta — "Confirmada" não é mais sobre o MedX

Ao clicar num horário ocupado, o selo grande agora mostra:
- 🟢 **Paciente confirmou** (verde) — quando `patient_confirmed_at` está preenchido.
- ⚪ **Paciente ainda não confirmou** (cinza) — quando não está.
- (Se o paciente respondeu que não vem pelo link, aparece "Paciente respondeu que não vem".)

O status do MedX (o que antes aparecia como "Confirmada" e confundia) virou um
textinho pequeno no canto: **"MEDX ok"** quando está em ordem, ou o status bruto
quando não está.

## 3) Contatos — campo de busca maior no celular

No celular, a busca dividia a linha com os três filtros e ficava minúscula.
Agora ela ocupa a linha inteira, com fonte maior, e os filtros vêm numa linha
própria embaixo (rolando na horizontal se precisar). A partir de telas maiores
(tablet/desktop), volta a ficar tudo numa linha só, como antes.

## 4) Editar cirurgia — "Mensagem ao paciente" unificada

As duas seções "Mensagens ao paciente" (cartas: autorização, solicitação ao
hospital...) e "Mensagens de pré e pós-operatório" (agenda automática), que
ficavam separadas com a descrição cirúrgica no meio, viraram **um campo só**:

- O que já foi **enviado** aparece verdinho, só para conferir (sem editar —
  já saiu).
- O que ainda está **agendado** (pré-op, pós-op, retorno, suspensão de
  remédio) agora pode ser clicado para **cancelar**, direto ali — antes isso
  só dava para fazer rolando até o outro cartão.
- O que está **pendente de decisão** (uma carta aguardando aprovar o texto e
  mandar) continua clicável para editar e enviar, como já era.
- O botão "Programar mensagens de pré e pós" (para cirurgias antigas, de antes
  dos modelos automáticos) continua existindo, só aparece quando realmente não
  tem nada agendado ainda.

Os dois componentes antigos (`MensagensDaCirurgia.tsx`, `MensagensEnviadas.tsx`)
foram deixados no projeto, só não são mais chamados — nada foi apagado,
só trocado pelo novo `MensagemAoPaciente.tsx`.

## Implantação

Suba o zip no EasyPanel como sempre. Não há SQL nem alteração de flow n8n
nesta versão — os quatro ajustes são só de tela, usando campos que já existiam
no banco (`patient_confirmed_at`, `patient_declined_at`, `scheduled_messages`,
`cirurgia_avisos`).
