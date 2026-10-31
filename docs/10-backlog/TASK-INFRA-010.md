# TASK-INFRA-010 · Copias, exportación y prueba de restauración
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: RNF-04, RNF-09
- Depende de: TASK-INFRA-003

## Objetivo
Volcado semanal y CSV mensual de todas las tablas de negocio a S3, y procedimiento de restauración trimestral con verificación de la cadena de auditoría y de la cadena Verifactu (verifactu.md §14.9).

## Contexto
RNF-04, RNF-09 · `07-arquitectura.md` §12.

## Ficheros
`api/src/jobs/exports.ts`, `docs/runbooks/restauracion.md`.

## Interfaz exacta
Job `weekly-dump` (domingo 03:00) y `monthly-csv` (día 1, 04:00) → objetos en `s3://<documents>/exports/AAAA-MM-DD/`.

## Criterios de aceptación
- La restauración en una BD temporal pasa `audit.verify_chain()` y compara la última huella Verifactu con la consulta a la AEAT antes de reabrir la emisión.

## Tests requeridos
Integración: volcado y restauración de la BD sintética; recuento de filas idéntico.
