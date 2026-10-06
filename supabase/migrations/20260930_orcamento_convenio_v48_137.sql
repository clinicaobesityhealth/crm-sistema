-- v48.137 — O aviso "o orçamento do hospital será enviado separadamente" só
-- faz sentido quando o convênio NÃO cobre o hospital, ou seja, quando a
-- modalidade é particular TOTAL. Com convênio (mesmo "particular com
-- convênio"), o hospital é coberto, e a frase confunde a paciente.
--
-- Pode rodar mais de uma vez.
--
-- O QUE MUDA
-- A carta padrão de Orçamento (cirurgia_cartas, tipo='orcamento') tinha a
-- frase fixa "O ORÇAMENTO DO HOSPITAL SERÁ ENVIADO SEPARADAMENTE" gravada no
-- corpo do modelo. Isto troca essa frase fixa por um placeholder
-- {aviso_hospital_separado}, que o código (route.ts, v48.137) preenche na
-- hora de montar o texto: com a frase quando a cirurgia é particular total,
-- vazio quando há convênio. Só troca se a frase fixa ainda estiver lá —
-- clínica que já editou a carta à mão (ou já rodou esta migração) não é
-- mexida de novo.

update public.cirurgia_cartas
   set corpo = replace(corpo, 'O ORÇAMENTO DO HOSPITAL SERÁ ENVIADO SEPARADAMENTE', '{aviso_hospital_separado}'),
       updated_at = now()
 where tipo = 'orcamento'
   and corpo like '%O ORÇAMENTO DO HOSPITAL SERÁ ENVIADO SEPARADAMENTE%';

notify pgrst, 'reload schema';
