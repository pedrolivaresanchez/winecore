# TASK-BOD-013 · Zonas y plano, barricas, jaulones y nichos
- Hito M2 · 2 días · Escalado: no
- Historias / RNF: US-BOD-01
- Depende de: TASK-BOD-001, TASK-INV-001
- Estado: en construcción (rama `cursor/recipientes-barricas-2060`)

## Objetivo
Mapa visual de la bodega por zonas, atributos de barrica con usos automáticos y contenedores de botellas (jaulón, nicho) dentro de la clave de stock.

## Contexto
`02-modelo-dominio.md` §8.1 y §9.1 · DDL `0017_elaboracion.sql` (`inventory.location_zone`, `cellar.vessel_position`, `cellar.barrel`, `cellar.bottle_holder`) · UI-23.

## Ficheros
`api/src/core/cellar-assets/**`, `api/src/routes/cellar-assets*.ts`, gancho mínimo en la confirmación de operaciones.

## Interfaz exacta
`GET /api/v1/cellar/map?location=` · CRUD de zonas, posiciones, barricas y contenedores · `holder_id` en líneas y movimientos.

## Criterios de aceptación
- El mapa devuelve zonas con recipientes, posición, % de llenado y lote.
- Los usos de una barrica suben solo al llenarla vacía (I-19).
- Un jaulón no supera su capacidad (`WC142`); un nicho se cuenta en el aforo.

## Tests requeridos
Unit (usos, capacidad) e integración (mapa, aforo con nicho).
