# TASK-CORE-001 · Base del núcleo: BD, errores, dinero y fechas
- Hito M0 · 1,5 días · Escalado: no
- Historias / RNF: RNF-07, RNF-12
- Depende de: TASK-INFRA-001

## Objetivo
Utilidades del núcleo que usa todo lo demás: pool y transacciones con actor, mapa de errores `WCnnn` → HTTP, dinero con `decimal.js` (ROUND_HALF_UP) y fechas en Europe/Madrid.

## Contexto
`02-modelo-dominio.md` §1 (convenciones) y §18 (códigos de error) · ADR 002 · ADR 011.

## Ficheros
`api/src/core/db.ts`, `api/src/core/errors.ts`, `api/src/core/money.ts`, `api/src/core/time.ts`, `api/src/core/ids.ts`.

## Interfaz exacta
```ts
export type Actor = { type: 'user'|'agent'|'system'|'migration'; id: string; onBehalfOf?: string; requestId: string; reason?: string };
export async function withTx<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T>; // BEGIN; SELECT core.set_actor(...); ...; COMMIT
export class DomainError extends Error { code: string; httpStatus: number; details?: unknown }
export function mapPgError(e: unknown): DomainError; // 'WC024: …' → { code:'WC024', httpStatus:422 }
export const money: { add, sub, mul, round2, fromString, toString } // Decimal, HALF_UP
export function madridNow(): Temporal.ZonedDateTime; export function toMadridOffsetString(ts: Date): string; // 2027-01-01T19:20:30+01:00
```

## Criterios de aceptación
- Ningún `number` de JS para importes en el núcleo (regla de Biome personalizada o revisión).
- `toMadridOffsetString` correcto en los dos cambios de hora del año.

## Tests requeridos
Unitarios y de propiedades (`fast-check`) de `money` (asociatividad de sumas con redondeo final, HALF_UP en ,005) y de `time` (cambios de hora 2027-03-28 y 2027-10-31).
