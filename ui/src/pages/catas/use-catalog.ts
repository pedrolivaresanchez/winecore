import { useEffect, useState } from 'react'
import { ApiError, isAbortError } from '@/lib/api'
import type { LotListItem } from '@/lib/cellar'
import type { Wine } from '@/pages/catalogo/model'
import { listDescriptors, listLotPage, listTemplates, listWines, messageOf } from '@/pages/catas/api'
import type { Descriptor, Template } from '@/pages/catas/types'

export type Catalog = {
  templates: Template[]
  descriptors: Descriptor[]
  lots: LotListItem[]
  wines: Wine[]
  loading: boolean
  error: string | null
  reload: () => void
  lotCode: (id: string | null | undefined) => string
  wineName: (id: string | null | undefined) => string
  templateName: (idOrCode: string | null | undefined) => string
}

export function useCatalog(enabled: boolean): Catalog {
  const [templates, setTemplates] = useState<Template[]>([])
  const [descriptors, setDescriptors] = useState<Descriptor[]>([])
  const [lots, setLots] = useState<LotListItem[]>([])
  const [wines, setWines] = useState<Wine[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    Promise.all([
      listTemplates(controller.signal),
      listDescriptors(controller.signal),
      listLotPage(controller.signal).catch(() => ({ items: [] as LotListItem[] })),
      listWines(controller.signal).catch(() => ({ items: [] as Wine[] })),
    ])
      .then(([templatePage, descriptorPage, lotPage, winePage]) => {
        if (!active) return
        setTemplates(templatePage.items.filter((item) => item.is_active))
        setDescriptors(descriptorPage.items.filter((item) => item.is_active))
        setLots(lotPage.items)
        setWines(winePage.items)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(messageOf(err instanceof ApiError ? err : err))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, enabled])

  return {
    templates,
    descriptors,
    lots,
    wines,
    loading,
    error,
    reload: () => {
      setLoading(true)
      setAttempt((value) => value + 1)
    },
    lotCode: (id) => lots.find((lot) => lot.id === id)?.code ?? '',
    wineName: (id) => {
      const wine = wines.find((item) => item.id === id)
      return wine ? wine.name : ''
    },
    templateName: (idOrCode) =>
      templates.find((item) => item.id === idOrCode || item.code === idOrCode)?.name ?? idOrCode ?? '',
  }
}
