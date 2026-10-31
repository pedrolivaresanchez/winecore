import { useMemo } from 'react'
import { useApi } from '@/hooks/use-api'
import type { WarehouseOption } from '@/pages/regulatorio/model'

type TaxWarehouseRow = {
  id: string
  code: string
  name: string
  cae: string
  entity: { id: string; code: string }
  is_active: boolean
}

export function useWarehouses() {
  const page = useApi<{ items: TaxWarehouseRow[] }>('/v1/tax-warehouses')
  const warehouses = useMemo<WarehouseOption[]>(() => {
    return (page.data?.items ?? [])
      .filter((item) => item.is_active)
      .map((item) => ({
        id: item.id,
        name: item.name,
        cae: item.cae,
        entityId: item.entity.id,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'es'))
  }, [page.data])

  return {
    warehouses,
    loading: page.loading,
    error: page.error,
    reload: page.reload,
  }
}
