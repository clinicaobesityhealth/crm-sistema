# CRM Obesity v48.166 — a causa real do erro do Rodrigo, achada e corrigida

## O que eu descobri

Testei ao vivo (puxei direto do fluxo que busca o agendamento do Rodrigo, igual
o CRM faz) e o resultado foi:

```
modalidade: "1"           ← não é a palavra presencial/online, é um código
retorno:    "Sem retorno" ← mas no MedX está "COM RETORNO"
```

Esse "1" não é nem um palpite impreciso — é o **"tipo de consulta" interno do
MedX** (um ID tipo "Retorno"/"Avaliação"/"Exame"), que não tem nenhuma relação
com presencial/online. Em algum momento esse código acabou rotulado de
"modalidade" dentro da integração, por engano.

Você então me disse uma coisa que fechou a investigação: **vocês já escrevem
"PRESENCIAL"/"ONLINE" e "COM RETORNO"/"SEM RETORNO" na Descrição do
agendamento no MedX, exatamente pra não depender de código**. Fui conferir — e
o MedX manda sim essa Descrição completa pro nosso sistema
("RODRIGO DE ALMEIDA GOMES, PRESENCIAL, COM RETORNO, Dr(a). JOÃO JORGE, Nº
prontuário 154, 5511982662409"). O problema é que, até agora, o fluxo que
sincroniza os agendamentos **só aproveitava o nome do paciente** desse texto e
jogava fora o resto — então a palavra "PRESENCIAL, COM RETORNO" que vocês
escrevem à mão nunca chegava a lugar nenhum no CRM.

## O que mudei

**No código do CRM (este zip):** a tela agora lê esse texto da Descrição
assim que ele estiver disponível, e confia nele mais do que no código
numérico — exatamente a ordem de prioridade que já fazia sentido pro que você
descreveu. Também adicionei:

- **Correção manual de "Com/Sem retorno"**, igual já existia pra cobrança: se
  sair errado de novo por qualquer motivo, clica uma vez e fica salvo pra
  sempre (no cadastro do paciente, aba MedX).
- **O emoji 💻/📍 agora também aparece no cadastro do paciente** (aba MedX,
  "Próximo agendamento" e "Outros agendamentos"), igual já tinha na Agenda
  Médica.

**Falta um pedaço fora do código** (2 ajustes pequenos no n8n + 1 comando no
banco) pra Descrição realmente chegar até aqui — os passos estão abaixo. São
rápidos, bem mais simples que o do Prontuário.

## Importante: isso é só a partir de agora, pra frente

Esse ajuste faz a Descrição ser capturada **nos próximos agendamentos que
forem sincronizados do MedX** (a sincronização roda a cada 15 min, e olha com
alguns dias de antecedência — então a maioria das consultas vai pegar isso
bem antes de alguém precisar olhar a agenda). **Não corrige retroativamente**
agendamentos que já foram sincronizados antes desse ajuste — é o caso do
Rodrigo hoje.

**Pro agendamento do Rodrigo de hoje especificamente**, o jeito mais rápido
(não depende de nenhum deploy, já funciona agora): abra o cadastro dele →
aba MedX → clique em "Presencial" e corrija o retorno pra "Com retorno" — uma
vez só, fica salvo.

## Passo a passo (uns 2 minutos, sem mexer em login/senha)

### 1) Banco de dados (Supabase → SQL Editor)

```sql
-- Guarda o texto literal da Descrição do agendamento no MedX (a frase que
-- vocês já escrevem à mão: "PRESENCIAL, COM RETORNO" etc.)
alter table agendamentos add column if not exists descricao_medx text;

-- Correção manual de retorno, mesmo esquema que já existe pra cobrança.
create table if not exists agendamento_retorno_overrides (
  id uuid primary key default gen_random_uuid(),
  medx_agendamento_id text not null unique,
  contact_id uuid references contacts(id),
  retorno text not null check (retorno in ('Com retorno','Sem retorno')),
  justificativa text,
  updated_by_agent_id uuid,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
```

### 2) n8n — workflow "Sync MedX -> Agendamentos (Secretaria)"

1. Abra esse workflow, clique no node **"Sincronizar Avulsos MedX ->
   Supabase"** (não precisa editar login nem senha, não aparece em lugar
   nenhum nesse pedaço).
2. Dentro do código, procure por (use Ctrl+F no editor do node):
   ```
   tipo: String(tipoConsulta),
   ```
3. Logo depois dessa linha, adicione:
   ```
   descricao_medx: ag.Descricao || null,
   ```
4. Salve. Não precisa ativar nada — o workflow já está ativo.

### 3) n8n — workflow "tool_buscar_agendamento_planilha"

1. Abra esse workflow, clique no node **"Code in JavaScript"**.
2. Procure a primeira ocorrência de:
   ```
   modalidade: item.tipo || "",
   com_retorno: normalizar(comRetornoRaw) === "SIM" ? "Com retorno" : "Sem retorno",
   ```
   (dentro da função `montarUltima`) e adicione logo abaixo:
   ```
   descricao_medx: item.descricao_medx || null,
   ```
3. Procure a segunda ocorrência (mais abaixo, no `return encontradosProximos.map(...)`):
   ```
   modalidade: item.tipo || "",
   retorno: normalizar(item.com_retorno) === "SIM" ? "Com retorno" : "Sem retorno",
   ```
   e adicione logo abaixo também:
   ```
   descricao_medx: item.descricao_medx || null,
   ```
4. Salve.

Pronto — não precisa duplicar workflow nem mexer em credencial nenhuma dessa
vez, é só isso.

## Implantação

1. Rode o SQL acima no Supabase.
2. Faça os 2 ajustes no n8n acima.
3. Suba este zip (v48.166) no EasyPanel como sempre.

### Uma dúvida sobre a v48.165

Reparei que, pelos seus prints mais recentes, o Rodrigo ainda aparecia como
ONLINE mesmo depois da v48.165 (que já tinha tirado o palpite por número) — e,
testando agora, o código atual *deveria* mostrar nada (sem sugestão) nesse
caso, não ONLINE. Pode confirmar se o rebuild da v48.165 chegou a terminar no
EasyPanel antes de testar? Vale subir esta v48.166 (que já inclui tudo da
v48.165) e dar um Ctrl+Shift+R na tela antes de testar de novo, só pra
garantir que não é cache do navegador.
