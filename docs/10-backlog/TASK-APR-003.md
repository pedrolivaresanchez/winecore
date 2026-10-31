# TASK-APR-003 · Políticas de aprobación (UI-39)
- Hito M1 · 0,5 días · Escalado: no
- Historias / RNF: US-APR-03
- Depende de: TASK-APR-001

## Objetivo
Semillas de políticas por defecto (una por tipo y entidad) y pantalla para editarlas con aprobación del `owner`.

## Contexto
`08-ui/UI-39-politicas.md` · `ops.approval_policy` · Q-005.

## Ficheros
`api/db/seed/approval_policies.ts`, `api/src/routes/approval-policies.ts`, `ui/src/pages/settings/approvals/*`.

## Interfaz exacta
`GET /api/v1/approval-policies` · `PUT /api/v1/approval-policies/{id}` → solicitud de aprobación.

## Criterios de aceptación
- Ningún tipo queda sin aprobador; ningún cliente de máquina puede ser aprobador.

## Tests requeridos
Integración de las validaciones y de la semilla.
