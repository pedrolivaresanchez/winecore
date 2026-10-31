# TASK-BOD-007 · Mermas y destrucciones con aprobación
- Hito M2 · 1 día · Escalado: no
- Historias / RNF: US-BOD-06
- Depende de: TASK-BOD-002, TASK-APR-001

## Objetivo
Mermas autorizadas (directas) y por incidencia o destrucción (con motivo y aprobación `cellar_loss` antes de tener efectos).

## Contexto
`03-maquinas-estado.md` §2 · `silicie.md` §5 (A28, A30).

## Ficheros
`api/src/core/cellar/ops/loss.ts`.

## Interfaz exacta
`loss` y `destruction` → si `loss_kind = 'incident'` o destrucción: estado `pending_approval` hasta la decisión.

## Criterios de aceptación
- Sin aprobación no hay movimientos.

## Tests requeridos
Integración del flujo aprobado y rechazado.
