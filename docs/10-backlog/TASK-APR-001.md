# TASK-APR-001 · Servicio de aprobaciones ligadas al hash
- Hito M1 · 1,5 días · Escalado: sí (seguridad)
- Historias / RNF: US-APR-01, US-APR-02, US-APR-03
- Depende de: TASK-AUTH-003

## Objetivo
Crear solicitudes de aprobación con el SHA-256 del contenido canónico, decidirlas con verificación reforzada, caducarlas y recordarlas, y ejecutar la acción aprobada por su manejador.

## Contexto
`03-maquinas-estado.md` §12 · `02-ddl/0002_ops.sql` (WC040–WC043) · regla dura 0.3.

## Ficheros
`api/src/core/approvals/service.ts`, `api/src/core/approvals/handlers.ts`, `api/src/routes/approvals.ts`, `api/src/jobs/approval-expiry.ts`.

## Interfaz exacta
```ts
requestApproval(tx, { kind: ApprovalKind; entityId?: UUID; payload: CanonicalJson; summary: string; sourceRef: Ref }): Promise<ApprovalRequest>
decide(tx, { requestId, decision: 'approve'|'reject', payloadSha256, reason?, user }): Promise<void> // exige step-up ≤ 5 min
registerHandler(kind, async (tx, request) => { /* ejecuta lo aprobado */ })
GET /api/v1/approvals · GET /api/v1/approvals/{id} · POST /api/v1/approvals/{id}/decision
```

## Criterios de aceptación
- Si el contenido cambia, el hash no coincide y la decisión falla (`WC042`).
- Un cliente de máquina o agente no puede decidir (403) y no existe herramienta MCP para ello.
- Caducidad y recordatorios según la política.

## Tests requeridos
Integración de los cuatro errores WC040–WC043, de la autoaprobación según política y de la caducidad (reloj simulado).
