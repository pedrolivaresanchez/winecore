import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, isAbortError } from '@/lib/api'
import { copy } from '@/i18n'
import type { Vessel } from '@/lib/cellar'
import {
  listConsumables,
  listEquipment,
  listPlaces,
  listProcedures,
  listProducts,
  listSuppliers,
  type CatalogProduct,
  type Consumable,
  type ContactHit,
  type Equipment,
  type Place,
  type Procedure,
} from '@/pages/higiene/api'

export type Lookups = {
  vessels: Vessel[]
  places: Place[]
  procedures: Procedure[]
  equipment: Equipment[]
  consumables: Consumable[]
  products: CatalogProduct[]
  suppliers: ContactHit[]
}

const empty: Lookups = {
  vessels: [],
  places: [],
  procedures: [],
  equipment: [],
  consumables: [],
  products: [],
  suppliers: [],
}

export function useLookups(enabled: boolean) {
  const [data, setData] = useState<Lookups>(empty)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    Promise.all([
      api<{ items: Vessel[] }>('/v1/vessels?limit=100', { signal: controller.signal }),
      listPlaces(controller.signal),
      listProcedures('true', controller.signal),
      listEquipment(controller.signal),
      listConsumables(controller.signal),
      listProducts(controller.signal),
      listSuppliers(controller.signal),
    ])
      .then(([vessels, places, procedures, equipment, consumables, products, suppliers]) => {
        if (!active) return
        setData({
          vessels: vessels.items ?? [],
          places: places.items ?? [],
          procedures: procedures.items ?? [],
          equipment: equipment.items ?? [],
          consumables: consumables.items ?? [],
          products: products.items ?? [],
          suppliers: suppliers.items ?? [],
        })
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, enabled])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return { data, error, loading, reload }
}
