# TASK-INV-004 · Aforo de arranque y saldos de apertura
- Hito M2 · 1 día · Escalado: sí (aforo inicial)
- Historias / RNF: US-INV-01
- Depende de: TASK-INV-003, Q-013

## Objetivo
Convertir el aforo firmado del 31-12-2026 en saldos de apertura físicos (`opening`) y fiscales (`opening`, mayores SILICIE) y en los datos del A01 de 2027, sin migrar movimientos antiguos de SISV ni SILICIE.

## Contexto
`06-migracion.md` (stock y aforo) · riesgo R5 · `silicie.md` §2 y §11.

## Ficheros
`api/src/core/inventory/opening.ts`.

## Interfaz exacta
`postOpening(tx, { countId, asOf: '2027-01-01' })` — una sola vez por entidad (segunda ejecución → error); crea lotes de apertura (`origin = 'opening_count'`).

## Criterios de aceptación
- Saldos físicos y fiscales de apertura = aforo firmado; diferencias con Bacosoft documentadas como regularización con motivo.

## Tests requeridos
Integración con un aforo sintético y propiedad de idempotencia.
