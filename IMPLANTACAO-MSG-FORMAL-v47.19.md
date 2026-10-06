# v47.19 — Mensagem formal e bandeira visível

Sem SQL novo.

## A mensagem ao paciente

Antes:

```
Olá, JOÃO! Segue o link para pagamento com cartão (Cirurgia):
Valor: R$ 100,00 Em até 12x de R$ 8,34
https://...
```

Agora:

```
Prezado(a) Sr(a). João,

Segue o link para pagamento com cartão — Cirurgia.

Valor: R$ 100,00
Em 12x de R$ 8,34
Cartão: Visa / Master

https://...

O pagamento é concluído em ambiente seguro do Banco Safra.
```

Três mudanças:

- **Tratamento formal**, com "Prezado(a) Sr(a).".
- **Nome em caixa normal.** Os nomes vêm do MedX em maiúsculas e "Olá, JOÃO!"
  soava como grito. Agora vira "João" — com as partículas em minúscula, como se
  escreve em português: "João de Barros", não "João De Barros".
- **A bandeira escolhida pela secretária aparece**, para o paciente conferir que
  é o cartão que ele informou.

A cobrança PIX recebeu o mesmo tratamento formal, para as duas não destoarem. Se
preferir manter o PIX como estava, é só me dizer.

## Sobre o teste: veio o link do Safra, não o nosso

Isso é a configuração, não um defeito. A mensagem que você recebeu tem duas
marcas do modo **"Paciente escolhe, sem repassar taxa"**: o valor saiu limpo
(R$ 100,00, sem acréscimo) e o texto diz "Em até 12x" — foi o modo que você
escolheu justamente para testar se a Safrapay acrescenta juros sozinha.

A nossa página só entra no modo **"Paciente escolhe o parcelamento"**, que é o que
junta as duas coisas: repasse ligado + escolha do paciente.

Para ver a nossa página:

1. Confirme que subiu a **v47.18** e rodou o SQL dela.
2. Configurações → Cobrança → marque **"Paciente escolhe o parcelamento"**.
3. Salve e envie uma nova cobrança.

O link vai ficar curto (`crm.obesityhealth.com.br/pagar-cartao/...`) em vez
daquele endereço enorme do Safra com token — outro ganho do caminho pela nossa
página.
