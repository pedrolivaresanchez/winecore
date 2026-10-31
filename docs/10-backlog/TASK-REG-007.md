# TASK-REG-007 · Presentación de SILICIE por el ejecutor
- Hito M2 · 2 días · Escalado: sí (envío regulatorio)
- Historias / RNF: US-SIL-03
- Depende de: TASK-REG-006, TASK-RUN-002

## Objetivo
Procedimiento `silicie.import_file`: entrar en la sede con el certificado, abrir el ejercicio, "Alta de asientos importación de fichero", subir el CSV aprobado, descargar el fichero de resultado e interpretarlo por línea.

## Contexto
`04-regulatorio/silicie.md` §3–§4 y §9 · guía rápida IESA1V2CSV.

## Ficheros
`runner/src/procedures/silicie.import_file.ts`, `api/src/core/regulatory/silicie/result.ts`.

## Interfaz exacta
`parseResultFile(bytes): { line: number; accepted: boolean; entryNumber?: string; error?: string }[]` → actualiza `silicie_entry` (`accepted` + `aeat_entry_number` o `rejected`).

## Criterios de aceptación
- Primero se prueba en el entorno de pruebas de SILICIE 2.0 con el CAE de pruebas.
- Tras un envío sin resultado claro → `needs_human`.

## Tests requeridos
Portal simulado y parseo del fichero de resultado oficial de ejemplo.
