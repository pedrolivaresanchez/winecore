# TASK-VIN-001 · Parcelas y variedades (UI-26)
- Hito M3 · 1,5 días · Escalado: no
- Historias / RNF: US-VIN-01
- Depende de: TASK-CORE-003, TASK-UI-002

## Objetivo
Parcelas con referencia SIGPAC completa, superficie, variedades y fecha de ecológico.

## Contexto
`vineyard.parcel`, `vineyard.parcel_variety` · `08-ui/UI-26-vinedo.md`.

## Ficheros
`api/src/routes/parcels.ts`, `ui/src/pages/vineyard/*`.

## Interfaz exacta
`GET/POST /api/v1/parcels` · `GET/PATCH /api/v1/parcels/{code}`; SIGPAC validado por formato (provincia:municipio:agregado:zona:polígono:parcela:recinto).

## Criterios de aceptación
- Suma de superficies por variedad ≤ superficie de la parcela.

## Tests requeridos
Unitarios del formato SIGPAC; E2E del alta.
