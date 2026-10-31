# TASK-VENT-004 · Consigna, traspasos y devoluciones
- Hito M2 · 1,5 días · Escalado: no
- Historias / RNF: US-VENT-04, US-VENT-05
- Depende de: TASK-VENT-003

## Objetivo
Albaranes de consigna y traspaso (salida en origen + entrada en destino), anulación antes de la salida y devoluciones de cliente.

## Contexto
`03-maquinas-estado.md` §4 · Q-021 (almacenes externos) · Q-030 (devoluciones y zona fuera de fábrica).

## Ficheros
`api/src/core/sales/transfers.ts`, `api/src/core/sales/returns.ts`.

## Interfaz exacta
`POST /api/v1/delivery-notes/{id}/void` (solo si no ha salido) · `POST /api/v1/delivery-notes/{id}/return { lines, toLocationId }` → `return_in` físico; el fiscal solo si la ubicación lo permite (Q-030).

## Criterios de aceptación
- Una devolución nunca crea entrada fiscal en la fábrica si ya se devengó el impuesto (silicie.md §11).

## Tests requeridos
Integración de traspaso, anulación y devolución con ubicación dentro y fuera del perímetro fiscal.
