# TASK-AUTH-002 · Roles por entidad y permisos
- Hito M0 · 1,5 días · Escalado: sí (seguridad)
- Historias / RNF: US-CORE-02
- Depende de: TASK-AUTH-001, TASK-CORE-003

## Objetivo
Asignación de roles por entidad y resolución de permisos según la matriz de `07-arquitectura.md` §6; gestión de personas (UI-37, parte de gestión).

## Contexto
`07-arquitectura.md` §6 · ADR 008 · UI-37.

## Ficheros
`api/src/core/auth/permissions.ts`, `api/src/routes/users.ts`, `ui/src/pages/settings/people/*`.

## Interfaz exacta
```ts
export function can(user: UserCtx, permission: Permission, entityId?: UUID): boolean
POST /api/v1/users · PATCH /api/v1/users/{id} · POST /api/v1/users/{id}/revoke
```

## Criterios de aceptación
- Siempre queda al menos un `owner` activo (intentar revocar el último → error).
- `approver` de P.O no puede decidir aprobaciones de CVPO.

## Tests requeridos
Tabla de verdad completa rol × permiso × entidad (generada desde la matriz) en tests unitarios.
