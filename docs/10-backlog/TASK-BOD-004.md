# TASK-BOD-004 · Ensamblaje con y sin fórmula
- Hito M2 (sin fórmula) / M4 (con fórmula) · 1,5 días · Escalado: no
- Historias / RNF: US-BOD-03
- Depende de: TASK-BOD-002

## Objetivo
Ensamblar varios lotes en un lote nuevo con aristas del DAG; con fórmula, convertir mL → % → L.

## Contexto
`02-modelo-dominio.md` §9.2 · `sisv.md` §4.2 (ELABORA, mezcla).

## Ficheros
`api/src/core/cellar/ops/blend.ts`.

## Interfaz exacta
`blendFromFormula({ formula: { lotId, sharePct }[]; targetVolumeMl }): OperationLines` (suma de porcentajes = 100 ± 0,01).

## Criterios de aceptación
- El lote nuevo hereda la añada solo si todas las entradas la comparten (si no, añada nula y aviso).

## Tests requeridos
Unitarios de la fórmula (redondeo sin perder mL); integración del DAG.
