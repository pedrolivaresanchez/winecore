import { readStorage, writeStorage } from "@/lib/storage";

function key(id: string): string {
  return `winecore.stock.pending.${id}`;
}

export function readPending<T>(id: string): T | null {
  const raw = readStorage(key(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writePending(id: string, value: unknown): void {
  writeStorage(key(id), JSON.stringify(value));
}

export function clearPending(id: string): void {
  try {
    localStorage.removeItem(key(id));
  } catch {
    writeStorage(key(id), "");
  }
}
