# TASK-INV-001 · Libros físico y fiscal
- Hito M2 · 1,5 días · Escalado: sí (libros)
- Historias / RNF: US-INV-03, US-INV-05
- Depende de: TASK-CORE-002

## Objetivo
Servicio único para insertar movimientos físicos y fiscales (solo inserción), con `reversal`, cierre de periodos y lectura de saldos.

## Contexto
`02-modelo-dominio.md` §10 · `02-ddl/0007_ledgers.sql` (WC020–WC028).

## Ficheros
`api/src/core/inventory/ledger.ts`, `api/src/core/inventory/periods.ts`.

## Interfaz exacta
```ts
postPhysical(tx, moves: StockMoveInput[]): Promise<UUID[]>
postFiscal(tx, moves: FiscalMoveInput[]): Promise<UUID[]>   // exige mayor SILICIE existente (FK compuesta)
reverse(tx, { book, moveIds, reason }): Promise<UUID[]>
lockPeriod(tx, { book, entityId, until, reason }): Promise<void> // aprobación del owner
```

## Criterios de aceptación
- Ningún UPDATE/DELETE de movimientos (`WC022`); fechas en periodo cerrado → `WC021`.

## Tests requeridos
Integración de cada guarda; propiedad: saldo = Σ movimientos para cualquier secuencia válida.
