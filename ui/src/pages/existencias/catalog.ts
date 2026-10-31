import { useEffect, useState } from 'react'
import { ApiError, api, isAbortError } from '@/lib/api'
import type { MeEntity } from '@/lib/types'
import { absorbCatalog, emptyCatalog, type Catalog } from '@/pages/existencias/adapt'

type Page<T> = { items?: T[]; next_cursor?: string | null }

async function collect(path: string, signal: AbortSignal): Promise<unknown[]> {
  const out: unknown[] = []
  let cursor: string | null = null
  const base = path.split('?')[0] ?? path
  for (let page = 0; page < 8; page += 1) {
    const params = new URLSearchParams()
    params.set('limit', '100')
    if (cursor) params.set('cursor', cursor)
    const body = await api<Page<unknown>>(`${base}?${params}`, { signal })
    out.push(...(body.items ?? []))
    cursor = body.next_cursor ?? null
    if (!cursor) break
  }
  return out
}

async function safe(path: string, signal: AbortSignal): Promise<unknown[]> {
  try {
    return await collect(path, signal)
  } catch (error) {
    if (isAbortError(error) || (error instanceof ApiError && error.status === 0 && error.code === 'WC_NETWORK' && signal.aborted)) throw error
    if (isAbortError(error)) throw error
    return []
  }
}

export function useCatalog(entities: MeEntity[]) {
  const [catalog, setCatalog] = useState<Catalog>(() => emptyCatalog(entities))
  const [ready, setReady] = useState(false)
  const key = entities.map((entity) => entity.id).join(',')

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const base = emptyCatalog(entities)
    setCatalog(base)
    setReady(false)
    Promise.all([
      safe('/v1/locations', controller.signal),
      safe('/v1/vessels', controller.signal),
      safe('/v1/lots', controller.signal),
      safe('/v1/products', controller.signal),
      safe('/v1/wines', controller.signal),
      safe('/v1/formats', controller.signal),
    ])
      .then(([locations, vessels, lots, products, wines, formats]) => {
        if (!active) return
        setCatalog(absorbCatalog(base, { locations, vessels, lots, products, wines, formats }))
        setReady(true)
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) return
        setCatalog(base)
        setReady(true)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [entities, key])

  return { catalog, ready }
}
