# TASK-INFRA-010 · Copias, exportación y prueba de restauración
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: RNF-04, RNF-09
- Depende de: TASK-INFRA-003, TASK-CORE-006

## Objetivo
Exportación semanal propia de todas las tablas de negocio (además de las copias diarias de Timbal), descarga mensual por Pedro y procedimiento de restauración trimestral en una KB de pruebas con verificación de la cadena de auditoría (y de la cadena Verifactu desde M4, `verifactu.md` §14.9).

## Contexto
ADR 002 §5 · RNF-04, RNF-09 · `07-arquitectura.md` §12.

## Ficheros
`api/src/jobs/exports.ts`, `api/src/routes/exports.ts`, `docs/runbooks/restauracion.md`.

## Interfaz exacta
Job `weekly-export` (domingo 03:00, Madrid) → un fichero Parquet por tabla y un manifiesto con recuentos y SHA-256, como adjuntos enlazados a su `ops.job_run`. `GET /api/v1/exports` y `GET /api/v1/exports/{fecha}` (solo `owner`) para descargarlos.

## Criterios de aceptación
- La restauración de una exportación en una KB de pruebas (o DuckDB local) da los mismos recuentos y pasa `verifyAuditChain()`; desde M4, compara además la última huella Verifactu con la consulta a la AEAT antes de reabrir la emisión.
- Un fallo de la exportación genera alerta (copia semanal fallida, `07-arquitectura.md` §12).

## Tests requeridos
Integración: exportación y restauración de la BD sintética en DuckDB local; recuento de filas idéntico.
