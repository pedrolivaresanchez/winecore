import { useMemo } from 'react'
import { useList } from '@/pages/existencias/use-list'
import type { LocationRow } from '@/pages/regulatorio/api'
import type { WarehouseOption } from '@/pages/regulatorio/model'

export function useWarehouses() {
  const page = useList<LocationRow>('/v1/locations?limit=100')
  const forbidden = page.error?.status === 403
  const warehouses = useMemo<WarehouseOption[]>(() => {
    const map = new Map<string, WarehouseOption>()
    for (const location of page.items) {
      if (!location.is_active || !location.tax_warehouse_id) continue
      if (map.has(location.tax_warehouse_id)) continue
      map.set(location.tax_warehouse_id, {
        id: location.tax_warehouse_id,
        name: location.name,
        entityId: location.controlling_entity_id,
      })
    }
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, 'es'))
  }, [page.items])

  return {
    warehouses,
    loading: page.loading,
    error: forbidden ? null : page.error,
    reload: page.reload,
  }
}
