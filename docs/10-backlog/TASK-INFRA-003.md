# TASK-INFRA-003 · Knowledge Base de Timbal: alta y prueba de atomicidad
- Hito M0 · 2 días · Escalado: sí (arquitectura: integridad de los datos)
- Historias / RNF: RNF-04, RNF-07, RNF-08
- Depende de: Q-004 (credencial de Timbal de una cuenta dedicada **solo de la org 122**), Q-028 (preguntas a Timbal sobre la Knowledge Base)

## Objetivo
Dar de alta las Knowledge Bases de WineCore en la org 122 (producción, vinculada al proyecto 3942, y una de pruebas) y medir lo que la documentación de Timbal no dice antes de construir nada encima: atomicidad de una petición con varias sentencias, dos escritores a la vez, latencia y límites (ADR 002 §6).

## Contexto
ADR 002 (decisión, *fencing* y equivalencias) · `07-arquitectura.md` §14, pregunta 7 · riesgo R26 · Q-028.

## Ficheros
`scripts/spike/kb-probe.ts`, `docs/runbooks/knowledge-base.md` (KB creadas y sus ids, sin secretos; resultados con fecha).

## Interfaz exacta
`bun scripts/spike/kb-probe.ts --kb <id de la KB de pruebas> | --local <fichero.duckdb> [--case atomicity|fencing|concurrency|latency|documents|constraints]` → informe Markdown con un resultado por caso (PASA / FALLA / NO CONCLUYENTE) y los datos medidos. Rechaza ejecutarse contra la KB de producción.

## Criterios de aceptación
- **Atomicidad**: `BEGIN; INSERT …; INSERT … (viola un CHECK); COMMIT;` en una sola petición no deja ninguna fila; lo mismo con `SELECT error('…')` a mitad.
- ***Fencing***: una petición que comprueba `core.writer_lease` y aborta con `error()` no deja escrituras cuando el *lease* es de otra instancia.
- **Concurrencia**: dos clientes que escriben la misma fila a la vez → uno falla o se serializan; nunca se pierde una escritura sin error (se documenta qué ocurre).
- **Latencia**: p95 de una emisión de factura simulada (≈ 12 sentencias) y de una consulta de existencias, con la BD sintética ×10 (RNF-03).
- **Documentos**: un BLOB de 10 MB entra y sale con el mismo SHA-256.
- **Restricciones** que usa el esquema: clave foránea con UPDATE de la fila referenciada, UNIQUE con UPDATE en la misma transacción, `TIMESTAMPTZ`, `DECIMAL(14,2)`; mismo resultado en DuckDB local y en la KB.
- Si la atomicidad o el *fencing* FALLAN: **se para** y se escala a Pedro con opciones (ADR 002 §6); no se construye encima.

## Tests requeridos
El informe, revisado por Opus; los mismos casos en DuckDB local dentro de la CI para detectar diferencias entre el motor local y la KB.
