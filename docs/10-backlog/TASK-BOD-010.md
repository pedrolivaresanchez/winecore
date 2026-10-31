# TASK-BOD-010 · Lecturas de fermentación y alertas
- Hito M4 · 1 día · Escalado: no
- Historias / RNF: US-BOD-10
- Depende de: TASK-BOD-009

## Objetivo
Registrar densidad y temperatura (pantalla o CVBOT), gráfica de cinética y alertas (densidad estancada 48 h, temperatura fuera de rango).

## Contexto
`02-modelo-dominio.md` §9.3 · ajustes `cellar.alerts.*`.

## Ficheros
`api/src/core/cellar/fermentation.ts`, `api/src/jobs/fermentation-alerts.ts`, componente `Chart` en UI-24.

## Interfaz exacta
`POST /api/v1/fermentation-readings { lotId, vesselId, density, temperatureC, at }`; job cada hora.

## Criterios de aceptación
- La alerta aparece en el panel y en CVBOT una sola vez por episodio.

## Tests requeridos
Unitarios de la regla de alerta con series sintéticas.
