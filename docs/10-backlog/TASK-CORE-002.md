# TASK-CORE-002 · Migraciones de BD desde la especificación
- Hito M0 · 1 día · Escalado: sí (esquema transversal)
- Historias / RNF: RNF-07
- Depende de: TASK-CORE-001

## Objetivo
Copiar **tal cual** `docs/02-ddl/*.sql` a `api/db/migrations/` y escribir el aplicador de migraciones con tabla de control, una transacción por fichero y reaplicación de permisos.

## Contexto
`docs/02-ddl/README.md` · ADR 002 §3 · `02-modelo-dominio.md` §20.

## Ficheros
`api/db/migrations/0000_roles.sql` … `0016_legacy.sql`, `0099_grants.sql`, `api/db/migrate.ts`, `api/test/db/invariants_test.sql` (copia de la especificación).

## Interfaz exacta
`bun run api/db/migrate.ts --url $DATABASE_URL_MIGRATOR [--dry-run]` → aplica las pendientes en orden, registra `(file, sha256, applied_at)` en `core.schema_migration` y falla si el SHA de un fichero ya aplicado cambió.

## Criterios de aceptación
- BD vacía → 134 tablas y vistas; `invariants_test.sql` en verde.
- Modificar un fichero ya aplicado hace fallar `migrate.ts`.

## Tests requeridos
Job `db-invariants` de la CI; test de integración del cambio de SHA.
