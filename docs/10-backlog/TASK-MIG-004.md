# TASK-MIG-004 · Partidas abiertas al corte
- Hito M1 · 1 día · Escalado: sí (migración)
- Historias / RNF: US-MIG-03
- Depende de: TASK-MIG-001, TASK-FIN-001

## Objetivo
Cargar las facturas emitidas y recibidas pendientes de cobro o pago a la fecha de corte como `legacy.open_item`, cobrables desde WineCore.

## Contexto
`06-migracion.md` (partidas abiertas y cuadres) · `02-ddl/0016_legacy.sql` (WC140).

## Ficheros
`api/db/migration/datasets/open_items.ts`.

## Interfaz exacta
Cuadre obligatorio: Σ partidas abiertas cargadas = saldo pendiente según Holded a la fecha de corte, por entidad y dirección.

## Criterios de aceptación
- El histórico cargado es de solo lectura; solo cambia el estado de cobro por imputaciones.

## Tests requeridos
Integración con partidas sintéticas y cobro posterior.
