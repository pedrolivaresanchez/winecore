# TASK-BOD-006 · Adiciones y limpiezas
- Hito M2 · 1 día · Escalado: no
- Historias / RNF: US-BOD-05, US-BOD-13
- Depende de: TASK-BOD-002

## Objetivo
Registrar adiciones (SO₂, ácido tartárico) con dosis, cantidad y factura, y limpiezas con producto, sustancia activa y comprobación de eficacia.

## Contexto
`cellar.addition`, `cellar.cleaning_record` · `ecologico.md` §2 (R5–R9) · `sisv.md` §4.3.

## Ficheros
`api/src/core/cellar/ops/addition.ts`, `api/src/core/cellar/ops/cleaning.ts`.

## Interfaz exacta
Manejadores de `addition` (filas en `cellar.addition`, sin volumen) y `cleaning` (filas en `cellar.cleaning_record`, eficacia obligatoria).

## Criterios de aceptación
- En lotes ecológicos solo productos marcados como aptos.
- Acidificación con ácido tartárico genera la práctica SISV correspondiente (gancho para TASK-REG-012).

## Tests requeridos
Integración de ambos manejadores y del rechazo de producto no apto.
