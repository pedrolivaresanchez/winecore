# TASK-VIN-004 · Cata de uva, muestras por parcela y planificador de vendimia
- Hito M3 · 1,5 días · Escalado: no
- Historias / RNF: US-VIN-04, US-VIN-06
- Depende de: TASK-VIN-003, TASK-BOD-011
- Estado: pendiente (se encarga al agente de viñedo al terminar su tarea actual)

## Objetivo
Control de maduración con cata de uva estructurada, analíticas de parcela antes de vendimia y planificador por parcela con maduración, meteorología y personal.

## Contexto
`02-modelo-dominio.md` §15 · DDL `vineyard.maturity_check` (columnas nuevas), `vineyard.harvest_plan`, `vineyard.crew_availability`, `cellar.analysis.parcel_id`.

## Ficheros
`api/src/core/vineyard/**`, `api/src/routes/vineyard*.ts`.

## Interfaz exacta
`POST /api/v1/parcels/{id}/maturity-checks` · `PUT /api/v1/crew-availability/{day}` · `GET/POST /api/v1/harvest-plans`.

## Criterios de aceptación
- La sugerencia explica la fecha (madurez, riesgo meteorológico, personal) y la decide una persona.
- Las muestras de laboratorio quedan como analíticas de la parcela.

## Tests requeridos
Unit (sugerencia) e integración.
