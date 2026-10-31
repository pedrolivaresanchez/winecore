# TASK-BOD-017 · Catas estructuradas y cata a ciegas
- Hito M2 · 2 días · Escalado: no
- Historias / RNF: US-BOD-18, US-BOD-19
- Depende de: TASK-BOD-011
- Estado: en construcción (rama `cursor/catas-2060`)

## Objetivo
Fichas de cata por plantilla (uva, mosto, crianza, candidatos, posventa) con dictado y adjuntos, y sesiones de cata a ciegas con votos sí/no por día.

## Contexto
`02-modelo-dominio.md` §9.4 · DDL `cellar.tasting_template`, `cellar.tasting`, `cellar.blind_*`.

## Ficheros
`api/src/core/tasting/**`, `api/src/routes/tasting*.ts`.

## Interfaz exacta
`POST /api/v1/tastings` · `POST /api/v1/blind-sessions` · `POST .../votes` · `POST .../reveal` · `GET /api/v1/lots/{code}/evolution`.

## Criterios de aceptación
- El lote de cada muestra no se ve hasta revelar (I-21).
- Un voto por catador, muestra y día.
- Los lotes elegidos se exponen para la fórmula de ensamblaje.

## Tests requeridos
Integración de la sesión completa; unit de plantillas.
