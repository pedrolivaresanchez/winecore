# TASK-AUTH-005 · Autenticación de las rutas `/api/m2m/*`
- Hito M1 · 1 día · Escalado: sí (seguridad)
- Historias / RNF: US-MCP-01, US-SIL-03
- Depende de: TASK-AUTH-004, Q-028 (respuesta de Timbal)

## Objetivo
Implementar la variante que Timbal confirme para que CVBOT, el ejecutor local y los webhooks lleguen a `/api/m2m/*`: token propio `wc_…` o identidad de Timbal dedicada mapeada a `core.api_client`.

## Contexto
ADR 008 §3 · ADR 009 (protocolo del ejecutor) · ADR 010.

## Ficheros
`api/src/m2m/auth.ts`, `api/src/m2m/index.ts`.

## Interfaz exacta
Middleware `m2mAuth()` → `ApiClientCtx { clientId, scopes }`; rechaza cualquier petición sin credencial válida con 401 y registra el intento (sin el token).

## Criterios de aceptación
- Las rutas de la UI no aceptan tokens de máquina y viceversa.
- Prueba en `dev` desde fuera de Timbal con la variante elegida.

## Tests requeridos
Integración de ambas variantes (con banderas) y prueba de humo remota.
