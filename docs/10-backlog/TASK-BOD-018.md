# TASK-BOD-018 · Destino del lote, parcela única, recetas y comparador de añadas
- Hito M2 · 2 días · Escalado: no
- Historias / RNF: US-BOD-20, US-VIN-07
- Depende de: TASK-BOD-002, TASK-BOD-011
- Estado: en construcción (rama `cursor/lote-destino-receta-2060`)

## Objetivo
Diseño del lote (destino, tipo de vinificación, prácticas aplicadas y no aplicadas, parcela única con nº de etiqueta), recetas versionadas que generan un plan y comparador de añadas.

## Contexto
`02-modelo-dominio.md` §9.5 · DDL `cellar.lot_design`, `cellar.lot_practice`, `cellar.recipe`.

## Ficheros
`api/src/core/lot-design/**`, `api/src/routes/lot-design*.ts`.

## Interfaz exacta
`GET/PUT /api/v1/lots/{code}/design` · `POST /api/v1/recipes` (desde lote) · `POST /api/v1/recipes/{id}/plan` · `GET /api/v1/vintages/compare`.

## Criterios de aceptación
- Parcela única solo si la genealogía llega a una parcela (`WC141`).
- Una receta nunca crea ni confirma operaciones: devuelve un plan.
- El comparador funciona aunque falten datos de alguna añada.

## Tests requeridos
Unit (genealogía) e integración (receta → plan → desviaciones).
