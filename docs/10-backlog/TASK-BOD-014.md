# TASK-BOD-014 · Recepción con sanidad y vinificación
- Hito M2 · 2 días · Escalado: sí (SILICIE de sangrado y descube, Q-040)
- Historias / RNF: US-BOD-08, US-BOD-09, US-BOD-10
- Depende de: TASK-BOD-009, TASK-BOD-010
- Estado: en construcción (ramas `cursor/vendimia-vinedo-2060` y `cursor/elaboracion-analiticas-2060`)

## Objetivo
Recepción con contenedores, pesada o estimación y sanidad; tipos de vinificación; fases del lote (maceraciones, FA espontánea, FML con observaciones, estabilizaciones, crianza); délestage, sangrado, descube y correcciones de temperatura.

## Contexto
`02-modelo-dominio.md` §9.2 y §9.3 · DDL `cellar.grape_intake`, `cellar.lot_phase`, tipos `bleeding`, `pressing_off`, `delestage`, `temperature_control` · UI-25.

## Ficheros
`api/src/core/winemaking/**`, `api/src/core/vineyard/**` (recepción), rutas y tests propios.

## Interfaz exacta
`POST /api/v1/cellar/operations` con los tipos nuevos · `POST/PATCH /api/v1/lots/{code}/phases` · detalle de recepción en el borrador.

## Criterios de aceptación
- Sangrado y descube cuadran volumen (`WC020`); délestage y control de temperatura no mueven volumen.
- Una recepción 'separar' o 'rechazar' no se mezcla con la sana.
- La FML se cierra por observación o por málico ≤ umbral; el solape FA/FML con volátil en aumento avisa.

## Tests requeridos
Unit (fases, sanidad) e integración (operaciones nuevas con libros).
