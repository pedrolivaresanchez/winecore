# TASK-REG-023 · INFOVI y declaración de cosecha
- Hito M3 · 1 día · Escalado: sí (declaraciones obligatorias)
- Historias / RNF: US-INFOVI-01
- Depende de: TASK-INV-005, TASK-REG-002

## Objetivo
Fichas de datos para las declaraciones INFOVI de agosto y diciembre, la de cosecha (10-12) y los anexos IV (1–10-12), con cuadre frente a SISV y al aforo más cercano.

## Contexto
`04-regulatorio/infovi.md` · RD 739/2015 arts. 3, 5 y 6.

## Ficheros
`api/src/core/regulatory/infovi/*.ts`.

## Interfaz exacta
`infoviSheet({ entityId, kind: 'aug'|'dec'|'harvest'|'annex_iv', year })` → PDF + tabla; envío regulatorio en modo `manual` con justificante adjunto.

## Criterios de aceptación
- Aviso si la media de 4 campañas llega a 1.000 hl (paso a mensual).

## Tests requeridos
Integración con una campaña sintética.
