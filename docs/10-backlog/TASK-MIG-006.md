# TASK-MIG-006 · Pantalla de migración (UI-41)
- Hito M1 · 1 día · Escalado: no
- Historias / RNF: US-MIG-01, US-MIG-02, US-MIG-03, US-MIG-04
- Depende de: TASK-MIG-001, TASK-UI-002

## Objetivo
Pantalla para subir ficheros (cifrados, fuera del repo), lanzar ensayos, ver informes con ejemplos enmascarados y pedir la carga con aprobación.

## Contexto
`08-ui/UI-41-migracion.md`.

## Ficheros
`ui/src/pages/migration/*`, `api/src/routes/migration.ts`.

## Interfaz exacta
`POST /api/v1/migration/batches` · `.../dry-run` · `.../load-request` · `GET .../report`.

## Criterios de aceptación
- Solo el `owner` accede; los informes nunca muestran NIF ni nombres completos.

## Tests requeridos
E2E con ficheros sintéticos.
