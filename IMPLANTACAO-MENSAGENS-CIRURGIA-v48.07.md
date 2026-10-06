# v48.07 — Mensagens automáticas de pré e pós-operatório

**1.** Rode `20260915_mensagens_cirurgia_v48_07.sql` no Supabase.
**2.** Suba o zip.
**3.** Leia a seção "Antes de ligar" aqui embaixo. **As mensagens vêm desligadas.**

## O que substitui

Hoje, quando a situação vira AUTORIZADA, o script da planilha escreve linhas
numa aba de agendamento e alguém copia e cola no WhatsApp. Agora a mensagem
entra na **mesma fila que o CRM já usa** para confirmação de consulta
(Agenda de Mensagens) e sai sozinha, pelo mesmo caminho.

A conta das datas é a mesma da planilha: pré na véspera, pós no dia seguinte.
Só que agora o *quando* é configurável — de 7 dias antes a 7 dias depois, no
horário que você escolher.

## Antes de ligar

Em **Configurações → Cad. Cirurgias → Mensagens** estão os dois modelos.

O texto que está lá é **um rascunho meu**. Não consegui reler os textos do seu
Apps Script (o computador estava desligado), então escrevi um de partida com
jejum, documentos, antecedência e sinais de alerta no pós. Quem conhece o tom
da clínica é você.

Leia, ajuste — ou cole o texto que já usa hoje — e só então marque "ligada".
Enquanto o modelo estiver desligado, nenhum paciente recebe nada.

Os campos entre chaves são trocados na hora do envio: `{primeiro_nome}`,
`{data}`, `{hora}`, `{hospital}`, `{cirurgiao}`, `{cirurgia}`, `{sigla}`,
`{paciente}` e `{whatsapp_cirurgiao}` — este último vira o link de WhatsApp do
cirurgião cadastrado em Cad. Cirurgias → Equipe. Cadastre os telefones dos três
cirurgiões lá, ou o texto cai para "o WhatsApp da clínica".

## O que testei

Rodei o fluxo inteiro num Postgres de verdade:

- cirurgia em AGENDAR → **nenhuma** mensagem criada
- mudou para AUTORIZADA → pré na véspera, pós no dia seguinte, texto preenchido
- **remarquei a cirurgia** → as duas antigas viraram "superseded" e duas novas
  nasceram nas datas certas
- **cancelei a cirurgia** → as pendentes viraram "cancelled"

Esse terceiro caso é o que mais importa: sem ele, o paciente de uma cirurgia
remarcada receberia orientação de jejum para a data antiga.

E mensagem já enviada nunca é reagendada — o passado não se remarca.

## Pendências de 30 dias

O `verificarPendencias`, que hoje é um botão que alguém precisa lembrar de
apertar, virou um filtro na lista de Cirurgias: **Pendências**. Mostra as
cirurgias em andamento lançadas há mais de 30 dias sem contato registrado.

O contador aparece no alto da tela, em âmbar, sempre que houver alguma. Cada
cartão traz a marca "sem contato há +30 dias" — clicando nela, o contato fica
registrado com data e hora (o ✔ da planilha, mas sabendo *quando*).

## Um ponto que você precisa conferir no n8n

As mensagens entram em `scheduled_messages` com `origin = 'cirurgia'`.

Se o seu fluxo do n8n que envia as mensagens agendadas **filtra por origin**,
ele vai ignorar as de cirurgia e elas ficarão paradas na fila. Se ele pega tudo
que está `scheduled` com a hora vencida, funciona sem tocar em nada.

Vale olhar antes de ligar os modelos. Se precisar, me diga o que o fluxo faz e
eu ajusto — pelo lado do CRM ou pelo do n8n.

## Próxima etapa

Sincronização CRM ↔ planilha.
