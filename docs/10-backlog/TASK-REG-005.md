# TASK-REG-005 · Mayores SILICIE
- Hito M2 · 0,5 días · Escalado: sí (II.EE.)
- Historias / RNF: US-SIL-01
- Depende de: TASK-CORE-002

## Objetivo
Alta y consulta de `regulatory.silicie_ledger` (identificación estable de productos) con la propuesta de `silicie.md` §6 y validación del asesor.

## Contexto
`04-regulatorio/silicie.md` §6 · `WC122`.

## Ficheros
`api/src/routes/silicie-ledgers.ts`, `api/db/seed/silicie_ledgers.example.ts` (solo ejemplo sintético).

## Interfaz exacta
`GET/POST /api/v1/silicie-ledgers` · `POST /api/v1/silicie-ledgers/{id}/validate { advisorRef }` · `ledgerFor(product|lot, class)`.

## Criterios de aceptación
- No se puede cambiar la identificación de un mayor (`WC122`); se crea otro.

## Tests requeridos
Integración de alta, validación y bloqueo de cambios.
