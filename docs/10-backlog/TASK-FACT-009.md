# TASK-FACT-009 · Intercompañía mensual (UI-16)
- Hito M2 · 2 días · Escalado: sí (fiscal y stock)
- Historias / RNF: US-FACT-09
- Depende de: TASK-FACT-003, TASK-CAT-003, TASK-VENT-003

## Objetivo
Cierre mensual de la liquidación, factura recapitulativa P.O → CVPO con fecha de operación el último día del mes y expedida antes del día 16, recibida espejo en CVPO y salidas fiscales.

## Contexto
`02-modelo-dominio.md` §12.6 · RD 1619/2012 arts. 11 y 13 · `08-ui/UI-16-intercompania.md`.

## Ficheros
`api/src/core/billing/intercompany.ts`, `api/src/jobs/intercompany-close.ts`, `ui/src/pages/billing/intercompany/*`.

## Interfaz exacta
Job día 1 a las 06:00 → `closeSettlement(period)` + borrador `PI` + `requestApproval('intercompany_invoice_issue')`; manejador: `issueInvoice` + `purchasing.supplier_invoice` espejo (`source='intercompany'`) en la misma transacción.

## Criterios de aceptación
- Vigilante avisa desde el día 12 si la factura del mes anterior no está emitida.
- Falta de tarifa → bloqueo con el producto afectado.

## Tests requeridos
Integración de un mes completo sintético; propiedad: total de la factura = Σ líneas de liquidación.
