# TASK-VIN-003 · Labores, maduración y vendimia
- Hito M3 · 1,5 días · Escalado: no
- Historias / RNF: US-VIN-03, US-VIN-04, US-VIN-05
- Depende de: TASK-VIN-001, TASK-BOD-009

## Objetivo
Labores (también por voz vía CVBOT), controles de maduración con foto y vendimia enlazada con la recepción de uva.

## Contexto
`vineyard.field_task`, `vineyard.maturity_check`, `vineyard.harvest` · herramientas MCP `vineyard_*`.

## Ficheros
`api/src/routes/field-tasks.ts`, `api/src/routes/maturity-checks.ts`, `api/src/routes/harvests.ts`.

## Interfaz exacta
`POST /api/v1/field-tasks|maturity-checks|harvests`; `POST /api/v1/harvests/{id}/close { receptionOperationId }`.

## Criterios de aceptación
- Cerrar la vendimia exige la recepción correspondiente.

## Tests requeridos
Integración del enlace vendimia ↔ recepción.
