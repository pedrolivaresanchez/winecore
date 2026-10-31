# TASK-INV-002 · Regla de fecha fiscal y salidas fiscales
- Hito M2 · 1,5 días · Escalado: sí (II.EE.)
- Historias / RNF: US-INV-03
- Depende de: TASK-INV-001, TASK-FACT-003

## Objetivo
Generar los movimientos fiscales de salida según el ajuste `inventory.fiscal_exit_rule` (D2 por defecto: factura de P.O; e-DA: fecha de expedición), guardando fecha fiscal y física.

## Contexto
`02-modelo-dominio.md` §10.2–§10.3 · `04-regulatorio/silicie.md` §5 · Q-010.

## Ficheros
`api/src/core/inventory/fiscalExits.ts` (llamado desde `issueInvoice`, `issueDeliveryNote` y aceptación de e-DA).

## Interfaz exacta
`fiscalExitsFor(tx, trigger: { kind: 'invoice'|'delivery_note'|'ead_dispatch'; id: UUID }): Promise<UUID[]>` — usa la regla vigente en la fecha del hecho; cambiar la regla no reescribe el pasado.

## Criterios de aceptación
- Facturas de CVPO no generan movimientos fiscales.
- Cada salida lleva justificante (nº de factura, albarán o ARC) y la fecha física.

## Tests requeridos
Integración con las tres reglas y un cambio de regla a mitad de mes.
