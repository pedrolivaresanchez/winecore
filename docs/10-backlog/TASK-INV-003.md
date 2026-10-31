# TASK-INV-003 · Aforos (UI-22)
- Hito M2 · 2 días · Escalado: sí (conciliación)
- Historias / RNF: US-INV-04
- Depende de: TASK-INV-001, TASK-APR-001

## Objetivo
Recuentos físicos desde el móvil (también sin conexión), cierre con diferencias y contabilización aprobada (`count_adjust_*` y `regularization_*`).

## Contexto
`08-ui/UI-22-aforos.md` · `inventory.inventory_count` · `silicie.md` §5 (A30/A31).

## Ficheros
`api/src/core/inventory/counts.ts`, `api/src/routes/inventory-counts.ts`, `ui/src/pages/stock/counts/*` (con almacenamiento local).

## Interfaz exacta
`POST /api/v1/inventory-counts` · `PUT .../lines` · `POST .../close` · `POST .../post-request` (aprobación `inventory_adjustment`).

## Criterios de aceptación
- Las líneas guardadas sin conexión se sincronizan sin duplicarse (clave por dispositivo + línea).
- Volumen contado > capacidad → error.

## Tests requeridos
Integración del ciclo completo; E2E móvil con red cortada y restablecida.
