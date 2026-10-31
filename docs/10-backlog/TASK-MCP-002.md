# TASK-MCP-002 · Herramientas MCP de ventas y facturación
- Hito M1 · 1,5 días · Escalado: no
- Historias / RNF: US-MCP-02
- Depende de: TASK-MCP-001, TASK-VENT-002, TASK-FACT-002

## Objetivo
Herramientas de `13-mcp.md` para pedidos, albaranes, borradores de factura, facturas, cobros y Verifactu (lectura y borradores con confirmación; nunca emisión).

## Contexto
`13-mcp.md` (ventas, facturación, finanzas).

## Ficheros
`api/src/mcp/tools/{sales,billing,finance}.ts`.

## Interfaz exacta
`sales_order_create_prepare/commit`, `billing_invoice_draft_prepare/commit`, `billing_invoices_list`, `billing_verifactu_status`, `finance_payment_register_prepare/commit`, etc.

## Criterios de aceptación
- No existe herramienta de emisión ni de envío de facturas.

## Tests requeridos
Integración por herramienta con un cliente MCP de pruebas.
