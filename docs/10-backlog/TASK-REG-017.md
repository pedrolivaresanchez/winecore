# TASK-REG-017 · Presentación de e-DA y mensajes posteriores
- Hito M3 · 2 días · Escalado: sí (envío regulatorio)
- Historias / RNF: US-EMCS-02, US-EMCS-03
- Depende de: TASK-REG-016, TASK-RUN-002

## Objetivo
Procedimientos del ejecutor para presentar el e-DA (interno o intracomunitario), recoger el ARC, y gestionar anulación, cambio de destino, recepción y exportación confirmada.

## Contexto
`04-regulatorio/emcs.md` §3 y §5 · `03-maquinas-estado.md` §10.

## Ficheros
`runner/src/procedures/emcs.submit.ts`, `.../emcs.cancel.ts`, `.../emcs.change_destination.ts`, `.../emcs.read_status.ts`.

## Interfaz exacta
Al aceptar: `arc` en `emcs_document` y en el albarán, salida fiscal con justificante J01 y anotación SISV con documento 03.

## Criterios de aceptación
- Si no aparece ARC tras enviar → `needs_human` y consulta por LRN antes de repetir.

## Tests requeridos
Portal simulado y prueba asistida en el entorno de pruebas de la AEAT.
