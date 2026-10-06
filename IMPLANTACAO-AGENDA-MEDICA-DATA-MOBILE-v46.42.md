# CRM Obesity v46.42 — data duplicada na Agenda Médica (celular)

## Problema

Na tela **Agenda Médica**, no celular, a barra de navegação de data quebrava em
duas linhas: o rótulo por extenso ("Quarta-feira, 5 de agosto") numa linha, e
o `input type="date"` nativo (que já mostra a mesma data, ex. "5 de ago. de
2026") sozinho na linha de baixo — informação duplicada ocupando espaço de
tela à toa.

## Mudança

`app/agenda-medica/page.tsx`: a partir de `sm:` (tablet/desktop) o layout
continua idêntico ao de antes (rótulo por extenso + date-picker nativo lado a
lado). Abaixo de `sm:`, os dois viram um único controle compacto numa linha
só — um rótulo curto ("Qua, 5 de ago") com ícone de calendário, sobreposto por
um `input type="date"` invisível ocupando a área toda (toque em qualquer
ponto abre o seletor nativo de data do celular). Nenhuma mudança de
comportamento, só de layout — os botões "◀ ▶ Hoje" e a lógica de troca de
data continuam exatamente iguais.

Sem alteração de SQL nem de flow n8n nesta versão.
