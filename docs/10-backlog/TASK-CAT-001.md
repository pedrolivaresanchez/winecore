# TASK-CAT-001 · Vinos, formatos y productos (UI-07/08)
- Hito M1 · 2 días · Escalado: no
- Historias / RNF: US-CAT-01
- Depende de: TASK-CORE-003, TASK-UI-002

## Objetivo
API y pantallas de vinos, formatos y productos (sin la pestaña de etiqueta), con GTIN (dígito de control), "GTIN vigente", código NC y mayor SILICIE.

## Contexto
`02-modelo-dominio.md` §7 · UI-07, UI-08 · `catalog.gtin_current`.

## Ficheros
`api/src/core/catalog/*`, `api/src/routes/{wines,formats,products}.ts`, `ui/src/pages/catalog/*`.

## Interfaz exacta
`GET/POST /api/v1/products` (filtros `missing=gtin|nc_code|silicie`) · `POST /api/v1/products/{id}/gtin-current`.

## Criterios de aceptación
- Producto vino exige vino, añada y formato; único por la combinación.
- Con movimientos, vino/añada/formato quedan bloqueados.

## Tests requeridos
Unitario del dígito de control GS1; integración de unicidad y bloqueo; E2E del alta.
