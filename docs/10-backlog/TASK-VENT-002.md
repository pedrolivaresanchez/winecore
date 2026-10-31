# TASK-VENT-002 · Pedidos (UI-10)
- Hito M1 · 2 días · Escalado: no
- Historias / RNF: US-VENT-01
- Depende de: TASK-VENT-001, TASK-CAT-002

## Objetivo
Pedidos con entidad resuelta por D3, precios de tarifa, datos de El Corte Inglés (departamento y centro de coste) y paso a albarán.

## Contexto
`03-maquinas-estado.md` §3 · `08-ui/UI-10-pedidos.md`.

## Ficheros
`api/src/core/sales/orders.ts`, `api/src/routes/sales-orders.ts`, `ui/src/pages/sales/orders/*`.

## Interfaz exacta
`POST /api/v1/sales-orders` (Idempotency-Key) · `PATCH` (solo borrador) · `POST .../confirm|cancel|delivery-notes` · excepción de entidad con `sales.manage` y motivo.

## Criterios de aceptación
- La entidad no se puede cambiar sin excepción auditada.
- Pedido de ECI sin departamento → no se confirma.

## Tests requeridos
Integración de la máquina de estados; E2E de alta y confirmación.
