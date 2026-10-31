# TASK-REG-025 · Informe para el organismo de control
- Hito M3 · 1,5 días · Escalado: sí (normativa ecológica)
- Historias / RNF: US-ECO-01
- Depende de: TASK-REG-024, TASK-VIN-002, TASK-BOD-006

## Objetivo
Informe anual o de campaña (PDF y hoja de cálculo) con certificados, cuaderno, productos enológicos por lote, limpiezas, balance de materias, trazabilidad de una muestra de lotes, SO₂ por lote y etiquetas.

## Contexto
`04-regulatorio/ecologico.md` §4.

## Ficheros
`api/src/core/regulatory/organic/report.tsx`.

## Interfaz exacta
`organicReport({ entityId, from, to })` → solicitud de aprobación `organic_report`; WineCore no lo envía.

## Criterios de aceptación
- Balance de materias: uva (kg) → vino (L) → botellas → salidas, con mermas y rendimientos que cuadran con los libros.

## Tests requeridos
Golden por texto con una campaña sintética.
