# TASK-BOD-019 · Higiene, equipos, control de envasado y registro APPCC
- Hito M2 · 1,5 días · Escalado: no
- Historias / RNF: US-BOD-21
- Depende de: TASK-BOD-005, TASK-BOD-006
- Estado: en construcción (rama `cursor/higiene-envasado-2060`)

## Objetivo
Procedimientos de limpieza con dosis y efluente, equipos, control de envasado exigible y exportación APPCC.

## Contexto
`02-modelo-dominio.md` §9.6 · DDL `cellar.cleaning_procedure`, `cellar.equipment`, `cellar.bottling_check` · Q-039.

## Ficheros
`api/src/core/hygiene/**`, `api/src/routes/hygiene*.ts`.

## Interfaz exacta
CRUD de procedimientos y equipos · `PUT /api/v1/cellar/operations/{id}/bottling-check` · `GET /api/v1/hygiene/appcc?from=&to=`.

## Criterios de aceptación
- Sin control de envasado no se confirma (`WC143`) si el ajuste lo exige.
- La exportación APPCC incluye limpiezas, desinfecciones, controles y mantenimiento del periodo.

## Tests requeridos
Unit (control) e integración (exportación).
