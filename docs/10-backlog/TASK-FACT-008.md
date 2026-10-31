# TASK-FACT-008 · Emisión en lote con aprobación
- Hito M1 · 1 día · Escalado: sí (concurrencia)
- Historias / RNF: US-FACT-08
- Depende de: TASK-FACT-003, TASK-APR-001

## Objetivo
Pedir aprobación para emitir varios borradores; al aprobarse, emitirlos en orden de fecha con números consecutivos, uno por transacción, y avisar de los que fallen.

## Contexto
`03-maquinas-estado.md` §5 y §12 · regla dura 0.3.

## Ficheros
`api/src/core/billing/batch.ts`, manejador de aprobación `invoice_batch_issue`.

## Interfaz exacta
`POST /api/v1/invoices/batch-issue-request { invoiceIds }` → solicitud con `payload` = ids + hash de cada borrador; el manejador emite con `issueInvoice` y registra el resultado por factura.

## Criterios de aceptación
- Si un borrador cambió tras pedir la aprobación, no se emite (hash distinto) y se informa.
- Los números quedan consecutivos en el orden de fecha.

## Tests requeridos
Integración con 10 borradores, uno alterado tras la solicitud.
