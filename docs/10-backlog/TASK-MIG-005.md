# TASK-MIG-005 · Revisión de albaranes pendientes
- Hito M2 · 1 día · Escalado: sí (migración)
- Historias / RNF: US-MIG-04
- Depende de: TASK-MIG-001, TASK-VENT-003

## Objetivo
Cargar los albaranes pendientes de facturar de Holded para revisión (vivo, cerrado, descartado) y convertir los vivos en albaranes de WineCore sin movimientos de stock (el stock sale del aforo).

## Contexto
`06-migracion.md` (albaranes: 851 revisados, 28 vivos) · riesgo R5.

## Ficheros
`api/db/migration/datasets/delivery_notes_review.ts`, pantalla de revisión dentro de UI-41.

## Interfaz exacta
`--dry-run` → lista con propuesta de estado; la decisión por albarán la toma una persona; `--load` crea solo los vivos.

## Criterios de aceptación
- Ningún albarán migrado genera movimientos físicos ni fiscales.

## Tests requeridos
Integración con albaranes sintéticos en los tres estados.
