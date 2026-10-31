import { useEffect, useMemo, useState } from 'react'
import { ApiError, isAbortError } from '@/lib/api'
import { listContacts, type ContactSummary } from '@/lib/contacts'
import { listStock, type StockItem } from '@/lib/sales'

export type CatalogCustomer = { id: string; name: string; country: string }
export type CatalogProduct = { id: string; sku: string; label: string }
export type CatalogLot = { id: string; code: string; productId: string; locationId: string; qty: number }
export type CatalogLocation = { id: string; code: string }

export function useSalesCatalog(aliases?: ReadonlyMap<string, string>) {
  const [customers, setCustomers] = useState<CatalogCustomer[]>([])
  const [stock, setStock] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    Promise.all([
      loadCustomers(controller.signal),
      listStock(controller.signal).catch((err: unknown) => {
        if (isAbortError(err)) throw err
        return { items: [] as StockItem[] }
      }),
    ])
      .then(([contacts, inspection]) => {
        if (!active) return
        setCustomers(customersOf(contacts))
        setStock(inspection.items)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', 'No se ha podido cargar'))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const products = useMemo(() => productsOf(stock, aliases), [aliases, stock])
  const lots = useMemo(() => lotsOf(stock), [stock])
  const locations = useMemo(() => locationsOf(stock), [stock])

  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const customer of customers) map.set(customer.id, customer.name)
    return map
  }, [customers])

  return {
    loading,
    error,
    customers,
    products,
    lots,
    locations,
    customerName: (id: string | null | undefined) => (id ? names.get(id) ?? id.slice(0, 8) : '—'),
    reload: () => {
      setLoading(true)
      setAttempt((value) => value + 1)
    },
  }
}

async function loadCustomers(signal: AbortSignal): Promise<ContactSummary[]> {
  const items: ContactSummary[] = []
  let cursor: string | undefined
  for (let page = 0; page < 4; page += 1) {
    const result = await listContacts({ role: 'customer', limit: 100, cursor }, signal)
    items.push(...result.items)
    if (!result.next_cursor) break
    cursor = result.next_cursor
  }
  return items
}

function customersOf(items: ContactSummary[]): CatalogCustomer[] {
  return items
    .filter((item) => item.is_customer && !item.archived_at)
    .map((item) => ({ id: item.id, name: item.legal_name, country: item.country_code }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

function productsOf(stock: StockItem[], aliases?: ReadonlyMap<string, string>): CatalogProduct[] {
  const map = new Map<string, CatalogProduct>()
  for (const row of stock) {
    if (!row.product_id) continue
    const current = map.get(row.product_id)
    const sku = row.product_sku ?? ''
    const label = aliases?.get(row.product_id) || current?.label || sku || row.product_id.slice(0, 8)
    map.set(row.product_id, { id: row.product_id, sku: sku || current?.sku || '', label })
  }
  if (aliases) {
    for (const [id, label] of aliases) {
      if (!map.has(id)) map.set(id, { id, sku: '', label })
      else {
        const current = map.get(id)
        if (current && label) map.set(id, { ...current, label })
      }
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'))
}

function lotsOf(stock: StockItem[]): CatalogLot[] {
  const map = new Map<string, CatalogLot>()
  for (const row of stock) {
    if (!row.lot_id || !row.product_id || !row.location_id) continue
    const key = `${row.lot_id}:${row.product_id}:${row.location_id}`
    const current = map.get(key)
    const qty = Number(row.qty_units) || 0
    if (current) current.qty += qty
    else {
      map.set(key, {
        id: row.lot_id,
        code: row.lot_code ?? row.lot_id.slice(0, 8),
        productId: row.product_id,
        locationId: row.location_id,
        qty,
      })
    }
  }
  return [...map.values()].filter((lot) => lot.qty > 0).sort((a, b) => a.code.localeCompare(b.code, 'es'))
}

function locationsOf(stock: StockItem[]): CatalogLocation[] {
  const map = new Map<string, CatalogLocation>()
  for (const row of stock) {
    if (!row.location_id) continue
    if (!map.has(row.location_id)) {
      map.set(row.location_id, { id: row.location_id, code: row.location_code ?? row.location_id.slice(0, 8) })
    }
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code, 'es'))
}

export function productAliases(lines: { product_id: string | null; description: string }[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of lines) {
    if (line.product_id && line.description) map.set(line.product_id, line.description)
  }
  return map
}
