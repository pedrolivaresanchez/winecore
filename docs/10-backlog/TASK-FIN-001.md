# TASK-FIN-001 · Cobros e imputaciones
- Hito M1 · 1,5 días · Escalado: no
- Historias / RNF: US-FIN-01, US-MIG-03
- Depende de: TASK-FACT-003

## Objetivo
Registrar cobros y pagos con imputación a facturas de WineCore y a partidas abiertas de Holded (`legacy.open_item`), actualizando el estado de cobro.

## Contexto
`02-modelo-dominio.md` §14 · `02-ddl/0011_finance.sql` y `0016_legacy.sql` (WC100/WC101).

## Ficheros
`api/src/core/finance/payments.ts`, `api/src/routes/payments.ts`.

## Interfaz exacta
`POST /api/v1/payments { direction, method, amount, valueDate, counterpartyId, allocations: { targetTable: 'billing.invoice'|'legacy.open_item'|'purchasing.supplier_invoice'; targetId; amount }[] }` (Idempotency-Key).

## Criterios de aceptación
- Factura de 121 € con cobro de 100 € → "parcialmente cobrada" (ejemplo de US-FIN-01).
- Imputar más que lo pendiente → `WC101`.

## Tests requeridos
Integración con facturas y partidas abiertas; propiedad: pendiente = total − Σ imputaciones.
