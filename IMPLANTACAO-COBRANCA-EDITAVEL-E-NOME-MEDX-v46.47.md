# CRM Obesity v46.47 — data/hora formatadas, cobrança editável, nome sempre igual ao MedX

## 1. Data e hora no padrão brasileiro

Na aba MedX do atendimento, as datas/horas vindas do MedX apareciam no formato
cru (`2026-08-08` e `09:30:00`, com segundos). Agora aparecem como
`08/08/2026 às 09:30` em todos os três lugares onde a aba mostra
agendamento: próximo agendamento em destaque, lista "Outros" e "Última
consulta".

Implementado com duas funções pequenas (`formatDataBR`, `formatHoraBR`) que
só reformatam texto — não usam `Date`, então não têm risco de problema de
fuso horário com datas "soltas" (sem horário/timezone).

## 2. Cobrança (COBRAR / NÃO COBRAR) agora é editável, com justificativa

A etiqueta "COBRAR"/"NÃO COBRAR" ao lado de cada agendamento (calculada a
partir do que o MedX manda) agora é clicável. Ao clicar, abre um pequeno
formulário pra trocar o valor e **exige uma justificativa** (ex: "a última
consulta foi a cirurgia, esta é o retorno"). Depois de salvar, a etiqueta
some (é usada essa correção manual em vez do valor calculado) e aparece um
texto pequeno "Alterado por FULANO: <justificativa>" logo abaixo, visível
sempre que alguém abrir aquele agendamento de novo.

### Como foi guardado
Tabela nova no Supabase, `agendamento_cobranca_overrides`:
- `medx_agendamento_id` (chave, um registro por agendamento do MedX)
- `contact_id`, `cobranca`, `justificativa`
- `updated_by_agent_id` / `updated_by_name` (quem alterou)
- `updated_at`

Ao abrir a aba MedX, além de buscar os agendamentos no MedX, o CRM busca se
existe alguma correção manual salva pra cada `medx_agendamento_id` e, se
existir, ela prevalece sobre o valor calculado automaticamente.

## 3. Nome do contato sempre segue o MedX

Antes, ao vincular um contato ao MedX (aba MedX > Buscar no MedX), o CRM só
preenchia campos que estavam vazios (nascimento, sexo, endereço etc.) e
nunca tocava no nome. A partir de agora, **o nome cadastrado no CRM
(`contacts.full_name`) é sempre atualizado com o nome do MedX** quando o
contato está vinculado (tem `medx_id`), porque o MedX é a fonte de verdade
oficial e evita confusão de ter nomes diferentes em cada lugar (ex: "Gisele
Pompeu" no CRM vs "Gisele Pompeu Silva" no MedX).

Só não atualiza se o MedX mandar um nome vazio ou visivelmente quebrado
(com "?" no lugar de acento, problema conhecido de encoding do MedX).

## Arquivos alterados
- `components/ConversationSidePanel.tsx` (as três mudanças acima)

## Migração de banco necessária
Já aplicada diretamente no Supabase de produção (tabela
`agendamento_cobranca_overrides` criada). Nada a fazer na hora do deploy
além de subir este zip.
