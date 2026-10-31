# TASK-REP-001 · Informes y paquete para la asesoría (UI-33)
- Hito M3 · 1,5 días · Escalado: sí (fiscal)
- Historias / RNF: US-FACT-11, US-COMP-03
- Depende de: TASK-FACT-011, TASK-COMP-003, TASK-INV-005

## Objetivo
Informes de ventas, cobros, existencias valoradas y bodega, y el ZIP trimestral para la asesoría con libros, desglose del 303 y hash por fichero.

## Contexto
`08-ui/UI-33-informes.md` · `04-regulatorio/modelos-aeat.md` §1–§3.

## Ficheros
`api/src/routes/reports.ts`, `api/src/core/reports/*.ts`, `ui/src/pages/reports/*`.

## Interfaz exacta
`GET /api/v1/reports/{report}` (JSON, CSV, XLSX, PDF) · `POST /api/v1/reports/advisor-pack { entityId, quarter }`.

## Criterios de aceptación
- El paquete no se genera si falla algún cuadre de `modelos-aeat.md` §2; nunca se envía por correo automáticamente.

## Tests requeridos
Golden de cada informe con datos sintéticos.
