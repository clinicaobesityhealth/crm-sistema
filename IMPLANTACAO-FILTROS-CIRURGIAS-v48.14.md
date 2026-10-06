# v48.14 — Filtros por hospital, cirurgião e cirurgia (e o mistério das 30)

**Sem SQL.** É só subir o zip.

## Primeiro: elas importaram

Fui ver as execuções do n8n. A da **14h43** diz:

```
linhas_lidas_na_planilha: 38
cirurgias_criadas_no_crm: 30
ja_existiam_ignoradas: 8
erros: 0
```

As realizadas e canceladas **entraram**. As execuções seguintes, às 14h45 e
14h52, mostram 0 criadas e 38 ignoradas — que é o certo: o CRM reconheceu que
já as conhecia e não duplicou nada. Exatamente o comportamento esperado.

Você não as viu porque **a lista abre no filtro "Em andamento"**, e realizada e
cancelada não estão nele. Estavam ali do lado, em outra aba.

A culpa é do desenho da tela, não sua. Um filtro que esconde 30 registros sem
dizer que existem é um filtro mal feito.

Sobre as **8 ignoradas**: 4 são as de CIRURGIAS que já tinham entrado antes.
As outras 4 são o caso que eu tinha avisado — mesmo paciente com a mesma data
aparecendo em duas abas. Vale olhar quais são; se fizerem falta, lançamos à mão.

## O que mudou

**Cada aba agora mostra o número.** "Em andamento 4 · Realizadas 16 ·
Canceladas 14 · Todas 34". Só isso já teria evitado a confusão de hoje.

**Três filtros novos:** Hospital, Cirurgião e Cirurgia. As opções vêm do que
existe nas cirurgias lançadas, não do cadastro inteiro — não adianta oferecer
um hospital onde nunca se operou.

**Os filtros conversam com as abas.** Filtrando pelo Blanc, os números das abas
passam a contar só as do Blanc: quantas em andamento, quantas realizadas,
quantas canceladas. Contar sobre a lista inteira daria números sem relação com
o que está na tela.

**Botão Limpar** aparece quando há algum filtro ativo, incluindo a busca por
texto.

A busca continua valendo para tudo ao mesmo tempo — paciente, sigla, nome da
cirurgia, hospital e cirurgião — e se combina com os filtros.
