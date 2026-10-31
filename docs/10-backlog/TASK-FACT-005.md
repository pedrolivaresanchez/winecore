# TASK-FACT-005 · Rectificativas (UI-14)
- Hito M1 · 1,5 días · Escalado: sí (fiscal)
- Historias / RNF: US-FACT-04
- Depende de: TASK-FACT-003

## Objetivo
Rectificativas R1–R4 por diferencias o por sustitución, de facturas de WineCore o de Holded, con su registro Verifactu (facturas rectificadas e importe rectificado).

## Contexto
`04-regulatorio/verifactu.md` §5 y §9 · `08-ui/UI-14-rectificativa.md` · `billing.invoice_rectification`.

## Ficheros
`api/src/core/billing/rectify.ts`, `ui/src/pages/billing/rectify/*`.

## Interfaz exacta
`POST /api/v1/invoices { rectifies: [{ invoiceId } | { legacy: { issuerTaxId, number, issueDate } }], invoiceType: 'R1'|'R2'|'R3'|'R4', rectificationKind: 'S'|'I', lines }`.

## Criterios de aceptación
- Por sustitución, `ImporteRectificacion` sale de la original automáticamente.
- Por diferencias no puede dejar la original en negativo acumulado.
- Serie de rectificativas por defecto (`CR27-`/`PR27-`).

## Tests requeridos
Integración de los cuatro tipos y los dos modos; golden del XML del registro (casos VF-08, VF-09, VF-10).
