# TASK-INFRA-002 · CI de calidad (`ci.yml`)
- Hito M0 · 1,5 días · Escalado: no
- Historias / RNF: RNF-05, RNF-07
- Depende de: TASK-INFRA-001

## Objetivo
Workflow de GitHub Actions con los jobs obligatorios para el merge descritos en ADR 007 §2.

## Contexto
ADR 007 §2 · `11-tests.md` §2 (gates) · `02-ddl/README.md` (validación de BD).

## Ficheros
`.github/workflows/ci.yml`, `scripts/ci/db-invariants.sh`.

## Interfaz exacta
Jobs: `lint-ts`, `typecheck`, `lint-py`, `typecheck-py`, `unit`, `db-invariants` (servicio `postgres:16`; aplica `0000_roles`, migraciones, `0099_grants` y `invariants_test.sql`), `integration`, `golden`, `property`, `evals`, `e2e-smoke`. Disparo en PR y push a `dev`/`staging`/`main`.

## Criterios de aceptación
- Un PR que rompe un invariante de BD hace fallar `db-invariants`.
- Los jobs sin código aún (p. ej. `evals`) pasan con "sin casos" explícito, no se omiten.
- Tiempo total < 15 min.

## Tests requeridos
PR de prueba con un fallo intencionado en `invariants_test.sql` (se descarta tras comprobarlo).
