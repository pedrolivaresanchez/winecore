# TASK-REG-002 · Calendario de obligaciones y vigilante de plazos (UI-27)
- Hito M2 · 1,5 días · Escalado: sí (plazos regulatorios)
- Historias / RNF: US-SIL-06, US-ASIS-03
- Depende de: TASK-REG-001

## Objetivo
Generar `regulatory.obligation` con su base legal a partir de reglas de calendario (SILICIE dic–jul/ago–nov, cierres de ejercicio, SISV día 10, INFOVI 20-08/20-12, cosecha 10-12, anexos IV 1–10-12, Verifactu) y avisar a 30, 7 y 1 días.

## Contexto
`silicie.md` §2 · `sisv.md` §2 · `infovi.md` §1 · Ley 39/2015 art. 30 (traslado de días inhábiles).

## Ficheros
`api/src/core/regulatory/calendar.ts`, `api/src/jobs/regulatory-deadlines.ts`, `ui/src/pages/regulatory/calendar/*`.

## Interfaz exacta
`buildObligations(year, entity): Obligation[]` (con `legal_basis`); `lastWorkingDay(month, year, calendar)` usando el calendario de días inhábiles configurado.

## Criterios de aceptación
- 31-10-2027 (domingo) + 1-11 festivo → cierre de 2026 vence el 02-11-2027.

## Tests requeridos
Unitarios con las fechas de `silicie.md` §2 y `infovi.md` §1 (tabla de casos).
