# TASK-BOD-003 · Trasiego y filtración (con cambio de mayor)
- Hito M2 · 1 día · Escalado: sí (II.EE.)
- Historias / RNF: US-BOD-02
- Depende de: TASK-BOD-002, TASK-REG-005

## Objetivo
Trasiegos y filtraciones a uno o varios destinos con merma; si cruzan depósito ↔ barrica de roble, generar el par `ledger_change_out/in` (A17/A16) y la merma como `loss` (A30).

## Contexto
`04-regulatorio/silicie.md` §5 · `02-modelo-dominio.md` §9.2 · `WC028`.

## Ficheros
`api/src/core/cellar/ops/racking.ts`, `api/src/core/cellar/ops/filtration.ts`.

## Interfaz exacta
Manejadores registrados en `confirmOperation` para `racking` y `filtration`; `ledgerOf(vessel) → 'bulk' | 'bulk_wood'`.

## Criterios de aceptación
- Trasiego entre dos depósitos de acero: sin movimientos fiscales.
- Trasiego de depósito a barrica: par de cambio de mayor que cuadra (`WC028`).

## Tests requeridos
Integración de ambos casos y golden de los asientos SILICIE resultantes (con TASK-REG-004).
