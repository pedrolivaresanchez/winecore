# TASK-VENT-003 · Albaranes con lote y movimientos físicos (UI-11)
- Hito M2 · 2 días · Escalado: sí (libros y cambio de propietario)
- Historias / RNF: US-VENT-03
- Depende de: TASK-VENT-002, TASK-INV-001

## Objetivo
Emitir albaranes de venta con lote obligatorio en el vino (sugerencia FEFO), movimientos físicos en la misma transacción y cambio de propietario P.O → CVPO cuando vende CVPO stock de P.O (línea de liquidación intercompañía).

## Contexto
`02-modelo-dominio.md` §10.3 y §12.6 · `03-maquinas-estado.md` §4 · UI-11 · `WC060`.

## Ficheros
`api/src/core/sales/deliveryNotes.ts`, `api/src/core/sales/dispatch.ts`, `api/src/routes/delivery-notes.ts`, `ui/src/pages/sales/delivery-notes/*`.

## Interfaz exacta
```ts
issueDeliveryNote(tx, { id, actor }): Promise<IssuedDeliveryNote> // take_number, delivery_out, ownership_out/in + settlement line
dispatch(tx, { id }): Promise<void> // WC_REG_EAD_REQUIRED si necesita ARC
```

## Criterios de aceptación
- Línea de vino sin lote → "Indica el lote de la línea N".
- Saldo insuficiente a la fecha → `WC024`.
- Venta de CVPO con stock de P.O genera `ownership_out/in` y una línea de liquidación.

## Tests requeridos
Integración de los tres casos; propiedad: la suma de movimientos de un albarán emitido y anulado es cero.
