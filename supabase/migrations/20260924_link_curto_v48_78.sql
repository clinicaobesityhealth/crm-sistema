-- v48.78 — Link do cirurgião mais curto.
--
-- Pode rodar de novo sem problema.
--
-- A chave de 64 caracteres protegia bem e não cabia numa mensagem: o endereço
-- virava duas linhas no WhatsApp. Aqui ela passa a ter 10 caracteres.
--
-- Continua sendo o que tranca a página — não dá para tirar de vez, porque sem
-- nada no fim do endereço qualquer pessoa na internet abriria a tela, veria os
-- nomes dos cirurgiões e conseguiria lançar cirurgia. Com 10 caracteres em
-- letras e números são 3,6 quatrilhões de combinações: curto de ler, inviável
-- de adivinhar.
--
-- Só troca a chave que ainda é a longa gerada automaticamente (64 hexadecimais)
-- e que, por isso, ninguém chegou a distribuir.
update public.clinic_settings
   set agenda_cirurgiao = agenda_cirurgiao || jsonb_build_object(
     'token', substr(
       translate(
         encode(decode(md5(random()::text || clock_timestamp()::text), 'hex'), 'base64'),
         '+/=', 'xyz'),
       1, 10))
 where agenda_cirurgiao->>'token' ~ '^[a-f0-9]{64}$';

notify pgrst, 'reload schema';
