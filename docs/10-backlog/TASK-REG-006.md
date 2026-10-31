# TASK-REG-006 · CSV de SILICIE (IESA1 V2 e IESX4)
- Hito M2 · 1,5 días · Escalado: sí (II.EE.)
- Historias / RNF: US-SIL-02
- Depende de: TASK-REG-004

## Objetivo
Generar el CSV oficial de alta de asientos (42 columnas, `;`, ISO-8859-1) y el de anulaciones, y validarlo antes de pedir la aprobación.

## Contexto
`04-regulatorio/silicie.md` §7 (campo a campo) · plantillas oficiales `PlantillaIESA1V2CSVEnt.csv`, `PlantillaAnulacionIESX4CSVEnt.csv`.

## Ficheros
`api/src/core/regulatory/silicie/csv.ts`, `api/src/core/regulatory/silicie/spec/IESA1V2.json` (definición de campos), `api/test/golden/silicie/*`.

## Interfaz exacta
`renderAltas(entries): Uint8Array` · `renderAnulaciones(entries): Uint8Array` · `validateCsv(bytes): Issue[]` (obligatoriedad, longitudes, listas).

## Criterios de aceptación
- Cabecera idéntica a la plantilla oficial; cantidades N(16,3) con punto decimal; fechas DD-MM-YYYY.

## Tests requeridos
Golden byte a byte de los casos de `silicie.md` §12; test de longitudes máximas.
