# TASK-VIN-002 · Tratamientos y cuaderno (CUE)
- Hito M3 · 1,5 días · Escalado: no
- Historias / RNF: US-VIN-02
- Depende de: TASK-VIN-001

## Objetivo
Tratamientos con todos los campos del anexo III del RD 1311/2012, aviso de anotación en el CUE y exportación del cuaderno.

## Contexto
`04-regulatorio/ecologico.md` §1–§2 · `vineyard.treatment`.

## Ficheros
`api/src/routes/treatments.ts`, `api/src/core/vineyard/notebook.ts`, `api/src/jobs/cue-reminder.ts`.

## Interfaz exacta
`POST /api/v1/treatments` · `GET /api/v1/treatments/export?campaign=` (formato del modelo de la Junta v9) · aviso a los 20 días sin `cue_recorded_at`.

## Criterios de aceptación
- Parcela ecológica con producto no apto → bloqueo.

## Tests requeridos
Integración y golden de la exportación.
