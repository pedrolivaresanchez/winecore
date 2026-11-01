import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { PAGE_SIZES, type PaginationProps } from './pagination'

export type CursorPage<T> = { items: T[]; next_cursor?: string | null; total?: number | null }

export type CursorPageRequest = { cursor: string | null; limit: number; signal: AbortSignal }

export type CursorPagesOptions<T> = {
  /** Everything the list is cut by. A different key starts again at page one. */
  queryKey: string
  /** Names the list for the page size it keeps (`localStorage`, `winecore.pageSize.<key>`). */
  storageKey: string
  fetchPage: (request: CursorPageRequest) => Promise<CursorPage<T>>
  sizes?: readonly number[]
  defaultSize?: number
  /** `false` holds the request — no entity yet, no permission. */
  enabled?: boolean
}

export type CursorPages<T> = {
  items: T[]
  /** For an edit that lands in place — a row archived, a status changed — without a refetch. */
  setItems: Dispatch<SetStateAction<T[]>>
  total: number | null
  page: number
  pageSize: number
  loading: boolean
  error: unknown
  hasNext: boolean
  next: () => void
  prev: () => void
  setPageSize: (size: number) => void
  reload: () => void
  /** Changes whenever another page is on screen — the moment a selection stops meaning anything. */
  pageKey: string
  /** Spread into `<Pagination />`. */
  pagination: PaginationProps
}

function storageName(key: string): string {
  return `winecore.pageSize.${key}`
}

/** The page length somebody chose for this list, kept across visits. The default is not stored. */
export function usePageSize(storageKey: string, sizes: readonly number[] = PAGE_SIZES, defaultSize = 50) {
  const [size, setSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(storageName(storageKey)))
      return sizes.includes(stored) ? stored : defaultSize
    } catch {
      return defaultSize
    }
  })
  const choose = useCallback(
    (next: number) => {
      setSize(next)
      try {
        if (next === defaultSize) localStorage.removeItem(storageName(storageKey))
        else localStorage.setItem(storageName(storageKey), String(next))
      } catch {
        /* Storage can be blocked; the choice still holds for this visit. */
      }
    },
    [storageKey, defaultSize],
  )
  return [size, choose] as const
}

/**
 * Pages of a cursor-paged endpoint, one at a time.
 *
 * The API hands back the cursor of the next page and nothing that leads to the previous one,
 * so the cursors already walked are kept as a stack: «Anterior» pops it and asks again. A new
 * filter, search or page length is a different list, and it starts at page one. When the
 * endpoint does not count, the total is known only once the last page arrives.
 */
export function useCursorPages<T>({
  queryKey,
  storageKey,
  fetchPage,
  sizes = PAGE_SIZES,
  defaultSize = 50,
  enabled = true,
}: CursorPagesOptions<T>): CursorPages<T> {
  const [pageSize, setPageSize] = usePageSize(storageKey, sizes, defaultSize)
  const listKey = `${queryKey}\u0000${pageSize}`
  const [walk, setWalk] = useState<{ key: string; cursors: (string | null)[] }>({ key: listKey, cursors: [null] })
  const cursors = walk.key === listKey ? walk.cursors : [null]
  const index = cursors.length - 1
  const cursor = cursors[index] ?? null

  const [items, setItems] = useState<T[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    fetchRef
      .current({ cursor, limit: pageSize, signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return
        const next = page.next_cursor ?? null
        setItems(page.items)
        setNextCursor(next)
        setTotal(page.total ?? (next ? null : index * pageSize + page.items.length))
        setError(null)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason)
        setLoading(false)
      })
    return () => controller.abort()
  }, [enabled, listKey, cursor, index, pageSize, attempt])

  const hasNext = Boolean(nextCursor)
  const next = useCallback(() => {
    if (!nextCursor) return
    setWalk({ key: listKey, cursors: [...cursors, nextCursor] })
  }, [cursors, listKey, nextCursor])
  const prev = useCallback(() => {
    if (cursors.length <= 1) return
    setWalk({ key: listKey, cursors: cursors.slice(0, -1) })
  }, [cursors, listKey])
  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return {
    items,
    setItems,
    total,
    page: index + 1,
    pageSize,
    loading,
    error,
    hasNext,
    next,
    prev,
    setPageSize,
    reload,
    pageKey: `${listKey}\u0000${index}`,
    pagination: {
      page: index + 1,
      pageSize,
      shown: items.length,
      total,
      hasPrev: index > 0,
      hasNext,
      onPrev: prev,
      onNext: next,
      sizes,
      onPageSizeChange: setPageSize,
      loading,
    },
  }
}

/**
 * The same footer over rows that are already all here — a list the API returns whole, or one
 * the page narrows itself. Slices locally; a new `queryKey` starts again at page one.
 */
export function useLocalPages<T>(rows: T[], { queryKey, storageKey, sizes = PAGE_SIZES, defaultSize = 50 }: Omit<CursorPagesOptions<T>, 'fetchPage' | 'enabled'>) {
  const [pageSize, setPageSize] = usePageSize(storageKey, sizes, defaultSize)
  const listKey = `${queryKey}\u0000${pageSize}`
  const [at, setAt] = useState<{ key: string; page: number }>({ key: listKey, page: 1 })
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(at.key === listKey ? at.page : 1, pages)
  const items = rows.slice((page - 1) * pageSize, page * pageSize)
  return {
    items,
    page,
    pageSize,
    setPageSize,
    pageKey: `${listKey}\u0000${page}`,
    pagination: {
      page,
      pageSize,
      shown: items.length,
      total: rows.length,
      hasPrev: page > 1,
      hasNext: page < pages,
      onPrev: () => setAt({ key: listKey, page: page - 1 }),
      onNext: () => setAt({ key: listKey, page: page + 1 }),
      sizes,
      onPageSizeChange: setPageSize,
    } satisfies PaginationProps,
  }
}
