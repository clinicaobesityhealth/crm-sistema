# CRM Obesity v46.37 — agendamento da Sofia e modalidade MedX

## Correções

- O cartão do MedX no atendimento deixa de exibir o código interno `1` no lugar da modalidade.
- A modalidade passa a ser inferida primeiro pela descrição retornada pelo MedX (`ONLINE` ou `PRESENCIAL`) e, como compatibilidade, pelos códigos retornados pela API.
- O subflow **Agendar Consulta** foi corrigido e publicado diretamente no n8n em 03/08/2026.
- O corpo enviado ao `InsertAgendamento` agora é montado como objeto JSON seguro. Campos opcionais vazios, inclusive `Id_da_Assinatura`, são enviados como `null` e não invalidam mais a requisição da Sofia.

## Implantação

1. Suba este ZIP no Easypanel como nas versões anteriores.
2. Não é necessário executar SQL novo para esta correção.
3. O ajuste do subflow já está publicado no n8n de produção.

## Verificação realizada

- A compilação do código foi concluída com sucesso.
- A etapa posterior de geração de páginas parou apenas porque as variáveis do Supabase não existem no ambiente local; elas permanecem configuradas no Easypanel.
- A consulta recuperada foi confirmada no MedX como **online**.
- A confirmação foi enviada à paciente pela Sofia sem assumir o atendimento do médico.
