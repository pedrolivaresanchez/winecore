# TASK-REG-013 · Fichero SISV v02
- Hito M3 · 1,5 días · Escalado: sí (registros vitivinícolas)
- Historias / RNF: US-SISV-02
- Depende de: TASK-REG-012

## Objetivo
Renderizar los ficheros de ancho fijo del modelo de intercambio v02 (registro `LIBRO` + uno por libro) y validarlos; comparar localmente con ficheros reales de Bacosoft guardados solo en `data/`.

## Contexto
`04-regulatorio/sisv.md` §4 · ADR 005.

## Ficheros
`api/src/core/regulatory/sisv/render.ts`, `api/src/core/regulatory/sisv/spec/v02.json`, `api/test/golden/sisv/*`, `scripts/local/compare-bacosoft.ts` (solo uso local; nunca en CI).

## Interfaz exacta
`renderBook(book, entries): Uint8Array` (posiciones y longitudes exactas, relleno con espacios y ceros) · `validateBook(bytes): Issue[]`.

## Criterios de aceptación
- Cada línea mide exactamente la longitud del registro (88, 1499, 1605…).

## Tests requeridos
Golden byte a byte por libro; test de longitudes.
