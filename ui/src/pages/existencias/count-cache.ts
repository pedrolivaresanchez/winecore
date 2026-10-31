import type { InventoryCount } from '@/pages/existencias/api'

const KEY = 'winecore.stock.counts'

export function readCountCache(): InventoryCount[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as InventoryCount[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function cachedCount(id: string): InventoryCount | null {
  return readCountCache().find((item) => item.id === id) ?? null
}

export function rememberCount(count: InventoryCount): void {
  const next = [count, ...readCountCache().filter((item) => item.id !== count.id)]
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* The session cannot store the draft. The server response still stands. */
  }
}
