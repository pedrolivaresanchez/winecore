# TASK-REG-011 · Cuadre SISV ↔ SILICIE (UI-29)
- Hito M3 · 1,5 días · Escalado: sí (cuadre SISV ↔ SILICIE)
- Historias / RNF: US-SIL-05
- Depende de: TASK-REG-004, TASK-REG-012

## Objetivo
Comparar por mes y concepto (entradas, elaboración, envasado, salidas, mermas) los litros de SISV y de SILICIE, explicar cada diferencia y bloquear las aprobaciones si quedan diferencias sin explicar.

## Contexto
`04-regulatorio/silicie.md` §10 · `08-ui/UI-29-cuadres.md`.

## Ficheros
`api/src/core/regulatory/reconcile/sisvSilicie.ts`, `ui/src/pages/regulatory/reconciliation/*`.

## Interfaz exacta
`reconcileSisvSilicie(tx, { entityId, month }): { rows: { concept; sisvL; silicieL; diffL; explanation? }[]; status: 'balanced'|'differences' }` → `reconciliation_run` + `reconciliation_diff`.

## Criterios de aceptación
- Diferencias por la agregación mensual de SILICIE se comparan con totales del mes y no cuentan como diferencia.

## Tests requeridos
Propiedad: con hechos sintéticos coherentes, el cuadre siempre da `balanced`.
