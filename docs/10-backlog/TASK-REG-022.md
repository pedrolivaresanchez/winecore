# TASK-REG-022 · Confirmaciones de pago y bandeja EDI (UI-30)
- Hito M3 · 1 día · Escalado: no
- Historias / RNF: US-EDI-04
- Depende de: TASK-REG-020, TASK-FIN-001

## Objetivo
Proponer cobros con imputaciones a partir de REMADV y mostrar la bandeja EDI.

## Contexto
`04-regulatorio/aecoc-edi.md` §4.3 · `08-ui/UI-30-edi.md`.

## Ficheros
`api/src/core/regulatory/edi/remadv.ts`, `ui/src/pages/regulatory/edi/*`.

## Interfaz exacta
`proposePaymentFromRemadv(tx, msgId)` → borrador de cobro (no se registra sin una persona).

## Criterios de aceptación
- Facturas citadas que no existen → aviso, no imputación.

## Tests requeridos
Golden `remadv_sintetico.json`; E2E de la bandeja.
