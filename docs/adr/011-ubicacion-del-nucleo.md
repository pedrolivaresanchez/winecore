# ADR 011 · Ubicación del núcleo (dominio, BD y migraciones)

- **Estado**: propuesto · 31-10-2026
- **Fuentes** (31-10-2026): https://docs.timbal.ai/deployment/platform ("Builds and runs the UI, API, and every workforce member as separate deployable units"), README generado por `timbal create` ("Do not rename or move the `api/`, `ui/`, or `workforce/` directories"), plantilla https://github.com/timbal-ai/blueprint-api.

## Contexto
El plan (§3.4) propone una carpeta `core/` en la raíz y pide decidir su ubicación en un ADR. Timbal construye `api/`, `ui/` y cada miembro de `workforce/` como **unidades separadas**; no está documentado que el build de `api/` incluya carpetas hermanas (`../core`) ni que resuelva *workspaces* de Bun en la raíz.

## Decisión
1. El núcleo vive **dentro de `api/`**:
   - `api/src/core/` — dominio en TypeScript (servicios, cálculos, máquinas de estado, renderizadores regulatorios). **No importa** Elysia ni nada de `routes/`, `mcp/` o `jobs/` (regla de Biome `noRestrictedImports` + test de arquitectura).
   - `api/db/migrations/` — los SQL de `docs/02-ddl/` copiados tal cual; `api/db/migrate.ts`, `api/db/seed.ts`, `api/db/synthetic.ts`.
   - `api/src/routes/` (REST para la UI), `api/src/mcp/` (herramientas MCP), `api/src/jobs/` (cron con `timbalCron`), `api/src/m2m/` (ejecutor, webhooks).
2. **Solo `api/` accede a la base de datos.** La UI, la workforce (Python), CVBOT y el ejecutor local usan la API REST o el MCP. Así la lógica de negocio tiene un único sitio (plan §3.4).
3. Si más adelante Timbal confirma que el build admite *workspaces* en la raíz, se podrá extraer `api/src/core/` a `core/` sin cambiar el código (solo la ruta de importación).

## Consecuencias
- Un solo despliegue contiene núcleo + API: transacciones locales, sin llamadas de red internas para la lógica crítica (factura + Verifactu + stock en una transacción).
- Los miembros de la workforce son clientes de la API (tokens de servicio con alcances, ADR 008).
