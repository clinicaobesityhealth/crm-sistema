# v47.12 — Conversa que congela na tela, identificador pelo nome e logo do Safra

## 1. O problema sério: mensagem que não aparecia

**Nada foi perdido.** Conferi no banco: a sua mensagem "Oi" (16:22), a "Ola"
(16:23), as duas do paciente (16:24 e 16:25) e a resposta da Sofia (16:25) estão
todas gravadas, na mesma conversa, sem contato duplicado. O problema era a tela.

**Por que aconteceu.** O CRM depende do realtime do Supabase — um websocket — para
mostrar mensagem nova sem recarregar a página. Esse websocket cai sozinho em três
situações comuns: quando o CRM é reimplantado (foi o caso: você acabara de subir a
v47.11 com a aba aberta), quando o computador dorme, e em qualquer oscilação de
rede. Quando ele cai, **a conversa aberta para de receber e não avisa**. A mensagem
chega no WhatsApp, é gravada no banco, a Sofia responde — e a tela fica parada.

A lista de conversas já se recuperava ao voltar para a aba; a conversa aberta, não.

**A correção.** O realtime continua sendo o caminho rápido. O que entrou foi uma
conferência de segurança: a cada 15 segundos, e só com a aba à vista, o CRM
pergunta se existe algo mais novo do que a última mensagem na tela. Não é
recarregar a conversa inteira — é uma consulta pequena, filtrada pelo horário da
última mensagem, de propósito para não pesar no plano do Supabase. Além disso,
ao voltar para a aba (ou ao clicar na janela), a conversa aberta agora também é
conferida, não só a lista.

Na prática: mesmo que o websocket caia, a mensagem aparece em até 15 segundos.

**Sobre "ficou como lida antes de ser lida":** o "lida" do CRM vem do aviso de
leitura do próprio WhatsApp. No seu teste você estava com a conversa aberta no seu
celular, então o WhatsApp mandou o aviso de leitura de verdade. Vale reparar se
acontece de novo com paciente real — aí é outro caso e a gente investiga com o
dado na mão.

## 2. Identificador do PIX: nome completo

Saiu o código do MedX. O "Identificador" que aparece no app do banco e volta no
extrato agora é o **nome completo do paciente**:

| Paciente | Identificador |
|---|---|
| Maria da Silva | `MARIADASILVA` |
| José Antônio Pereira | `JOSEANTONIOPEREIRA` |
| Maria Fernanda Albuquerque Cavalcanti | `MARIAFERNANDAALBUQUERQUE` |

O padrão do PIX só aceita letras e números, no máximo 25 caracteres — por isso sem
espaço e sem acento. Quando o nome não cabe, o corte é feito **entre palavras**, e
não no meio de uma, para o extrato continuar legível.

## 3. Logo do Safra

Aumentado de 40 para 64 pixels de altura na janela de cobrança.

## Banco de dados

Nenhuma migração.
