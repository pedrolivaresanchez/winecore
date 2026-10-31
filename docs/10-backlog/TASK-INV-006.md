# TASK-INV-006 · Movimientos y conciliación físico ↔ fiscal (UI-20/21)
- Hito M2 · 1,5 días · Escalado: sí (conciliación)
- Historias / RNF: US-INV-03
- Depende de: TASK-INV-002, TASK-UI-002

## Objetivo
Explicar en cualquier fecha la diferencia por mayor entre el físico del perímetro fiscal y el fiscal (albaranes sin factura, facturas sin salida, pendientes de regularizar).

## Contexto
`08-ui/UI-20-movimientos.md`, `UI-21-conciliacion.md` · `regulatory.reconciliation_run`.

## Ficheros
`api/src/core/inventory/reconcile.ts`, `api/src/routes/stock-moves.ts`, `ui/src/pages/stock/{moves,reconciliation}/*`.

## Interfaz exacta
`reconcilePhysicalFiscal(tx, { at, taxWarehouseId }): Promise<{ ledger; physical; fiscal; diff; explained: Explanation[]; unexplained }[]>`.

## Criterios de aceptación
- Toda diferencia de la BD sintética queda explicada (unexplained = 0).

## Tests requeridos
Propiedad: físico − fiscal = Σ explicaciones para secuencias aleatorias de albaranes y facturas.
