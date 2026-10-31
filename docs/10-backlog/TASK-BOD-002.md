# TASK-BOD-002 · Motor de operaciones de bodega
- Hito M2 · 2 días · Escalado: sí (libros y concurrencia)
- Historias / RNF: US-BOD-02, US-BOD-12
- Depende de: TASK-INV-001, TASK-BOD-001

## Objetivo
Confirmar operaciones (borrador → confirmada) con número, movimientos físicos, aristas del DAG y ganchos para SISV y SILICIE, en una transacción; rectificación con `reversal`.

## Contexto
`02-modelo-dominio.md` §9 · `03-maquinas-estado.md` §2 · `WC020`, `WC025`, `WC026`, `WC030`, `WC031`, `WC032`.

## Ficheros
`api/src/core/cellar/confirmOperation.ts`, `api/src/core/cellar/rectify.ts`, `api/src/routes/cellar-operations.ts` (incl. `preview`).

## Interfaz exacta
```ts
confirmOperation(tx, { operationId, actor }): Promise<{ number; stockMoveIds; lotEdges; sideEffects: { sisv: Preview[]; silicie: Preview[] } }>
previewOperation(tx, draft): Promise<SameShapeWithoutWriting>
rectifyOperation(tx, { operationId, reason, newDraft })
registerSideEffect(opType, handler) // lo usan REG-004 y REG-012
```

## Criterios de aceptación
- Conservación de volumen al confirmar; dos confirmaciones concurrentes sobre el mismo recipiente no dejan saldos negativos.

## Tests requeridos
Integración de cada guarda; propiedad de conservación con operaciones aleatorias.
