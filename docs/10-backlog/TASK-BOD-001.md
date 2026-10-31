# TASK-BOD-001 · Recipientes y QR (UI-23)
- Hito M2 · 1,5 días · Escalado: no
- Historias / RNF: US-BOD-01
- Depende de: TASK-CORE-003, TASK-UI-002

## Objetivo
Alta y mapa de recipientes con contenido, ocupación, estado y QR imprimible.

## Contexto
`08-ui/UI-23-depositos.md` · `cellar.vessel` · Q-020.

## Ficheros
`api/src/routes/vessels.ts`, `ui/src/pages/cellar/vessels/*`, `api/src/core/cellar/qr.ts`.

## Interfaz exacta
`GET/POST /api/v1/vessels` · `GET/PATCH /api/v1/vessels/{code}` · `GET /api/v1/vessels/{code}/qr` (PDF con token, sin datos internos).

## Criterios de aceptación
- Escanear el QR abre la ficha en el móvil; un QR de otro sistema se rechaza.

## Tests requeridos
E2E móvil con un QR generado en el test.
