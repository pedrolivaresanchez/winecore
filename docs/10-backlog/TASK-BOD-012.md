# TASK-BOD-012 · Materiales de envasado: lista por formato, stock y consumo al envasar
- Hito M1 · 1,5 días · Escalado: no
- Historias / RNF: US-BOD-14
- Depende de: TASK-BOD-005, TASK-CAT-001

## Objetivo
Lista de materiales por formato (`catalog.format_material`: por botella, caja o palé), stock de materiales (productos `packaging_material`, en unidades) y consumo al confirmar un envasado.

## Contexto
`02-modelo-dominio.md` §7 y §9 · `02-ddl/0004_catalog.sql` (`catalog.format_material`) y `0006_cellar.sql` (`cellar.material_consumption`).

## Interfaz exacta
Migración DuckDB nueva para `catalog.format_material`; rutas de catálogo para la lista; cálculo en el envasado (palés: uno por cada `cases_per_pallet` cajas o fracción); salida de stock del material en la misma operación.

## Criterios de aceptación
- 600 botellas de 0,75 L → 600 corchos, 600 cápsulas de lacre, 100 cajas de 6 y 1 palé.
- Sin stock suficiente de un material: aviso en la vista previa y la confirmación falla sin escribir nada (WC024).

## Tests requeridos
Unitarios del cálculo (redondeos de cajas y palés) e integración del envasado con consumo atómico.
