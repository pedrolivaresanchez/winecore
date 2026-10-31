# TASK-BOD-016 · Estabilización y filtración por placas con consumibles
- Hito M2 · 1 día · Escalado: no
- Historias / RNF: US-BOD-17
- Depende de: TASK-BOD-002, TASK-BOD-012
- Estado: en construcción (ramas `cursor/higiene-envasado-2060` y `cursor/elaboracion-analiticas-2060`)

## Objetivo
Estabilización natural o forzada con temperatura objetivo y bitartratos; filtración con grado de placa, proveedor, equipo y consumo de placas.

## Contexto
`02-modelo-dominio.md` §9.2 y §9.6 · DDL `cellar.filtration_detail`, `cellar.lot_phase`, producto `cellar_consumable`.

## Ficheros
`api/src/core/hygiene/**` (consumibles y filtración) y `api/src/core/winemaking/**` (estabilización).

## Interfaz exacta
Detalle de filtración en el borrador de la operación · fase de estabilización en el lote.

## Criterios de aceptación
- Las placas bajan del stock al confirmar la filtración.
- La estabilización por frío propone −(grado/2 + 1) °C.

## Tests requeridos
Unit e integración.
