import type { Tx } from '../db/writer';

const emitted = new WeakMap<Tx, Set<string>>();

/** One outbox row per event and aggregate inside a single write. */
export function emitOutboxOnce(tx: Tx, eventType: string, aggregateId: string, write: () => void): void {
  let seen = emitted.get(tx);
  if (!seen) {
    seen = new Set();
    emitted.set(tx, seen);
  }
  const key = `${eventType}\n${aggregateId}`;
  if (seen.has(key)) return;
  seen.add(key);
  write();
}
