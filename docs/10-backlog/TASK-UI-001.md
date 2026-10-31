# TASK-UI-001 · Esqueleto de la UI: rutas, menú y estados
- Hito M0 · 1,5 días · Escalado: no
- Historias / RNF: US-CORE-04, RNF-10
- Depende de: TASK-INFRA-001, TASK-AUTH-001

## Objetivo
Aplicación React (Vite) con React Router 7, disposición escritorio/móvil, menú agrupado filtrado por permisos y módulos, `EntitySwitcher` y los estados comunes.

## Contexto
`08-ui/00-sistema-diseno.md` §3–§5 · `08-ui/01-navegacion.md`.

## Ficheros
`ui/src/app/routes.tsx`, `ui/src/app/Layout.tsx`, `ui/src/app/Menu.tsx`, `ui/src/app/useMe.ts`, `ui/src/app/EntitySwitcher.tsx`.

## Interfaz exacta
Cada ruta declara `{ path, module, permission, element }`; si el módulo está apagado → `ModuleDisabled`; sin permiso → `NoPermission`; el selector de entidad persiste por usuario (`/api/v1/settings/user.entity_filter`).

## Criterios de aceptación
- Grupos del menú sin rutas visibles no aparecen.
- Navegación con teclado y foco visible (WCAG 2.1 AA).

## Tests requeridos
Unitarios del filtro de rutas; E2E de navegación con dos roles; captura visual.
