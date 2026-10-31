# TASK-MCP-001 · Servidor MCP y confirmación en dos pasos
- Hito M1 · 2 días · Escalado: sí (seguridad e idempotencia)
- Historias / RNF: US-MCP-01, US-MCP-02, US-MCP-03
- Depende de: TASK-AUTH-005, TASK-APR-001

## Objetivo
Servidor MCP en `/api/m2m/mcp` con el catálogo base (`system_*`, `approvals_*`, `contacts_*`, `catalog_*`), alcances por cliente y escrituras en dos pasos (`*_prepare` → token de confirmación de 15 min → `*_commit`).

## Contexto
`13-mcp.md` · ADR 010 · `ops.mcp_confirmation`.

## Ficheros
`api/src/mcp/server.ts`, `api/src/mcp/confirm.ts`, `api/src/mcp/tools/{system,approvals,contacts,catalog}.ts`.

## Interfaz exacta
Herramientas y esquemas exactamente como en `13-mcp.md`; `approvals_get_link` devuelve un enlace a la bandeja; **no existe** herramienta para decidir aprobaciones.

## Criterios de aceptación
- Un `*_commit` con token caducado o de otro cliente → error; con el mismo token dos veces → mismo resultado (idempotente).
- Las respuestas marcan el texto de terceros como `untrusted_text`.

## Tests requeridos
Integración de los dos pasos, caducidad, alcances y repetición.
