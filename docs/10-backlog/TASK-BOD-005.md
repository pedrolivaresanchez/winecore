# TASK-BOD-005 · Envasado y etiquetado de jaulón
- Hito M2 · 1,5 días · Escalado: no
- Historias / RNF: US-BOD-04, US-BOD-07
- Depende de: TASK-BOD-002

## Objetivo
Envasado (botellas o BIB) con lote envasado nuevo y merma; etiquetado de jaulones (sin etiquetar → etiquetado) con roturas.

## Contexto
`02-modelo-dominio.md` §9.2 (`bottling`, `labeling`, `WC023`) · `silicie.md` §5 (A14/A15 con envases, A32) · `sisv.md` §4.4.

## Ficheros
`api/src/core/cellar/ops/bottling.ts`, `api/src/core/cellar/ops/labeling.ts`.

## Interfaz exacta
Manejadores de `bottling` (entrada en mL; salida N unidades de un producto; merma = diferencia) y `labeling` (unidades; roturas como `loss`).

## Criterios de aceptación
- Entra = N × volumen nominal + merma (`WC023`).
- El lote envasado enlaza con el lote a granel en el DAG.

## Tests requeridos
Integración y golden de efectos SISV/SILICIE de un envasado de 600 botellas.
