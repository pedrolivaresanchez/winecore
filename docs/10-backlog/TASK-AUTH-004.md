# TASK-AUTH-004 · Clientes de máquina y tokens con alcances
- Hito M1 · 1 día · Escalado: sí (seguridad)
- Historias / RNF: US-MCP-01, US-CORE-07
- Depende de: TASK-AUTH-002

## Objetivo
`core.api_client` y `core.api_token` (hash del token `wc_…`), alcances explícitos, rotación y revocación; parte de UI-38.

## Contexto
ADR 008 §1–§2 · ADR 010 · UI-38.

## Ficheros
`api/src/core/auth/apiTokens.ts`, `api/src/routes/api-clients.ts`.

## Interfaz exacta
`POST /api/v1/api-clients` → token mostrado una sola vez (`wc_<base62 40>`); se guarda `sha256`. `requireScope('mcp:read')`. Un cliente de máquina nunca recibe `regulatory.approve` (validación al crear).

## Criterios de aceptación
- Token revocado → 401 inmediato.
- Intento de asignar `regulatory.approve` a un cliente de máquina → 422.

## Tests requeridos
Unitarios de generación/verificación; integración de rotación y revocación.
