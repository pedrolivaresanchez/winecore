import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, api, isAbortError } from '@/lib/api'
import { listContacts, type ContactSummary } from '@/lib/contacts'
import { listStock, type StockItem } from '@/lib/sales'

export type CatalogCustomer = { id: string; name: string; country: string }
export type CatalogProduct = { id: string; sku: string; label: string; requiresLot?: boolean }
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

type OfferProduct = {
  id: string
  sku: string
  name: string
  requires_lot?: boolean
  default_tax_code?: string | null
  price: { unit_price: string } | null
}

type OfferTax = {
  code: string
  rate: string
  surcharge_rate: string
}

export type TaxRate = { rate: number; surcharge: number }

type OfferLot = {
  id: string
  code: string
  product_id: string | null
  location_id: string
  location_code: string
  qty_units: string
  volume_ml: string
}

export type SalesOfferQuery = {
  customerId?: string
  channel?: string
  date?: string
}

export function useSalesOffer(query: SalesOfferQuery | null) {
  const customerId = query?.customerId?.trim() ?? ''
  const channel = query?.channel?.trim() ?? ''
  const date = query?.date?.trim() ?? ''
  const enabled = query != null
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [lots, setLots] = useState<CatalogLot[]>([])
  const [locations, setLocations] = useState<CatalogLocation[]>([])
  const [prices, setPrices] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [taxes, setTaxes] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [rates, setRates] = useState<ReadonlyMap<string, TaxRate>>(() => new Map())
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true
    const params = new URLSearchParams()
    if (customerId) params.set('customer_id', customerId)
    if (channel) params.set('channel', channel)
    if (date) params.set('date', date)
    setLoading(true)
    api<{ products: OfferProduct[]; lots: OfferLot[]; taxes?: OfferTax[] }>(`/v1/sales/catalog?${params}`, { signal: controller.signal })
      .then((body) => {
        if (!active) return
        const nextPrices = new Map<string, string>()
        const nextTaxes = new Map<string, string>()
        const nextRates = new Map<string, TaxRate>()
        for (const tax of body.taxes ?? []) {
          nextRates.set(tax.code, { rate: Number(tax.rate) || 0, surcharge: Number(tax.surcharge_rate) || 0 })
        }
        const nextProducts = (body.products ?? []).map((product) => {
          if (product.price?.unit_price) nextPrices.set(product.id, product.price.unit_price)
          if (product.default_tax_code) nextTaxes.set(product.id, product.default_tax_code)
          const name = product.name?.trim() || product.sku
          return {
            id: product.id,
            sku: product.sku,
            label: product.sku && name !== product.sku ? `${product.sku} · ${name}` : name,
            requiresLot: Boolean(product.requires_lot),
          }
        })
        nextProducts.sort((a, b) => a.label.localeCompare(b.label, 'es'))
        const nextLots: CatalogLot[] = []
        const places = new Map<string, CatalogLocation>()
        for (const lot of body.lots ?? []) {
          if (!lot.product_id || !lot.location_id) continue
          const qty = Number(lot.qty_units)
          const volume = Number(lot.volume_ml)
          nextLots.push({
            id: lot.id,
            code: lot.code || lot.id.slice(0, 8),
            productId: lot.product_id,
            locationId: lot.location_id,
            qty: Number.isFinite(qty) && qty > 0 ? qty : Number.isFinite(volume) ? volume : 0,
          })
          if (!places.has(lot.location_id)) {
            places.set(lot.location_id, { id: lot.location_id, code: lot.location_code || lot.location_id.slice(0, 8) })
          }
        }
        nextLots.sort((a, b) => a.code.localeCompare(b.code, 'es') || b.qty - a.qty)
        setProducts(nextProducts)
        setLots(nextLots)
        setLocations([...places.values()].sort((a, b) => a.code.localeCompare(b.code, 'es')))
        setPrices(nextPrices)
        setTaxes(nextTaxes)
        setRates(nextRates)
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
  }, [channel, customerId, date, enabled])

  const priceOf = useCallback((productId: string) => prices.get(productId) ?? null, [prices])
  const taxOf = useCallback((productId: string) => taxes.get(productId) ?? null, [taxes])
  const rateOf = useCallback((code: string) => rates.get(code) ?? null, [rates])

  return { products, lots, locations, priceOf, taxOf, rateOf, loading, error }
}

export function mergeProducts(products: CatalogProduct[], aliases?: ReadonlyMap<string, string>): CatalogProduct[] {
  if (!aliases || aliases.size === 0) return products
  const map = new Map(products.map((item) => [item.id, item]))
  for (const [id, label] of aliases) {
    if (!map.has(id) && label) map.set(id, { id, sku: '', label })
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'))
}

export function productAliases(lines: { product_id: string | null; description: string }[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of lines) {
    if (line.product_id && line.description) map.set(line.product_id, line.description)
  }
  return map
}
