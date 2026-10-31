# TASK-UI-003 · Panel (UI-02)
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: US-APR-01, US-VFT-02, US-FIN-02
- Depende de: TASK-UI-002, TASK-CORE-007

## Objetivo
Endpoint `GET /api/v1/dashboard` y pantalla UI-02 con bloques independientes y el banner de Verifactu del art. 16.4.

## Contexto
`08-ui/UI-02-panel.md` · `04-regulatorio/verifactu.md` §10–§11.

## Ficheros
`api/src/routes/dashboard.ts`, `ui/src/pages/dashboard/*`.

## Interfaz exacta
`GET /api/v1/dashboard?entity=` → `{ approvals_pending, deadlines_next_30d, receivables_overdue, verifactu_pending: { count, since }|null, submissions_failed, cellar_alerts, stock_alerts }` (cada bloque `null` si el módulo está apagado o no hay permiso).

## Criterios de aceptación
- Con registros Verifactu pendientes, el banner aparece en el panel y en Facturas con el número y la hora del primero.
- Un bloque que falla no impide ver los demás.

## Tests requeridos
Integración del endpoint con datos sintéticos; E2E del banner.
