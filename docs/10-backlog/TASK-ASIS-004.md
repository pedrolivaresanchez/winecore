# TASK-ASIS-004 · Diagrama de trazabilidad por chat
- Hito M3 · 1 día · Escalado: no
- Historias / RNF: US-ASIS-04
- Depende de: TASK-ASIS-001, TASK-MCP-003
- Estado: pendiente

## Objetivo
Respuesta del asistente y del MCP con el diagrama de la genealogía de un lote (botella → ensamblaje → partidas → parcelas o proveedores).

## Contexto
`02-modelo-dominio.md` §8.2 (`traceLot`) · `13-mcp.md`.

## Ficheros
`api/src/core/traceability/**`, herramienta MCP de trazabilidad.

## Interfaz exacta
`GET /api/v1/lots/{code}/trace?format=mermaid` · herramienta MCP `inventory_lot_trace` con el diagrama en el resultado.

## Criterios de aceptación
- El diagrama incluye operaciones, analíticas y documentos de origen.
- Funciona por lote envasado o a granel.

## Tests requeridos
Integración con un árbol sintético de 3 niveles.
