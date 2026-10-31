# TASK-REG-018 · Paquete del transitario y pantalla e-DA (UI-31)
- Hito M3 · 1 día · Escalado: no
- Historias / RNF: US-EMCS-04
- Depende de: TASK-REG-016, TASK-UI-002

## Objetivo
Pantalla UI-31 y ZIP para el transitario (factura o proforma en inglés, e-DA con ARC, bultos, Incoterm).

## Contexto
`08-ui/UI-31-emcs.md` · `emcs.md` §7.

## Ficheros
`ui/src/pages/regulatory/emcs/*`, `api/src/core/regulatory/emcs/forwarderPack.ts`.

## Interfaz exacta
`GET /api/v1/emcs/documents/{id}/forwarder-pack` → ZIP.

## Criterios de aceptación
- El ZIP solo se descarga (nunca se envía automáticamente a terceros).

## Tests requeridos
Integración del contenido del ZIP; E2E de la pantalla.
