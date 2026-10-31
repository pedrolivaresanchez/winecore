# TASK-FACT-003 · Emisión transaccional (`issueInvoice`)
- Hito M1 · 2 días · Escalado: sí (fiscal e idempotencia)
- Historias / RNF: US-FACT-02, US-VFT-01
- Depende de: TASK-FACT-002, TASK-CORE-004, TASK-VFT-002

## Objetivo
Emitir en **una sola transacción**: bloqueo, validación, número de la serie, congelado del cliente, cálculo, vencimientos, registro Verifactu encadenado, efectos fiscales (facturas de P.O según la regla D2), marcar albaranes facturados y evento al outbox.

## Contexto
`02-modelo-dominio.md` §12.4 · `07-arquitectura.md` §7 (secuencia) · `04-regulatorio/verifactu.md` §4 · `WC080`.

## Ficheros
`api/src/core/billing/issue.ts`, ruta `POST /api/v1/invoices/{id}/issue`.

## Interfaz exacta
```ts
export async function issueInvoice(tx: Tx, input: { invoiceId: UUID; actor: Actor }): Promise<{ number: string; issueDate: string; totals: Totals; verifactuRecordId: UUID|null; qrUrl: string|null }>
```
`Idempotency-Key` obligatoria; repetir devuelve el mismo resultado.

## Criterios de aceptación
- Si algo falla (p. ej. encadenamiento), no queda número consumido ni registro (rollback completo).
- Factura emitida: solo cambian los campos permitidos por `WC080`.
- p95 < 1 s con la BD sintética ×10 (RNF-03).

## Tests requeridos
Integración: éxito; fallo inyectado tras `take_number` (sin huecos); concurrencia de dos emisiones de la misma factura (una gana, la otra devuelve el mismo resultado); propiedad: numeración continua por serie.
