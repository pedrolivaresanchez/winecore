# TASK-FACT-010 · Envío al cliente (descarga y correo)
- Hito M1 (descarga) / M2 (correo) · 1 día · Escalado: no
- Historias / RNF: US-FACT-10
- Depende de: TASK-FACT-004

## Objetivo
Entrega **automática vía CVBOT** de cada factura emitida (decisión de Pedro, 31-10-2026): estado pendiente de envío en `billing.invoice_delivery`, evento `billing.invoice.issued` a CVBOT, herramientas MCP de `13-mcp.md` §4.5 (pendientes, PDF con correo de facturación y texto en español, marcar enviada o fallida), aviso si no se marca en `billing.invoice_delivery_alert_hours` y reenvío (nuevo intento) desde la web. WineCore no envía correos; sin Microsoft Graph.

## Contexto
Reglas duras 0.4 y 0.5 · UI-13.

## Ficheros
`api/src/routes/invoice-send.ts`, `api/src/core/billing/email.ts` (detrás de bandera hasta Q-014).

## Interfaz exacta
`POST /api/v1/invoices/{id}/sent { channel: 'download' }` · `POST /api/v1/invoices/{id}/email { to[], cc[] }` (solo personas con `billing.issue`; ningún agente ni cliente de máquina).

## Criterios de aceptación
- Un agente o token de máquina recibe 403 al intentar enviar.

## Tests requeridos
Integración de permisos y del registro de envío.
