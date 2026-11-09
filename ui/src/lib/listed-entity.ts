import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import type { EntityChoice } from '@/lib/types'

export type ListedEntity = '' | 'PO' | 'CVPO'

/**
 * Company for a document list.
 * The selector in the account menu wins: P.O or CVPO shows only that company.
 * "Ambas" lets the list's own filter narrow further. `?entity=all` does not
 * reopen the other company while one is selected.
 */
export function listedEntity(urlEntity: string | null, rail: EntityChoice): ListedEntity {
  if (rail === 'PO' || rail === 'CVPO') return rail
  if (urlEntity === 'PO' || urlEntity === 'CVPO') return urlEntity
  return ''
}

export function useListedEntity(): ListedEntity {
  const { filter: rail } = useEntity()
  const [params, setParams] = useSearchParams()
  const railRef = useRef(rail)

  useEffect(() => {
    const previous = railRef.current
    railRef.current = rail
    const raw = params.get('entity')
    if (rail === 'PO' || rail === 'CVPO') {
      if (raw === rail) return
      const next = new URLSearchParams(params)
      next.set('entity', rail)
      next.delete('page')
      setParams(next, { replace: true })
      return
    }
    if (raw === 'all' || (previous !== 'all' && (raw === 'PO' || raw === 'CVPO'))) {
      const next = new URLSearchParams(params)
      next.delete('entity')
      next.delete('page')
      setParams(next, { replace: true })
    }
  }, [params, rail, setParams])

  return listedEntity(params.get('entity'), rail)
}
