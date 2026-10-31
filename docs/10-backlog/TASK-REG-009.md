# TASK-REG-009 · Anulación y rectificación de asientos
- Hito M2 · 1 día · Escalado: sí (II.EE.)
- Historias / RNF: US-SIL-04
- Depende de: TASK-REG-007

## Objetivo
Cuando se rectifica un hecho ya presentado, preparar la anulación (motivo MOAN) y el alta corregida con "número de asiento previo".

## Contexto
`04-regulatorio/silicie.md` §1 y §9 · seminario AEAT 21-07-2025 (preguntas 5.ª y 7.ª).

## Ficheros
`api/src/core/regulatory/silicie/corrections.ts`.

## Interfaz exacta
`correctEntry(tx, { entryId, reason: 1|2|3, replacement?: SilicieEntryDraft })` → par anulación + alta en el siguiente envío.

## Criterios de aceptación
- Un asiento aceptado nunca se modifica; solo se anula y se repone.

## Tests requeridos
Golden del par anulación + alta.
