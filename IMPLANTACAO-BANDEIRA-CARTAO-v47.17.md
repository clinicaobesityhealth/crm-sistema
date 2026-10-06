# v47.17 — Bandeira escolhida na hora da cobrança

## ⚠️ Rode o SQL primeiro

`supabase/migrations/20260913_bandeira_cartao_v47_17.sql` — adiciona uma coluna
na tabela de cobranças. Nada mais.

## 1. A secretária escolhe a bandeira

Sua ideia resolveu o problema que eu não tinha conseguido resolver. Em vez de
supor a bandeira mais cara e cobrar isso de todo mundo, a secretária pergunta ao
paciente qual cartão ele vai usar e escolhe na janela de cobrança:
**Visa/Master**, **Elo** ou **Amex**, cada uma com ícone.

O preço sai **exato** para aquela bandeira. Ninguém paga a mais, e a clínica não
recebe a menos.

Os ícones são desenhos geométricos nossos, nas cores de cada bandeira — não são
os logotipos oficiais, que são marcas registradas. Servem de apoio visual; o nome
ao lado é o que identifica.

## 2. As taxas agora são por bandeira

Em Configurações → Cobrança, a tabela de taxas tem três abas, já preenchidas com
o seu contrato (coluna online):

| | À vista | 2 a 6x | 7 a 12x |
|---|---|---|---|
| Visa/Master | 2,06% | 2,51% | 2,99% |
| Elo | 2,56% | 2,76% | 3,26% |
| Amex | 2,66% | 2,76% | 2,96% |

## 3. Um detalhe do contrato que vale saber

**O débito online é mais caro que o crédito à vista.** Na Visa/Master, 2,85%
contra 2,06%. Quer dizer: se o débito estiver habilitado na página e o paciente
escolher débito numa cobrança precificada como crédito à vista, a clínica recebe
menos.

O sistema já trata isso: quando o débito está entre os meios aceitos, a cobrança
de 1x usa a **maior** das duas taxas. Se você preferir, pode simplesmente
desmarcar Débito na configuração — o crédito à vista sai mais barato para todo
mundo.

## 4. Correção de um bug antigo que encontrei no caminho

Numa das listas do inbox havia uma referência a uma variável inexistente
(`activeContacts`). Como estava dentro de um `try`, o erro era engolido em
silêncio e a lista de participantes nunca carregava — por isso o menu às vezes
mostrava "Finalizar atendimento" onde deveria mostrar "Finalizar minha parte".
Corrigido.

## Como testar

1. Rode o SQL.
2. Suba o zip.
3. Configurações → Cobrança: confira as três abas de taxa e salve.
4. Na cobrança do cartão, escolha cada bandeira e veja o valor mudar.
5. Confira uma conta na mão: R$ 1.000 em 2x na Visa/Master, com antecipação de
   1,97% ao mês, deve dar R$ 1.057,81 (taxa efetiva de 5,46%).
