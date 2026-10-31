# TASK-REG-012 · Motor de anotaciones SISV
- Hito M3 · 2 días · Escalado: sí (registros vitivinícolas)
- Historias / RNF: US-SISV-01
- Depende de: TASK-BOD-002, TASK-VENT-003

## Objetivo
Generar `regulatory.sisv_entry` por libro (VINO/IGP/DOP/VARIETAL, ELABORA, PRACTICA, PROCPRACT, ENVASADO, ENTSALENV) según `sisv.md` §4–§5 al confirmar operaciones y salidas.

## Contexto
`04-regulatorio/sisv.md` §4–§5 · tablas C0–C8.

## Ficheros
`api/src/core/regulatory/sisv/entries.ts`, `.../codes.ts`.

## Interfaz exacta
`sisvEntriesFor(tx, fact: ConfirmedOperation | IssuedDeliveryNote | AcceptedEad | PurchaseOfOenologicalProduct): SisvEntryDraft[]` (libro según la categoría del vino; designación C3; variedad C4).

## Criterios de aceptación
- La adición de SO₂ no genera anotación; la acidificación sí (PRACTICA 01 + PROCPRACT).
- Rectificar una operación genera "Borrada = S" + nueva anotación.

## Tests requeridos
Golden de un mes sintético por libro.
