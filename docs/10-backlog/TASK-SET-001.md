# TASK-SET-001 · Ajustes, series, módulos, conectores e historial
- Hito M1 · 2 días · Escalado: no
- Historias / RNF: US-CORE-04, US-CORE-05, US-CORE-06
- Depende de: TASK-CORE-004, TASK-CORE-005, TASK-CORE-008, TASK-UI-002

## Objetivo
Pantallas UI-34 (ajustes y series), UI-36 (módulos), UI-38 (conectores y clientes de máquina, lectura y tokens) y UI-40 (historial).

## Contexto
`08-ui/UI-34-ajustes.md`, `UI-36-modulos.md`, `UI-38-conectores.md`, `UI-40-auditoria.md`.

## Ficheros
`ui/src/pages/settings/{general,series,modules,connectors}/*`, `ui/src/pages/audit/*`, `api/src/routes/modules.ts`.

## Interfaz exacta
`GET /api/v1/modules` · `POST /api/v1/modules/{code}/toggle-request` (aprobación `module_toggle`; no permite apagar un módulo del que depende otro ni Verifactu con instalaciones activas).

## Criterios de aceptación
- La pantalla de conectores nunca muestra ni pide secretos; el token de un cliente nuevo se muestra una vez.
- Cambiar la regla fiscal o una serie usada pide aprobación.

## Tests requeridos
E2E de cada pantalla con rol `owner` y con rol sin permiso (ve `NoPermission`).
