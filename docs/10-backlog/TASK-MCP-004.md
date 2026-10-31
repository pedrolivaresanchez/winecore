# TASK-MCP-004 · Pruebas de seguridad del MCP
- Hito M1 · 1 día · Escalado: sí (seguridad)
- Historias / RNF: US-MCP-03
- Depende de: TASK-MCP-001

## Objetivo
Batería obligatoria de `13-mcp.md` (pruebas): no hay herramientas de aprobación ni de envío a terceros, alcances respetados, inyección de instrucciones en textos de terceros sin efecto, límites de tamaño y de frecuencia.

## Contexto
`13-mcp.md` (pruebas obligatorias) · ADR 010.

## Ficheros
`api/test/integration/mcp-security.test.ts`.

## Interfaz exacta
Cliente MCP de pruebas que enumera herramientas y ejecuta los casos.

## Criterios de aceptación
- La lista de herramientas no contiene ninguna que decida aprobaciones, emita facturas o envíe a terceros.

## Tests requeridos
Los propios casos, obligatorios en `ci.yml`.
