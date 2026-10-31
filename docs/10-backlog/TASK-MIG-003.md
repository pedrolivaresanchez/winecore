# TASK-MIG-003 · Catálogo propuesto y aprobado
- Hito M1 · 1 día · Escalado: sí (migración)
- Historias / RNF: US-MIG-02
- Depende de: TASK-MIG-001, TASK-CAT-001

## Objetivo
Proponer vinos, formatos y productos a partir de los productos de Holded y de las líneas de factura, y cargarlos tras la aprobación.

## Contexto
`06-migracion.md` (propuesta de catálogo).

## Ficheros
`api/db/migration/datasets/catalog.ts`.

## Interfaz exacta
`--dry-run` → propuesta editable (CSV) con la correspondencia producto de Holded → producto de WineCore; `--load` con la propuesta aprobada.

## Criterios de aceptación
- Cada producto de Holded vendido en 2025–2026 queda mapeado o marcado "sin correspondencia" con motivo.

## Tests requeridos
Ficheros sintéticos con variantes de nombre y añada.
