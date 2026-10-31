# TASK-MCP-003 · Herramientas MCP de stock, bodega, viñedo, regulatorio e informes
- Hito M2/M3 · 2 días · Escalado: no
- Historias / RNF: US-MCP-01
- Depende de: TASK-MCP-001, TASK-INV-005

## Objetivo
Herramientas de lectura y de borrador con confirmación para existencias, trazabilidad, bodega (lecturas, catas, borradores de operación), viñedo (labores, maduración, tratamientos), regulatorio (obligaciones, envíos en borrador) e informes.

## Contexto
`13-mcp.md` (stock, bodega, viñedo, regulatorio, informes, conocimiento).

## Ficheros
`api/src/mcp/tools/{inventory,cellar,vineyard,regulatory,reports,knowledge}.ts`.

## Interfaz exacta
`inventory_stock_at`, `traceability_lot`, `cellar_operation_draft_prepare`, `vineyard_treatment_add_prepare`, `regulatory_submission_draft_prepare`, `reports_kpis`… según `13-mcp.md`.

## Criterios de aceptación
- `regulatory_submission_request_approval_prepare` solo pide la aprobación; nunca envía.

## Tests requeridos
Integración por herramienta y prueba de que cada módulo apagado oculta sus herramientas.
