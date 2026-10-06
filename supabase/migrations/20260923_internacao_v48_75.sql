-- v48.75 — Solicitação de internação.
--
-- Rode depois da 20260923_materiais_e_solicitacao_v48_73.sql. Pode rodar de novo.
--
-- A carta tem DOIS horários: o da internação e o do procedimento. Eram a mesma
-- coluna na planilha e alguém somava de cabeça — "cirurgia às 7, então interna
-- às 5". Duas horas antes é o costume, mas não é regra: hospital, tipo de
-- anestesia e exame pré mudam isso. Vira campo, com sugestão de duas horas
-- antes quando ninguém preencheu.

alter table public.cirurgias
  add column if not exists hora_internacao time;

-- As orientações gerais que vão no pé da carta. Texto fora do programa, como
-- as outras: a clínica ajusta sem esperar versão nova.
--
-- {remedios} fica reservado para a lista de suspensão de medicações, que virá
-- do PausaMed. Enquanto não houver lista, a linha inteira some — melhor do que
-- imprimir "confirme se suspendeu: —".
insert into public.cirurgia_cartas (tipo, titulo, corpo, ordem)
select * from (values
  ('internacao', 'SOLICITAÇÃO DE INTERNAÇÃO',
$T$SR(A) {paciente}

Ao hospital {hospital}

Solicito a internação do(a) paciente referido(a) sob meus cuidados às {hora_internacao} horas para realização do(s) procedimento(s) abaixo relacionado(s):

Procedimento(s):
{procedimentos}

Diagnóstico(s):
{diagnosticos}

Data {data}    Horário do procedimento: {hora} horas
Horário da internação: {hora_internacao} horas

1. ORIENTAÇÕES GERAIS
- Confirme se suspendeu as medicações conforme foi orientado(a). {remedios}
- Caso inicie qualquer nova medicação antes da cirurgia, comunicar imediatamente ao médico responsável.
- Informe sempre todos os medicamentos de uso contínuo à equipe médica.
- Se fizer uso de medicação para pressão arterial, tome no horário habitual, com pequeno gole de água, mesmo no dia da cirurgia.

2. JEJUM E ALIMENTAÇÃO
- Jejum total (alimentos e líquidos) por 8 horas antes da cirurgia.
- Exceção: água pode ser ingerida até 4 horas antes do horário agendado.

3. CUIDADOS PESSOAIS
- Retirar esmaltes, brincos, piercings, apliques de unhas, cílios e cabelos.
- Fazer higiene rigorosa da pele, principalmente abdome, com especial atenção ao umbigo e pelve, antes da ida ao hospital.
- Não é necessário raspar pelos do abdome no caso dos homens.
- Urinar antes de se dirigir ao Centro Cirúrgico.

4. DOCUMENTOS E EXAMES
- Trazer todos os exames e laudos médicos recentes, em versão impressa.

5. IMPORTANTE
- O horário da cirurgia pode sofrer atrasos, de acordo com o andamento do centro cirúrgico.$T$, 3)
) as novos(tipo, titulo, corpo, ordem)
where not exists (select 1 from public.cirurgia_cartas c where c.tipo = novos.tipo);

notify pgrst, 'reload schema';
