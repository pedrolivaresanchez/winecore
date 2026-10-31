# TASK-ASIS-002 · Resumen diario a CVBOT
- Hito M3 · 1 día · Escalado: no
- Historias / RNF: US-ASIS-02
- Depende de: TASK-CORE-007, TASK-UI-003

## Objetivo
Cada día laborable a las 8:00 (Madrid), resumen a CVBOT: aprobaciones pendientes, plazos próximos, vencidos, Verifactu pendiente y alertas de bodega.

## Contexto
`07-arquitectura.md` §5 (`resumen-diario`).

## Ficheros
`workforce/resumen-diario/workflow.py`.

## Interfaz exacta
Usa `GET /api/v1/dashboard` y envía el evento `daily_summary` por el outbox (nunca a terceros).

## Criterios de aceptación
- Festivos nacionales y fines de semana sin envío.

## Tests requeridos
Unitarios del calendario y golden del texto.
