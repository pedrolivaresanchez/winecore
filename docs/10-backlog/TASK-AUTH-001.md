# TASK-AUTH-001 · Acceso con Timbal y lista blanca
- Hito M0 · 1 día · Escalado: sí (seguridad)
- Historias / RNF: US-CORE-01
- Depende de: TASK-CORE-001, TASK-INFRA-004

## Objetivo
Login con `timbalAuth` (Microsoft) y comprobación de que la persona está activa en `core.app_user`; pantalla UI-01.

## Contexto
ADR 008 · UI-01 · `07-arquitectura.md` §6.

## Ficheros
`api/src/routes/me.ts`, `api/src/core/auth/session.ts`, `ui/src/pages/login/*`.

## Interfaz exacta
`GET /api/v1/me` → `{ user: { id, name, email }, roles: [{ role, entityId|null }], modules: string[] }`; persona no autorizada → `403 WC_AUTH_NOT_ALLOWED` (mismo mensaje exista o no la cuenta).

## Criterios de aceptación
- Una cuenta revocada pierde el acceso en la siguiente petición.
- El mensaje de error no revela si la cuenta existe.

## Tests requeridos
Integración con identidad simulada de Timbal (permitida, no listada, revocada).
