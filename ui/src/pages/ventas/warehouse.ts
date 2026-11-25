import type { CatalogLocation, CatalogLot } from '@/lib/sales-catalog'

export type Warehouse = { id: string; code: string; name?: string | null }

/** Bodega first, then TFRP, then the rest by code. */
export function warehouseOptions<T extends Warehouse>(locations: readonly T[]): T[] {
  const rank = (code: string) => (code === 'BOD' ? 0 : code === 'TFRP' ? 1 : 2)
  return [...locations].sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code, 'es'))
}

export function defaultWarehouseId(locations: readonly Warehouse[]): string {
  return warehouseOptions(locations)[0]?.id ?? ''
}

export function warehouseLabel(location: Warehouse | null | undefined): string {
  if (!location) return '—'
  const name = location.name?.trim() ?? ''
  if (!name || name.toUpperCase() === location.code.toUpperCase()) return location.code
  return `${name} · ${location.code}`
}

export function unitsAt(lots: readonly CatalogLot[], locationId: string, productId?: string): number {
  return lots.reduce((sum, lot) => {
    if (lot.locationId !== locationId) return sum
    if (productId && lot.productId !== productId) return sum
    return sum + (Number.isFinite(lot.qty) ? lot.qty : 0)
  }, 0)
}

export function findWarehouse(locations: readonly CatalogLocation[], id: string): CatalogLocation | null {
  return locations.find((item) => item.id === id) ?? null
}
