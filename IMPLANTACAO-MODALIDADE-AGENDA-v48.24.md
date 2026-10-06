# v48.24 — Online ou presencial na Agenda Médica

**Sem SQL.** É só subir o zip.

## Onde aparece agora

**No horário da grade** — o slot ocupado de uma consulta online mostra o ícone
de vídeo no lugar do visto, e a palavra "ONLINE" ou "PRESENCIAL" embaixo do
nome do paciente. Passando o mouse, o resumo do horário também diz.

**No cartão do agendamento** — uma tarja ao lado da situação: roxa com ícone de
vídeo para online, verde com alfinete para presencial.

**Nas abas Realizadas e Canceladas** — na mesma linha do profissional e da
data.

Era a informação que decidia se alguém precisa estar na clínica, e para saber
era preciso abrir uma consulta por vez.

## Um detalhe que evita erro futuro

A modalidade chega de lugares diferentes conforme quem criou a consulta: o
agendamento feito pelo CRM grava num campo, o que vem do MedX às vezes usa
outro nome, e registros antigos guardaram só um número (1 para presencial, 2
para online).

Pus essa tradução num lugar só, em vez de repetir a regra em cada tela. Se
amanhã aparecer mais uma forma de gravar, conserta-se ali e as três telas
acertam juntas — em vez de uma mostrar "online" e a outra não mostrar nada.

Testei as onze variações que aparecem nos seus dados: "Online", "ONLINE",
"Presencial", "Teleconsulta", "Consultório", os códigos 1 e 2, e os casos
vazios.

Quando o registro não diz nada, nenhuma tarja aparece — melhor do que chutar
"presencial" e a pessoa ir até a clínica à toa.
