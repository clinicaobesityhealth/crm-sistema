# v48.19 — Bloqueio em Contatos e ordem das listas de cirurgia

**Sem SQL.** É só subir o zip.

## 1. Bloquear e desbloquear direto em Contatos

Na coluna Ações de cada contato há agora um botão de bloqueio. Ele muda de
cara conforme o estado: um **traço vermelho** para bloquear, um **escudo** para
desbloquear.

No seletor ao lado da busca, três opções: **Todos**, **Sem bloqueio** e
**Bloqueados (N)** — com a contagem ao lado, para você saber que existem antes
de procurar.

Contato bloqueado aparece com o nome esmaecido e uma marca vermelha
"bloqueado" logo abaixo, então dá para ver na lista sem filtrar.

Antes, bloquear só era possível dentro de um atendimento aberto, e desbloquear
só em Configurações → Contatos bloqueados. Quem não tinha conversa aberta com
o paciente não conseguia bloquear de jeito nenhum.

### Uma correção junto

A regra de bloqueio existia **duas vezes**, com código diferente: uma no
Atendimento (bloquear) e outra em Configurações (desbloquear). Duas cópias de
uma regra de segurança é como uma delas fica para trás — e aí o contato aparece
bloqueado numa tela e liberado na outra.

Agora é uma só, em `lib/bloqueio.ts`, usada pelas três telas. Ela faz as quatro
coisas que o bloqueio precisa fazer: marca o contato, cala a assistente de IA,
encerra a conversa soltando o responsável, e registra quem bloqueou e quando.

Detalhe preservado: o bloqueio guarda **como a assistente estava antes**. Sem
isso, desbloquear deixaria a IA calada para sempre num contato que ela atendia
normalmente.

## 2. Ordem das listas de cirurgia

**Em andamento** é uma agenda: da cirurgia **mais próxima para a mais
distante**. As sem data ficam no fim — não estão competindo por atenção, estão
esperando marcação.

**Realizadas e canceladas** são histórico: da **mais recente para a mais
antiga**.

Mesmo dia, ordena pelo horário. Sem data, ordena por nome — e sempre no fim,
nos dois sentidos: uma cirurgia sem data no topo do histórico seria tão fora de
lugar quanto no topo da agenda.

## 3. A coluna de telefone também parou de vazar

Mesmo defeito do nome, mesma correção: faltava deixar o conteúdo encolher para
o corte com reticências funcionar. Vale agora para telefone, Instagram e
origem, todos com o valor completo ao passar o mouse.

O duplo clique no divisor, que ajusta a coluna ao conteúdo, agora funciona
também nas colunas Tags e Origem.

---

# v48.20 — Os alertas da planilha dentro do cartão

Os mesmos emojis da coluna ALERTAS, calculados pelo CRM.

| Marca | Quando aparece |
|---|---|
| 😀 | em pré-operatório há menos de 1 mês |
| ⏰ | em pré-operatório há mais de 1 mês |
| 📅 | situação "Agendar" |
| 📞 | mais de 1 dia aguardando agendamento |
| 📜 | aguardando documentos |
| ⚠️ | faltam 5 dias úteis ou menos para o prazo de 21 dias úteis |
| ⌛ | ultrapassou os 21 dias úteis |
| 🚨 | pendência não resolvida |
| 🕵🏼 | relatório de pendência enviado |
| 😶 | paciente indeciso |
| ✔️ | autorizada |
| ❌ | cancelada ou negada pelo convênio |
| ~~riscado~~ | cirurgia realizada |

Passando o mouse, cada marca explica em palavras — e com número:
*"Em pré-operatório há mais de 1 mês (45 dias)"*, *"Faltam 3 dias úteis para
expirar o prazo"*. O botão **Legenda**, ao lado dos filtros, abre a lista
inteira.

## Três decisões

**Pode aparecer mais de uma marca.** Na planilha a coluna mostra uma só. Aqui a
situação e o relógio dos 21 dias são coisas diferentes: uma cirurgia em
pendência que está perto de estourar o prazo mostra 🚨 **e** ⚠️. Esconder uma
atrás da outra é exatamente o que faz um prazo passar batido.

**Os 21 dias são úteis de verdade**, não corridos. Contei dia a dia pulando
sábado e domingo. Contar corrido daria alarme cedo demais, e depois da terceira
vez ninguém mais confiaria nele.

**O relógio para quando deve parar.** Só corre enquanto a cirurgia aguarda
resposta (solicitada, em pendência, relatório enviado) e ainda não tem data de
autorização. Autorizada, negada, realizada ou cancelada, o prazo não corre mais.

## Duas coisas que preciso confirmar com você

**1. A partir de que data conto os 21 dias úteis?** Usei a **Data solicitado ao
hospital**. Se o prazo do convênio começa noutra data — a da solicitação ao
convênio, por exemplo — me diga e eu troco: é uma linha.

**2. O emoji de "ultrapassou 21 dias úteis" não veio na sua lista** (a linha
chegou sem o símbolo). Pus **⌛** provisoriamente. Se na planilha é outro, me
manda que eu ajusto.

## O que testei

Os treze casos, um por um, contra uma data fixa: cada situação com seu emoji,
a virada de 😀 para ⏰ em 30 dias, a de 📅 para 📞 em 1 dia, e o relógio do prazo
nos limites — 5 dias restantes, último dia, e estourado. A contagem de dias
úteis foi conferida à parte: 1 a 15 de setembro dá 10 dias úteis.
