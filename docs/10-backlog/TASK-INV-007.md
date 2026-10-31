# TASK-INV-007 · Trazabilidad de lotes (UI-24)
- Hito M2 · 1,5 días · Escalado: no
- Historias / RNF: US-INV-06
- Depende de: TASK-BOD-002

## Objetivo
Genealogía ascendente y descendente de un lote (parcela → … → cliente) en datos y en Mermaid, y ficha de lote.

## Contexto
`02-modelo-dominio.md` §8 (DAG) · `08-ui/UI-24-lote.md` · herramienta MCP `traceability_lot`.

## Ficheros
`api/src/core/traceability/lot.ts`, `api/src/routes/lots.ts`, `ui/src/pages/cellar/lots/*`.

## Interfaz exacta
`traceLot(tx, { lotCode, direction: 'up'|'down'|'both' }): Promise<{ nodes; edges; mermaid: string }>`.

## Criterios de aceptación
- Un lote de botellas llega hasta sus parcelas y hasta las facturas de venta.

## Tests requeridos
Integración con un DAG sintético de 3 niveles con ensamblaje; golden del Mermaid.
