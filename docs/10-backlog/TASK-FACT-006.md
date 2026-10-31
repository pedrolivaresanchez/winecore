# TASK-FACT-006 · Anulación de factura emitida por error
- Hito M1 · 0,5 días · Escalado: sí (fiscal)
- Historias / RNF: US-FACT-05
- Depende de: TASK-FACT-003, TASK-APR-001

## Objetivo
Anular una factura que no debió expedirse: estado `voided`, registro de anulación Verifactu encadenado y número no reutilizable.

## Contexto
`04-regulatorio/verifactu.md` §9 · `03-maquinas-estado.md` §5.

## Ficheros
`api/src/core/billing/void.ts`, ruta `POST /api/v1/invoices/{id}/void`.

## Interfaz exacta
`voidInvoice(tx, { invoiceId, reasonCode, reasonText, actor })` — exige `billing.void` y verificación reforzada; revierte efectos fiscales con `reversal`.

## Criterios de aceptación
- Una factura con cobros no se puede anular (debe rectificarse).
- La serie no reutiliza el número.

## Tests requeridos
Integración y golden del registro de anulación (VF-11).
