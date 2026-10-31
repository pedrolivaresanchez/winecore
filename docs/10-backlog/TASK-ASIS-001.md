# TASK-ASIS-001 · Asistente interno (UI-32)
- Hito M3 · 2 días · Escalado: no
- Historias / RNF: US-ASIS-01
- Depende de: TASK-MCP-003

## Objetivo
Agente `asistente` de Timbal con herramientas MCP de solo lectura, identidad de la persona (`on_behalf_of_user_id`), respuestas con fuente y enlace, y pantalla de chat.

## Contexto
`08-ui/UI-32-asistente.md` · `07-arquitectura.md` §5 · `11-tests.md` (evals).

## Ficheros
`workforce/asistente/agent.py`, `workforce/asistente/evals/*.yaml`, `ui/src/pages/assistant/*`.

## Interfaz exacta
Prompt de sistema con las reglas de UI-32; solo herramientas `*_list`, `*_get`, `inventory_stock_at`, `traceability_lot`, `reports_*`.

## Criterios de aceptación
- Evals: 20 preguntas de inspección sintéticas con ≥ 90 % de respuestas correctas y con fuente; 0 % de cifras inventadas.

## Tests requeridos
Evals de Timbal en CI (`evals`).
