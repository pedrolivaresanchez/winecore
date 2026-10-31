# TASK-INFRA-002 · CI de calidad (`ci.yml`)
- Hito M0 · 1,5 días · Escalado: no
- Historias / RNF: RNF-05, RNF-07
- Depende de: TASK-INFRA-001

## Objetivo
Workflow de GitHub Actions con los jobs obligatorios para el merge descritos en ADR 007 §2.

## Contexto
ADR 007 §2 · `11-tests.md` §2 (gates) y §4 (invariantes) · ADR 002.

## Ficheros
`.github/workflows/ci.yml`.

## Interfaz exacta
Jobs: `lint-ts`, `typecheck`, `lint-py`, `typecheck-py`, `unit`, `db-invariants` (DuckDB local, el mismo motor que la Knowledge Base: aplica `api/db/migrations` y ejecuta `api/test/db/`, ADR 002), `integration`, `golden`, `property`, `evals`, `e2e-smoke`. Disparo en PR y push a `dev`/`staging`/`main`.

## Criterios de aceptación
- Un PR que desactiva una guarda del núcleo o rompe una restricción del esquema hace fallar `db-invariants`.
- Los jobs sin código aún (p. ej. `evals`) pasan con "sin casos" explícito, no se omiten.
- Tiempo total < 15 min.

## Tests requeridos
PR de prueba con una guarda desactivada a propósito (se descarta tras comprobarlo).
