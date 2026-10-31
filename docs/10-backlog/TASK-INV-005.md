# TASK-INV-005 · Existencias a fecha e informe de inspección (UI-19)
- Hito M2 · 1,5 días · Escalado: no
- Historias / RNF: US-INV-02
- Depende de: TASK-INV-001, TASK-UI-002

## Objetivo
Consultar existencias físicas y fiscales en cualquier instante y generar el PDF de inspección con hash.

## Contexto
`08-ui/UI-19-existencias.md` · `inventory.stock_at`, `inventory.fiscal_at`.

## Ficheros
`api/src/routes/stock.ts`, `api/src/core/inventory/inspectionReport.tsx`, `ui/src/pages/stock/balances/*`.

## Interfaz exacta
`GET /api/v1/stock/balances?at=` · `GET /api/v1/stock/fiscal-balances?at=` · `GET /api/v1/stock/inspection-report?at=` (PDF).

## Criterios de aceptación
- p95 < 300 ms con la BD ×10 (RNF-03).

## Tests requeridos
Integración con fechas anteriores y posteriores a movimientos; golden del PDF (texto).
