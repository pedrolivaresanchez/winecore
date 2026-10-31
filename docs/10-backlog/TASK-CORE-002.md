# TASK-CORE-002 · Esquema DuckDB y migraciones
- Hito M0 · 2 días · Escalado: sí (esquema transversal)
- Historias / RNF: RNF-07
- Depende de: TASK-CORE-001, TASK-INFRA-003 (resultados de la prueba)

## Objetivo
Traducir el modelo lógico de `docs/02-ddl/` al esquema físico de DuckDB y escribir el aplicador de migraciones, que funciona igual contra DuckDB local (CI y desarrollo) y contra la Knowledge Base.

## Contexto
ADR 002 (decisión y tabla de equivalencias) · `docs/02-ddl/README.md` · `02-modelo-dominio.md` §19–§21.

## Ficheros
`api/db/migrations/0001_core.sql` … `0016_legacy.sql` (DuckDB), `api/db/migrate.ts`, `api/src/core/db/guards/index.ts` (registro de guardas), `api/test/db/schema.test.ts`, `api/test/db/coverage.test.ts`.

## Interfaz exacta
`bun api/db/migrate.ts (--local <fichero.duckdb> | --kb <id>) [--dry-run | --apply]` → aplica las pendientes en orden, registra `(file, sha256, applied_at)` en `core.schema_migration` y falla si el SHA de un fichero ya aplicado cambió. `guards: Record<WcCode, { kind: 'native' | 'core'; owner: TaskId; implemented: boolean }>`.

## Criterios de aceptación
- BD vacía → las 135 tablas y vistas del modelo, con las mismas columnas y los tipos de la tabla de equivalencias (`schema.test.ts` lo compara con `docs/02-ddl`).
- Cada código `WCnnn` del DDL de referencia está en el registro de guardas con su tarea dueña; `coverage.test.ts` falla si falta alguno o si una guarda marcada como implementada no tiene test.
- Modificar un fichero ya aplicado hace fallar `migrate.ts`.

## Tests requeridos
Job `db-invariants` de la CI; test de integración del cambio de SHA.
