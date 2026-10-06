-- v48.168 — Jorge: o texto do Orçamento soava como um pedido de reembolso ao
-- convênio ("Solicito análise de prévia de reembolso..."), mas o Orçamento é
-- usado também (e principalmente) como a cotação entregue direto ao
-- paciente, sem convênio nenhum envolvido. A frase agora é neutra: apresenta
-- o orçamento da cirurgia, sem presumir convênio.
--
-- Pode rodar de novo sem problema — só troca se a frase antiga ainda
-- estiver lá (clínica que já editou a carta à mão não é mexida de novo).
--
-- NÃO MUDA (de propósito, avise se quiser mudar também):
--   - a saudação "Ao convênio," no topo da carta
--   - a frase final "Este documento deve ser enviado ao convênio para
--     análise de prévia de reembolso, se for o caso."
-- As duas ainda pressupõem convênio — se o Orçamento também vai direto ao
-- paciente particular, talvez valha ajustar essas duas frases também.

update public.cirurgia_cartas
   set corpo = replace(
         corpo,
         'Solicito análise de prévia de reembolso para o(a) paciente referido(a) que necessita ser submetido(a) ao(s) tratamento(s) cirúrgicos abaixo relacionados que está prevista para ocorrer em {data} no hospital {hospital}.',
         'Segue o orçamento referente à cirurgia prevista para ocorrer em {data} no hospital {hospital}.'
       ),
       updated_at = now()
 where tipo = 'orcamento'
   and corpo like '%Solicito análise de prévia de reembolso para o(a) paciente referido(a)%';

notify pgrst, 'reload schema';
