# CRM Obesity v48.175 — Prontuário: visual por dia + acesso só médico

## O que mudou

**1. Histórico mais fácil de ler**

As anotações agora são agrupadas por dia, com a data em destaque (uma faixa
cinza com o dia da semana completo, ex: "Sexta-feira, 09 de outubro de
2026") em vez da data pequena e cinza-clara repetida em cada anotação.
Dentro de cada dia, cada anotação vira um cartão com fundo branco e borda,
mostrando só o horário e quem anotou.

**2. Prontuário agora é só para médico**

Pedido seu: secretária não deve ver o histórico clínico. Agora o acesso
segue o **cargo** da pessoa (mesmo esquema que já existe para a agenda
cirúrgica e a agenda pessoal):

- Administrador sempre vê.
- Cargos com "médic" no nome (Médico(a), Médico Cirurgião etc.) já ficam
  liberados automaticamente ao rodar o SQL abaixo.
- Qualquer outro cargo (Secretária, Recepção, Nutricionista...) fica
  bloqueado por padrão — aparece "Acesso restrito" no lugar do histórico.
- Se algum cargo de médico não tiver sido pego automaticamente (nome
  diferente, tipo "Clínico Geral"), é só ir em **Configurações → Cargos** e
  clicar no selo "sem prontuário" ao lado do cargo pra liberar (mesmo botão
  que já existe pra cirurgia e agenda pessoal).

Essa restrição vale em todo lugar que o Prontuário aparece: no menu do
paciente (MedX → Prontuário), na Agenda Médica, na edição de cirurgia e na
lista de Contatos.

## Passo necessário no Supabase (1x, 1 minuto)

Abra o **SQL Editor** do Supabase e rode:

```sql
alter table public.job_titles add column if not exists ve_prontuario boolean not null default false;

update public.job_titles
   set ve_prontuario = true
 where lower(name) like '%médic%' or lower(name) like '%medic%';

notify pgrst, 'reload schema';
```

Até rodar esse SQL, o Prontuário fica restrito só ao administrador pra
qualquer cargo (não quebra nada, só fica mais restritivo que o normal até
você rodar).

## Implantação

Suba esta versão como sempre (GitHub → EasyPanel já implanta sozinho). Depois
rode o SQL acima no Supabase.
