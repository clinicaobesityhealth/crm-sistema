# CRM Obesity v48.178 — Correção: paciente trocado por outro de nome parecido

## O que foi encontrado na auditoria

Você relatou dois casos: **Marcia Valeria** foi substituída no CRM por
**Marcia Cristina**, e **Bruna Puggina** foi substituída por **Bruna
Polidoro** — em ambos os casos a pessoa errada (mas que também existe de
verdade no MedX) ficou vinculada ao cadastro.

**Causa raiz:** quando o CRM procura um paciente no MedX, ele manda o nome
que está salvo no cadastro do CRM. Muitas vezes esse nome é só o **primeiro
nome** (porque vem do nome de exibição do WhatsApp, ex: "Marcia" ou "Bruna",
sem sobrenome). Quando existe mais de uma paciente com esse mesmo primeiro
nome cadastrada no MedX, o sistema não tinha como saber qual das duas era a
certa — e escolhia sozinho a que tinha o cadastro "mais completo" no MedX
(mais dados preenchidos), **não necessariamente a pessoa certa**. Depois,
como o nome do MedX sempre prevalece sobre o do CRM (pra evitar nomes
diferentes em cada sistema), esse nome errado sobrescrevia o cadastro.

Isso já tinha sido parcialmente corrigido em agosto (passou a exigir que o
nome bata), mas essa proteção só funciona bem quando o CRM tem o nome
completo. Com só o primeiro nome, ela não discrimina nada.

## O que foi corrigido (v48.178)

Sem depender do nome, agora o **telefone** do contato é usado para
confirmar que achou a pessoa certa, nos dois pontos onde o CRM decide se
aceita um "achado" do MedX:

1. **`app/api/medx/route.ts`** (o ponto único por onde toda busca no MedX
   passa, usado pelo Inbox, pela Agenda Médica e pelo cadastro de contato):
   quando o nome do contato tem só um nome (sem sobrenome) e o telefone do
   cadastro encontrado no MedX **não é o mesmo** telefone do contato, o
   resultado passa a ser tratado como "não encontrado" — não vincula.

2. **Painel de atendimento (aba MedX)**: mesmo que algum dia um "achado"
   escape dessa primeira checagem, o CRM agora **nunca troca sozinho** um
   vínculo com o MedX que já existia por outro vindo de uma busca nova — se
   o paciente já estava vinculado a um cadastro do MedX, uma busca
   ambígua não troca esse vínculo por conta própria. E o nome só é
   sobrescrito quando o nome salvo no CRM já tem sobrenome (nome só com
   primeiro nome não é mais motivo suficiente pra trocar o nome do
   cadastro).

**Importante — uma parte não entrou ainda:** eu também preparei uma melhoria
no fluxo do n8n (o mesmo tipo de confirmação por telefone, direto na busca
do MedX) que deixaria a proteção ainda mais forte, bem na raiz. Mas o
sistema me bloqueou de editar esse fluxo de automação diretamente (é uma
"peça compartilhada" de produção, e isso exige aprovação manual sua lá no
próprio n8n). As duas correções acima já cobrem os casos reais que você
relatou sem precisar dessa segunda parte — posso te mostrar exatamente o que
mudar no n8n se você quiser essa camada extra depois; não é urgente.

## Os dois cadastros já trocados — preciso da sua confirmação pra corrigir

Eu não tenho como saber, só pelos dados, qual é o telefone/CPF certo de cada
paciente — só você ou a equipe sabem isso com segurança. Pra eu preparar a
correção, roda esse SELECT no **SQL Editor do Supabase** e me manda o
resultado (ou corrige direto você mesmo, com cuidado):

```sql
select id, full_name, phone, cpf, medx_id, updated_at
  from contacts
 where full_name ilike '%marcia%' or full_name ilike '%bruna%'
 order by full_name;
```

Com isso dá pra ver, pra cada paciente:
- Qual registro é a "Marcia Valeria"/"Bruna Puggina" de verdade (pelo
  telefone que ela realmente usa pra falar com a clínica no WhatsApp).
- Se o nome e o `medx_id` atuais estão errados (ainda apontando pra Marcia
  Cristina/Bruna Polidoro).

Depois de ver os dados, a correção é simples (um `update` trocando de volta
`full_name` e `medx_id` pro valor certo, só nesses dois registros) — mas
prefiro fazer isso com você confirmando qual é qual, pra não arriscar trocar
errado de novo.

## Implantação

Sobe esta versão como sempre (GitHub → EasyPanel implanta sozinho). Não tem
nenhum passo no Supabase pra esta versão — só os dois arquivos de código.
