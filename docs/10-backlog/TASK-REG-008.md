# TASK-REG-008 · Apertura y cierre del ejercicio SILICIE
- Hito M2 · 1 día · Escalado: sí (II.EE.)
- Historias / RNF: US-SIL-06
- Depende de: TASK-REG-007

## Objetivo
Preparar y presentar (con aprobación) la comunicación de apertura antes del primer asiento del año y la de cierre dentro de plazo (Orden HAC/998/2019, art. 4 bis).

## Contexto
`04-regulatorio/silicie.md` §1–§2 · `regulatory.silicie_exercise`.

## Ficheros
`api/src/core/regulatory/silicie/exercise.ts`, `runner/src/procedures/silicie.exercise_open_close.ts`.

## Interfaz exacta
`openExercise(tx, { warehouseId, year })` · `closeExercise(tx, { warehouseId, year })` → envíos regulatorios con su aprobación; el estado del ejercicio impide asientos de ejercicios cerrados.

## Criterios de aceptación
- No se generan asientos de 2027 antes de comunicar la apertura.

## Tests requeridos
Integración del estado del ejercicio y del bloqueo.
