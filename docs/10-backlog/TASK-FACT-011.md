# TASK-FACT-011 · Libro de emitidas y exportación
- Hito M2 · 1 día · Escalado: sí (fiscal)
- Historias / RNF: US-FACT-11
- Depende de: TASK-FACT-003

## Objetivo
Libro de facturas emitidas por entidad y periodo (CSV/XLSX) con las columnas de `modelos-aeat.md` §2 y ZIP de PDF, con los tres cuadres obligatorios.

## Contexto
`04-regulatorio/modelos-aeat.md` §2–§3.

## Ficheros
`api/src/core/billing/books.ts`, ruta `GET /api/v1/invoices/export?entity=&period=`.

## Interfaz exacta
`exportIssuedBook(tx, { entityId, from, to }): Promise<{ csv: string; xlsx: Uint8Array; checks: { name; ok; detail }[] }>`; si un cuadre falla, no se exporta.

## Criterios de aceptación
- Libro = facturas del periodo = registros Verifactu aceptados (sin diferencias).

## Tests requeridos
Golden del CSV con datos sintéticos; test de cuadre fallido.
