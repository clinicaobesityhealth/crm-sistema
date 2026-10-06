# v47.10 — Identificador do PIX com o paciente

## O que muda

No app do banco, o campo **Identificador** vinha como `***` — que no padrão do PIX
quer dizer "sem identificação". Agora ele leva o **código do paciente no MedX +
o primeiro nome**, por exemplo `12345JOSE`.

Isso aparece para o paciente na hora de pagar e, mais importante, **volta no
extrato do Safra**. Hoje a conferência é feita olhando valor e horário; com o
identificador dá para saber de quem foi cada PIX sem sair do extrato.

## Por que os dois juntos, e não só o nome

O padrão é rígido nesse campo: só letras e números, no máximo 25 caracteres.
Espaço, acento, ponto e hífen fazem o banco recusar o código — é por isso que não
dá para mandar "José Antônio Pereira" como está. O código do MedX resolve a
ambiguidade (dois "José" na agenda) e o primeiro nome deixa legível no extrato.

Exemplos reais do que é gerado:

| Paciente | MedX | Identificador |
|---|---|---|
| Maria da Silva | 12345 | `12345MARIA` |
| José Antônio Pereira | 12345 | `12345JOSE` |
| Ana Paula (sem MedX) | — | `ANA` |

Se o paciente não tiver nome nem código, volta para `***` e a cobrança funciona
igual.

## Como testar

1. Suba o zip no serviço **crm-obesity**.
2. Gere uma cobrança de R$ 1,00 para você mesmo.
3. No app do banco, o campo **Identificador** tem que mostrar o código + nome.

## Banco de dados

Nenhuma migração. Nada de SQL para rodar.

## Observação

O identificador não é guardado numa coluna própria da tabela `cobrancas_pix` — ele
vive dentro do código PIX. Quando formos fazer a tela de baixa das cobranças, vale
gravar ele separado para casar automaticamente com o extrato.
