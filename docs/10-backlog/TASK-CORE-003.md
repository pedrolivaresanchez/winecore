# TASK-CORE-003 · API Elysia: módulos, permisos e idempotencia
- Hito M0 · 1,5 días · Escalado: sí (idempotencia y seguridad)
- Historias / RNF: US-CORE-04, RNF-05
- Depende de: TASK-CORE-002, TASK-AUTH-001

## Objetivo
Aplicación Elysia con registro de módulos activables, guarda de permisos por ruta, cabecera `Idempotency-Key` para escrituras y respuesta de errores uniforme.

## Contexto
`07-arquitectura.md` §4 y §6 · `02-modelo-dominio.md` §2 (módulos) · ADR 008 · tabla `ops.idempotency_key`.

## Ficheros
`api/src/index.ts`, `api/src/routes/_module.ts`, `api/src/routes/_permissions.ts`, `api/src/routes/_idempotency.ts`, `api/src/routes/health.ts`.

## Interfaz exacta
```ts
defineModule({ code: 'billing', routes, mcpTools, jobs }) // se monta solo si core.module_state lo activa
requirePermission('billing.issue', { entityFrom: 'body.legal_entity_id' })
// Idempotency-Key: misma clave + mismo cuerpo → misma respuesta; misma clave + otro cuerpo → 409 WC_IDEMPOTENCY_MISMATCH
GET /health → { sha, version, db: 'ok' }
```

## Criterios de aceptación
- Módulo desactivado → 404 en sus rutas y herramientas.
- Sin permiso → 403 sin filtrar datos.
- Dos peticiones concurrentes con la misma clave producen un solo efecto.

## Tests requeridos
Integración: módulo apagado/encendido; matriz de permisos por rol (tabla de `07-arquitectura.md` §6); concurrencia de idempotencia (2 peticiones simultáneas).
