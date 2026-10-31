# TASK-REG-020 · Lectura de pedidos y avisos en AecocEDI
- Hito M3 · 2 días · Escalado: sí (datos de terceros)
- Historias / RNF: US-EDI-02
- Depende de: TASK-REG-019, TASK-RUN-002, TASK-VENT-002

## Objetivo
Procedimiento del ejecutor que lee en AecocEDI los ORDERS, REMADV y GENRAL avisados, los normaliza (`aecoc-edi.md` §4) y crea el pedido de ECI por GTIN (`catalog.gtin_current`).

## Contexto
`04-regulatorio/aecoc-edi.md` §4.1, §4.3–§4.4 · ADR 006.

## Ficheros
`runner/src/procedures/aecocedi.read_documents.ts`, `api/src/core/regulatory/edi/orders.ts`.

## Interfaz exacta
`parsedOrderToSalesOrder(tx, msg): Promise<{ orderId; unknownLines: { gtin; qty }[] }>`.

## Criterios de aceptación
- GTIN desconocido → línea marcada y pedido sin confirmar.

## Tests requeridos
Golden `api/test/golden/edi/orders_sintetico.json`.
