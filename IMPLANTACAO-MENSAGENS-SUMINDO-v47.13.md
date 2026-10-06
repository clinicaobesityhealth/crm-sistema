# v47.13 — As mensagens que apareciam e sumiam

## A causa

A conversa do contato de teste passou de **500 mensagens** hoje (chegou a 513). E
o CRM pedia ao banco exatamente isto:

> "me dê 500 mensagens deste contato, **da mais antiga para a mais nova**"

Enquanto a conversa tinha menos de 500, o limite nunca era alcançado e ninguém
percebeu. Ao passar de 500, o corte passou a ser **pelo fim**: chegavam as 500
mais antigas e as recentes ficavam de fora.

O que você viu era a soma de dois comportamentos:

- o **realtime** acrescentava a mensagem nova na tela assim que ela era gravada —
  por isso ela **aparecia**;
- qualquer recarregamento da conversa substituía a lista pelas 500 antigas — por
  isso ela **sumia**.

Isso explica tudo: o "Oi" que chegou ao paciente e desapareceu, a resposta do
paciente que não apareceu, e as mensagens do PIX. **Nenhum dado foi perdido** —
conferi no banco, todas as mensagens estão gravadas na conversa certa.

Não teve relação com o Supabase que desligamos no servidor (o CRM sempre falou com
o Supabase da nuvem) nem com a limpeza de disco.

## A correção

- Agora o CRM pede as **500 mais recentes** (ordem decrescente) e inverte para
  exibir. O limite continua existindo — ele protege o tráfego do Supabase — mas
  passa a cortar o passado distante, que é o certo, e não o presente.
- **Falha de consulta não apaga mais a tela.** Antes, se a consulta desse erro de
  rede, o código tratava o resultado vazio como "a conversa não tem mensagens" e
  limpava tudo. Agora, em caso de erro, a tela mantém o que já estava.
- O mesmo corte invertido foi aplicado ao **histórico do contato** (a janela de
  200 mensagens), que tinha o mesmo defeito à espera.

## Também nesta versão (da v47.12, caso não tenha ficado no ar)

- Conferência de segurança a cada 15 segundos na conversa aberta, para o caso de o
  realtime cair — o que acontece a cada deploy do CRM.
- Identificador do PIX com o **nome completo** do paciente.
- Logo do Safra maior na janela de cobrança.

## Como testar

1. Suba o zip no **crm-obesity**.
2. Abra a conversa do teste (a que tem mais de 500 mensagens).
3. As mensagens de hoje têm que aparecer — e **continuar lá** depois de um F5.
4. Mande um "oi" pelo CRM e responda pelo celular: os dois lados aparecem e ficam.

## Banco de dados

Nenhuma migração.
