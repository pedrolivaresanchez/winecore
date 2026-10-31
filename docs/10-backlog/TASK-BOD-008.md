# TASK-BOD-008 · Formulario de operación (UI-25)
- Hito M2 · 2 días · Escalado: no
- Historias / RNF: US-BOD-02, US-BOD-04, US-BOD-05, US-BOD-06, US-BOD-07
- Depende de: TASK-BOD-003, TASK-BOD-004, TASK-BOD-005, TASK-BOD-006, TASK-BOD-007, TASK-UI-002

## Objetivo
Formulario guiado por tipo, móvil primero, con escaneo de recipientes, resumen de conservación en vivo, vista previa de efectos y cola sin conexión.

## Contexto
`08-ui/UI-25-operacion.md`.

## Ficheros
`ui/src/pages/cellar/operations/*`.

## Interfaz exacta
Consume `cellar-operations` (`preview`, `confirm`, `rectify`); la cola local usa claves de idempotencia por operación.

## Criterios de aceptación
- No se puede confirmar si la conservación no cuadra.
- La vista previa muestra los efectos en SISV y SILICIE.

## Tests requeridos
E2E móvil de trasiego y envasado; prueba con red cortada.
