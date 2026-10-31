# TASK-CAT-002 · Tarifas versionadas (UI-09)
- Hito M1 · 1,5 días · Escalado: no
- Historias / RNF: US-CAT-02
- Depende de: TASK-CAT-001, TASK-APR-001

## Objetivo
Versiones de tarifa sin solapes, precio para un cliente y fecha, importación CSV al borrador y activación con aprobación.

## Contexto
`02-modelo-dominio.md` §7 (precios, `WC050`) · UI-09.

## Ficheros
`api/src/core/catalog/pricing.ts`, `api/src/routes/price-lists.ts`, `ui/src/pages/catalog/pricelists/*`.

## Interfaz exacta
```ts
export async function priceFor(tx, { customerId, productId, qty, date }): Promise<{ unitPrice: Decimal; priceListVersionId: UUID; minQty?: number }>
GET /api/v1/price-quote?customer_id=&product_id=&qty=&date=
POST /api/v1/price-lists/{id}/versions/{v}/request-activation
```

## Criterios de aceptación
- Solape de vigencias rechazado (`WC050`).
- Prioridad: tarifa del cliente > tarifa del canal > tarifa general.

## Tests requeridos
Unitarios de `priceFor` (tabla de casos); integración de activación con aprobación.
