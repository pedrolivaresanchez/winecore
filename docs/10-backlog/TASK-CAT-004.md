# TASK-CAT-004 · Coste estándar
- Hito M2 · 0,5 días · Escalado: no
- Historias / RNF: US-CAT-04
- Depende de: TASK-CAT-001

## Objetivo
Coste estándar por producto con vigencia y aviso al vender por debajo del coste (Q-017).

## Contexto
`catalog.standard_cost` · US-CAT-04.

## Ficheros
`api/src/core/catalog/cost.ts`, `api/src/routes/standard-costs.ts`.

## Interfaz exacta
`standardCost(tx, { productId, date }): Promise<Decimal|null>`; en pedidos y facturas, línea con precio neto < coste → aviso `WC_INV_BELOW_COST` (no bloqueo; requiere motivo).

## Criterios de aceptación
- El aviso aparece y el motivo queda auditado.

## Tests requeridos
Unitarios y un E2E en el formulario de pedido.
