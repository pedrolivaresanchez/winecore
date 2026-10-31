# TASK-REG-003 · Pantalla de envío regulatorio (UI-28)
- Hito M2 · 1,5 días · Escalado: no
- Historias / RNF: US-SIL-02, US-SIL-03
- Depende de: TASK-REG-001, TASK-UI-002

## Objetivo
Ficha de envío con `Stepper`, contenido, fichero generado, validación, ejecución (intentos del conector) y evidencias; resolución de `needs_human`.

## Contexto
`08-ui/UI-28-envio.md`.

## Ficheros
`ui/src/pages/regulatory/submission/*`.

## Interfaz exacta
Consume `regulatory/submissions/{id}` (`validate`, `request-approval`, `cancel`, `file`, `evidence`).

## Criterios de aceptación
- Con `needs_human`, marcar aceptado exige adjuntar el justificante del portal.

## Tests requeridos
E2E con un envío simulado en cada estado.
