# TASK-VFT-006 · Pantalla Verifactu (UI-15)
- Hito M1 · 1,5 días · Escalado: no
- Historias / RNF: US-VFT-03, US-VFT-05
- Depende de: TASK-VFT-004, TASK-UI-002

## Objetivo
UI-15 con resumen por entidad, registros, envíos, instalación, declaración responsable y resultados de preproducción; estado Verifactu en la ficha de factura.

## Contexto
`08-ui/UI-15-verifactu.md`.

## Ficheros
`api/src/routes/verifactu.ts`, `ui/src/pages/billing/verifactu/*`.

## Interfaz exacta
`GET /api/v1/verifactu/summary|records|submissions|installations|declaration|preprod-runs`.

## Criterios de aceptación
- No existe ninguna acción para editar o borrar registros.
- Alerta de huella no coincidente bloquea la emisión de la entidad y se muestra en rojo.

## Tests requeridos
E2E de lectura y de corrección; captura visual.
