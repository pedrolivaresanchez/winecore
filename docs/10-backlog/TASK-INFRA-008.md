# TASK-INFRA-008 · Observabilidad, alertas y coste
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: RNF-04, RNF-06, RNF-11
- Depende de: TASK-INFRA-006

## Objetivo
Logs estructurados sin datos personales, trazas de las peticiones y de los agentes, alertas a CVBOT (errores 5xx, colas atascadas, Verifactu pendiente) y un panel de coste para PROGRESS.

## Contexto
`07-arquitectura.md` §12–§13 · RNF-06.

## Ficheros
`api/src/core/log.ts`, `api/src/core/redact.ts`, `scripts/cost-report.ts`.

## Interfaz exacta
`log.info(event: string, fields: Record<string, unknown>)` pasa por `redact()` (NIF, IBAN, correos, teléfonos → `***`). `cost-report.ts --month YYYY-MM` → tabla Markdown para PROGRESS.

## Criterios de aceptación
- Un test con un objeto que contiene NIF, IBAN y correo produce un log sin ellos.
- Alerta a CVBOT a los 3 fallos seguidos del emisor de Verifactu.

## Tests requeridos
Unitarios de `redact()` (casos españoles y UE) y de la regla de alerta.
