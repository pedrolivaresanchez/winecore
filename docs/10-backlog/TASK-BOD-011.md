# TASK-BOD-011 · Analíticas y catas
- Hito M2 · 1 día · Escalado: no
- Historias / RNF: US-BOD-11
- Depende de: TASK-BOD-002

## Objetivo
Analíticas con parámetros de catálogo y PDF del laboratorio adjunto, y notas de cata por lote.

## Contexto
`cellar.analysis`, `cellar.analysis_result`, `cellar.tasting` · UI-24.

## Ficheros
`api/src/routes/analyses.ts`, `api/src/routes/tastings.ts`.

## Interfaz exacta
`POST /api/v1/lots/{code}/analyses { at, lab, results: { parameter, value, unit }[], pdf? }` · `POST /api/v1/lots/{code}/tastings`.

## Criterios de aceptación
- Valores fuera de rango físico (p. ej. pH > 5) se rechazan.

## Tests requeridos
Integración y validación de rangos.
