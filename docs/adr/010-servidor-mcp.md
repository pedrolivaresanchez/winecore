# ADR 010 · Servidor MCP de WineCore

- **Estado**: propuesto · 31-10-2026
- **Fuentes** (31-10-2026): README de `@timbal-ai/timbal-sdk` (`timbalMcp`: Streamable HTTP sin estado en `POST /mcp`, protocolos 2025-06-18, 2025-03-26 y 2024-11-05; exposición por etiquetas de rutas; autenticación delegada en `timbalAuth`), https://docs.timbal.ai/agents/mcp (`MCPServer(..., service="api")` para que los agentes del proyecto usen la API), especificación MCP (https://modelcontextprotocol.io/specification/2025-06-18).

## Contexto
§12.5: WineCore expone un **MCP completo, documentado y con permisos** (lectura libre, escritura con confirmación) que cubre todos los módulos, para que CVBOT opere el sistema desde el chat. Además, los agentes internos (asistente, vigilantes, OCR, vendimia) deben usar el mismo contrato.

## Decisión
1. **Un único catálogo de herramientas** definido en `api/src/mcp/tools/*.ts`, cada una con: nombre `modulo_verbo_objeto` (snake_case, inglés), descripción en español, esquema de entrada y salida (TypeBox), permiso requerido, tipo (`read` | `write`) y módulo (si el módulo está desactivado, la herramienta no se lista). Especificación completa en `13-mcp.md`.
2. **Transporte**: Streamable HTTP sin estado, implementado con el SDK oficial `@modelcontextprotocol/sdk` en la ruta **`/api/m2m/mcp`** de `api/` (autenticación con token WineCore, ADR 008). Si Timbal no permite rutas fuera de `timbalAuth`, se usa `timbalMcp` en `/api/mcp` con identidades de Timbal mapeadas a `api_client` (misma lista de herramientas).
3. **Lectura libre**: herramientas `read` sin confirmación, siempre filtradas por los permisos del cliente y de la persona a la que representa (`on_behalf_of`).
4. **Escritura con confirmación en dos pasos**: cada escritura `X` se expone como `X_prepare` (valida, calcula y devuelve una vista previa + `confirmation_token` de un solo uso, caducidad 10 min, ligado al hash de los argumentos) y `X_commit(confirmation_token)` (ejecuta exactamente lo previsualizado). CVBOT debe mostrar la vista previa a la persona y pedir su "sí" antes del `commit`.
5. ~~**Nunca por MCP**: aprobar envíos regulatorios o lotes de facturas, activar módulos o reglas, cambiar permisos, ver secretos, borrar datos.~~ Sustituido por la revisión 2 (abajo).
6. **Auditoría**: cada llamada se registra (`audit.log_event('mcp.call', …)`) con herramienta, cliente, persona representada, hash de argumentos y resultado (sin datos personales en claro en el log de la plataforma).
7. **Límites**: 60 llamadas/minuto por cliente; respuestas paginadas (máx. 100 elementos); textos largos truncados con indicación.
8. **Resistencia a inyección de instrucciones**: los textos que vienen de terceros (descripciones de facturas recibidas, mensajes EDI, correos) se devuelven en campos marcados `untrusted_text` y nunca se interpretan como órdenes en el servidor; las herramientas de escritura no aceptan argumentos que no estén en su esquema.

## Revisión 2 · 01-11-2026 (decisión de Pedro)
El propietario tiene que poder hacer **todo** lo de la app desde el móvil hablando con CVBOT. Cambia el punto 5:
- Por MCP se puede hacer todo lo que hace la web, también aprobar, rechazar, emitir, anular, enviar y borrar. **Toda escritura va en dos pasos** (`*_prepare` / `*_commit`) y el registro de herramientas no acepta un nombre con esos verbos que no lo sea.
- Cada herramienta de la app reproduce en el propio proceso la ruta REST que usa la web, con la sesión de la persona representada (`api/src/mcp/rest.ts`): los mismos permisos, validaciones, aprobaciones, passkey y auditoría que en la UI. No hay segunda implementación.
- Siguen fuera, con su motivo en `api/src/mcp/parity.ts`: el acceso y las credenciales de la persona, los tokens de máquina, el chat del asistente, rebajar la seguridad de las aprobaciones y dar de alta o cambiar personas y roles (piden passkey del propietario). Lo que la API protege con passkey reciente sigue sin poder hacerse por MCP.
- `api/test/mcp/route-parity.test.ts` falla si una ruta `/v1` de la app no tiene herramienta ni motivo escrito.

## Consecuencias
- La UI y el MCP comparten servicios del núcleo (no hay lógica en el MCP).
- La documentación de herramientas se genera desde los esquemas (`bun api/scripts/mcp-docs.ts > docs/13-mcp-catalogo.generado.md`) y CI comprueba que coincide con `13-mcp.md`.
