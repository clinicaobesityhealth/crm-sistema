# v47.16 — Paciente escolhe o parcelamento, presets de taxa e menu "Cobrança"

Sem SQL novo. Se ainda não rodou o da v47.14, rode antes.

## 1. Três formas de cobrar, escolhidas na tela

Em Configurações → Cobrança, o bloco do cartão agora tem três opções:

**Parcelamento definido pela secretária** (como estava). O link vai travado no
número de parcelas escolhido. A conta fecha exata: a clínica recebe exatamente o
valor digitado.

**Paciente escolhe, preço pelo maior parcelamento.** O paciente escolhe de 1x até
o máximo permitido, na página do Safra. Como a taxa depende de uma escolha que
ainda não foi feita, o preço usa a taxa do **maior** parcelamento — é o único
jeito de a clínica nunca receber menos. O efeito colateral é real e vale
conhecer: quem pagar à vista paga o mesmo acréscimo de quem parcela em 12x.

**Paciente escolhe, sem repassar taxa.** Cobra exatamente o valor digitado; a
taxa sai do caixa da clínica. É também o modo certo para o teste abaixo.

## 2. O teste que importa: a Safrapay acrescenta juros sozinha?

Alguns adquirentes já embutem os juros do parcelamento na página de pagamento. Se
for o caso, todo o nosso cálculo de repasse é desnecessário — e pior, cobraria
duas vezes.

**Como descobrir:** escolha o terceiro modo (sem repasse), envie uma cobrança de
R$ 100,00 com até 12x e abra o link.

- Se a página mostrar **12x de R$ 8,33**, ela não acrescenta nada: o custo é seu,
  e aí faz sentido usar um dos modos com repasse.
- Se mostrar algo como **12x de R$ 9,90**, ela já embute os juros. Nesse caso
  mantenha o repasse desligado para sempre — e me avise, que eu tiro a conta do
  caminho.

Esse teste vale mais que qualquer ajuste de tabela. Faça antes de usar com paciente.

## 3. Presets de taxa

Ao lado da tabela de taxas há dois botões:

- **Pior bandeira** — 2,66% / 2,76% / 3,26%. A clínica nunca recebe menos.
- **Visa/Master** — 2,06% / 2,51% / 2,99%. Mais justo para a maioria; uma compra
  no Elo ou Amex come a diferença.

Lembrando: **não dá para restringir bandeira no link** — o campo da API filtra por
tipo (débito, crédito, Pix), não por bandeira. Se o Safra permitir desabilitar Elo
e Amex na sua conta, aí sim o preset Visa/Master fica exato.

## 4. Menu renomeado

"Cobrança PIX" virou **"Cobrança"** na barra lateral, já que agora cuida dos dois.

## Sugestão de configuração para o seu caso

Consulta em 2x e cirurgia em 12x já estão nas descrições prontas. Com o paciente
escolhendo, o número que você define na janela passa a ser o **máximo** — o
paciente pode pagar à vista se quiser.
