# TASK-VENT-006 · Presupuestos y proformas
- Hito M2 · 1 día · Escalado: no
- Historias / RNF: US-VENT-07
- Depende de: TASK-VENT-002

## Objetivo
Presupuestos y facturas proforma (sin efectos fiscales ni Verifactu) en PDF ES/EN, convertibles en pedido.

## Contexto
`sales.quote` · `02-modelo-dominio.md` §11.

## Ficheros
`api/src/core/sales/quotes.ts`, `api/src/routes/quotes.ts`, `api/src/core/billing/pdf/proforma.tsx`.

## Interfaz exacta
`POST /api/v1/quotes` · `POST /api/v1/quotes/{id}/to-order` · `GET /api/v1/quotes/{id}/pdf` (título "Proforma", sin QR tributario).

## Criterios de aceptación
- Una proforma nunca genera registro Verifactu ni movimientos.

## Tests requeridos
Integración y golden del PDF (texto extraído).
