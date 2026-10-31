# TASK-CORE-001 · Base del núcleo: datos, errores, dinero y fechas
- Hito M0 · 2 días · Escalado: sí (concurrencia e integridad: escritor único)
- Historias / RNF: RNF-07, RNF-12
- Depende de: TASK-INFRA-001

## Objetivo
Utilidades del núcleo que usa todo lo demás: cliente de datos con dos implementaciones (Knowledge Base de Timbal y DuckDB local), escritor único con *fencing* y auditoría encadenada, mapa de errores `WCnnn` → HTTP, dinero con `decimal.js` (ROUND_HALF_UP) y fechas en Europe/Madrid.

## Contexto
ADR 002 (escritor único, *fencing*, equivalencias) · `02-modelo-dominio.md` §1 (convenciones), §4 (auditoría) y §20 (códigos de error) · ADR 011.

## Ficheros
`api/src/core/db/{client.ts, timbal.ts, local.ts, writer.ts, audit.ts}`, `api/src/core/errors.ts`, `api/src/core/money.ts`, `api/src/core/time.ts`, `api/src/core/ids.ts`.

## Interfaz exacta
```ts
export interface KbClient { query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> } // timbal.ts (SDK, TIMBAL_KB_ID) | local.ts (DuckDB)
export type Actor = { type: 'user'|'agent'|'system'|'migration'; id: string; onBehalfOf?: string; requestId: string; reason?: string };
export interface Tx { read<T = Row>(sql: string, params?: unknown[]): Promise<T[]>; write(sql: string, params?: unknown[]): void; audit(change: AuditChange): void }
export async function withWrite<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T>;
// cola en proceso (una operación cada vez); lecturas al momento; al final, UNA petición:
// BEGIN; comprobación del lease del escritor; escrituras; filas de auditoría encadenadas; COMMIT
export async function read<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
export class DomainError extends Error { code: string; httpStatus: number; details?: unknown }
export const money: { add, sub, mul, round2, fromString, toString } // Decimal, HALF_UP
export function madridNow(): TZDate; export function toMadridOffsetString(ts: Date): string; // 2027-01-01T19:20:30+01:00
```

## Criterios de aceptación
- Si `fn` lanza un error o la petición falla, no se escribe nada (incluida la auditoría).
- Dos `withWrite` simultáneos se ejecutan uno detrás de otro (test con entrelazado provocado).
- Con el *lease* en manos de otra instancia, `withWrite` falla sin escribir y lo registra como error de infraestructura.
- Ningún `number` de JS para importes en el núcleo (regla de Biome personalizada o revisión).
- `toMadridOffsetString` correcto en los dos cambios de hora del año.

## Tests requeridos
Integración de `withWrite` con DuckDB local (deshacer, serialización, *fencing*, cadena de auditoría); unitarios y de propiedades (`fast-check`) de `money` (asociatividad de sumas con redondeo final, HALF_UP en ,005) y de `time` (cambios de hora 2027-03-28 y 2027-10-31).
