# TASK-COMP-003 · Libro de recibidas
- Hito M2 · 1 día · Escalado: sí (fiscal)
- Historias / RNF: US-COMP-03
- Depende de: TASK-COMP-002

## Objetivo
Libro de facturas recibidas por entidad y trimestre con las columnas de `modelos-aeat.md` §2 y PDF.

## Contexto
`04-regulatorio/modelos-aeat.md` §2.

## Ficheros
`api/src/core/purchasing/books.ts`, ruta `GET /api/v1/supplier-invoices/export`.

## Interfaz exacta
`exportReceivedBook(tx, { entityId, from, to })` con cuadres (libro = gastos aprobados del periodo).

## Criterios de aceptación
- Solo gastos aprobados; los rechazados y duplicados quedan fuera.

## Tests requeridos
Golden del CSV sintético.
