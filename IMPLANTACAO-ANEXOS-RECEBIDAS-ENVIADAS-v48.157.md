# CRM Obesity v48.157 — Anexos: submenu Recebidas / Enviadas

## Alteração

Na aba **Anexos** do atendimento, a cor do rótulo (v48.137) não estava
chamando atenção o suficiente para bater o olho e saber de quem é cada
arquivo. Em vez de insistir na cor, a lista agora abre em dois submenus,
igual já existia em Agendadas (ativas/enviadas):

- **Recebidas** — o que o paciente mandou.
- **Enviadas** — o que saiu da clínica (atendente identificado ou a IA).

Cada submenu mostra a contagem de arquivos entre parênteses. O rótulo
colorido por item continua existindo dentro de "Enviadas" (ainda ajuda a
saber qual atendente da equipe mandou cada um). O botão "Apagar todos os
arquivos" continua valendo para os anexos da conversa inteira, não só da
sub-aba aberta — para não dar a entender que apagaria só metade.

## Implantação

Suba o zip no EasyPanel como nas versões anteriores. Não há SQL nem
alteração de flow n8n nesta versão.
