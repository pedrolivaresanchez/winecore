# TASK-FIN-002 · Pendientes y vencidos (UI-18)
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: US-FIN-02
- Depende de: TASK-FIN-001, TASK-UI-002

## Objetivo
Vista de pendientes por cliente con antigüedad (0–30, 31–60, 61–90, > 90) y cajón para registrar cobros.

## Contexto
`08-ui/UI-18-cobros.md` · `billing.v_receivable`.

## Ficheros
`api/src/routes/receivables.ts`, `ui/src/pages/finance/*`.

## Interfaz exacta
`GET /api/v1/receivables?entity=&contact_id=&aging=`.

## Criterios de aceptación
- Incluye partidas abiertas de Holded con la etiqueta "Holded".

## Tests requeridos
Integración de la antigüedad con fechas límite; E2E del registro de cobro.
