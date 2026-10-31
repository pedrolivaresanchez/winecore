# TASK-CORE-004 · Series de numeración sin huecos
- Hito M1 · 0,5 días · Escalado: no
- Historias / RNF: US-CORE-06
- Depende de: TASK-CORE-003

## Objetivo
API de series y uso de `core.take_number` dentro de las transacciones de emisión; validación de prefijos aptos para Verifactu.

## Contexto
`02-modelo-dominio.md` §3 (series) · `04-regulatorio/verifactu.md` §5 (caracteres de `NumSerieFactura`) · Q-015.

## Ficheros
`api/src/core/numbering.ts`, `api/src/routes/number-series.ts`.

## Interfaz exacta
```ts
export async function takeNumber(tx: Tx, seriesId: UUID): Promise<string>; // llama a core.take_number
GET/POST /api/v1/number-series   // prefijo ASCII 32–126 sin " ' < > =; número completo ≤ 60
```

## Criterios de aceptación
- 100 emisiones concurrentes en la misma serie → números consecutivos sin huecos ni repetidos.
- Prefijo con `<` rechazado con mensaje claro.

## Tests requeridos
Integración de concurrencia (100 transacciones); unitarios de validación del prefijo.
