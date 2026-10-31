# TASK-ASIS-003 · Vigilantes
- Hito M3 · 1,5 días · Escalado: no
- Historias / RNF: US-ASIS-03
- Depende de: TASK-INV-006, TASK-REG-002, TASK-VFT-004

## Objetivo
Vigilantes programados: descuadres físico/fiscal, cobros vencidos, plazos a 7 días, colas atascadas (envíos, ejecutor sin latido), Verifactu pendiente, certificados por caducar, intercompañía sin emitir el día 12.

## Contexto
`07-arquitectura.md` §5 (vigilantes).

## Ficheros
`api/src/jobs/watchers/*.ts`.

## Interfaz exacta
`defineWatcher({ id, schedule, check(tx): Finding[] })` → notificación interna y evento a CVBOT, una vez por hallazgo hasta que se resuelva.

## Criterios de aceptación
- Un mismo hallazgo no se notifica más de una vez al día.

## Tests requeridos
Unitarios por vigilante con datos sintéticos.
