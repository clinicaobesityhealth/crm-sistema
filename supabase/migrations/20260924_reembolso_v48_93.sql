-- v48.93 — Solicitação de reembolso: a quarta carta.
--
-- Rode depois da 20260924_equipe_da_rgo_v48_92.sql. Pode rodar de novo.
--
-- A tabela e a coluna 'tipo' já previam 'reembolso' desde a v48.69; só faltava
-- o modelo. Texto a partir do exemplo real que a clínica mandou — mesma
-- divisão de honorários do orçamento ({divisao}), porque é o mesmo valor já
-- cobrado do paciente, agora sendo pedido de volta ao convênio.

insert into public.cirurgia_cartas (tipo, titulo, corpo, ordem)
select * from (values
  ('reembolso', 'SOLICITAÇÃO DE REEMBOLSO',
$T$SR(A) {paciente}

Informo que o referido paciente foi submetido ao(s) tratamento(s) conforme autorização prévia e o valor dos honorários e a divisão, seguem abaixo relacionados. A cirurgia ocorreu em {data} no hospital {hospital}.

Procedimento(s):
{procedimentos}

Diagnóstico(s):
{diagnosticos}

HONORÁRIOS   {valor}   ({valor_extenso})

{divisao}

Será anexado a este documento o comprovante de pagamento e a descrição cirúrgica.$T$, 4)
) as novos(tipo, titulo, corpo, ordem)
where not exists (select 1 from public.cirurgia_cartas c where c.tipo = novos.tipo);
