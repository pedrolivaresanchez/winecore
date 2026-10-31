# TASK-MIG-001 · Pipeline de migración
- Hito M1 · 1,5 días · Escalado: sí (migración)
- Historias / RNF: US-MIG-01
- Depende de: TASK-CORE-002

## Objetivo
Herramienta de migración con manifiesto, lotes de importación (`legacy.import_batch`), ensayo (`--dry-run`), carga aprobada (`--load --approved-report`), claves de idempotencia e informe.

## Contexto
`06-migracion.md` §3–§4 y §9 · regla dura 0.6 (datos reales solo en `data/`).

## Ficheros
`api/db/migration/run.ts`, `api/db/migration/manifest.ts`, `api/db/migration/verify.ts`, `api/db/migration/xlsx.ts` (detección de cabecera por nombres y descarte del pie "… - dd/mm/aaaa hh:mm").

## Interfaz exacta
`bun run api/db/migration/run.ts --dataset contacts --entity CVPO --file <ruta en data/> --dry-run` → informe JSON + Markdown (recuentos, avisos, ejemplos **enmascarados**); `--load --approved-report <hash>` solo si el hash coincide con un informe aprobado.

## Criterios de aceptación
- Repetir una carga no duplica (claves de idempotencia de `06-migracion.md`).
- Ningún dato real en logs ni en el repositorio; los tests usan `api/test/fixtures/synthetic/holded/`.

## Tests requeridos
Integración con ficheros sintéticos generados en el test (cabeceras reales, datos inventados); idempotencia.
