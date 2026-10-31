# TASK-REG-004 · Motor de asientos SILICIE
- Hito M2 · 2 días · Escalado: sí (II.EE.)
- Historias / RNF: US-SIL-01
- Depende de: TASK-INV-002, TASK-REG-005

## Objetivo
Convertir cada hecho en asientos `regulatory.silicie_entry` según la tabla de `silicie.md` §5 (tipo de movimiento, régimen, operación, justificante), incluida la agregación mensual permitida (DA 1.ª) y los A32 informativos.

## Contexto
`04-regulatorio/silicie.md` §1, §5–§7 · tablas TIMO, TIJ2, REFI.

## Ficheros
`api/src/core/regulatory/silicie/entries.ts`, `.../aggregate.ts`, `.../codes.ts`.

## Interfaz exacta
```ts
entriesForFiscalMove(tx, move: FiscalMove): SilicieEntryDraft[]
entriesForOperation(tx, op: ConfirmedOperation): SilicieEntryDraft[] // uva, mosto, A32
aggregateMonth(tx, { warehouseId, month }): SilicieEntryDraft[]       // elaboración, materias primas, ventas al por menor (J13)
```

## Criterios de aceptación
- Trasiego depósito ↔ barrica → A17 + A16 (sin agregación) y A30 de la merma.
- Envasado → A14 + A15 con tipo, capacidad y nº de envases + A32.
- Todo asiento lleva justificante.

## Tests requeridos
Golden de cada fila de `silicie.md` §5 con hechos sintéticos.
