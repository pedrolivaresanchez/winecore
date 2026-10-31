import { useLayoutEffect, type RefObject } from 'react'

/**
 * Where a list was scrolled when you left it.
 *
 * Opening a company (or any record) is a page, so the grid unmounts. Closing it mounts a
 * new one, which would otherwise start at the top — forty rows away from the row you just
 * looked at. The cut's cache key is the identity: the same view, same page, same filter
 * is the same place, and a different cut is not.
 *
 * Session-only, same as the record cursor. Another tab is another reading session.
 */

const STORAGE_KEY = 'crm:index-scroll'
const MAX_ENTRIES = 48

export type ScrollPos = { top: number; left: number }

let memory: Record<string, ScrollPos> = {}
let order: string[] = []
let hydrated = false

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { entries?: Record<string, ScrollPos>; order?: string[] }
    if (!parsed?.entries || typeof parsed.entries !== 'object') return
    memory = parsed.entries
    order = Array.isArray(parsed.order) ? parsed.order.filter((key) => key in memory) : Object.keys(memory)
  } catch {
    /* An unreadable session is no session. The grid opens at the top. */
  }
}

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: memory, order }))
  } catch {
    /* Private mode still has the in-memory copy for the tab. */
  }
}

export function readScroll(key: string): ScrollPos | null {
  hydrate()
  return memory[key] ?? null
}

export function rememberScroll(key: string, pos: ScrollPos): void {
  hydrate()
  memory[key] = pos
  order = order.filter((item) => item !== key)
  order.push(key)
  while (order.length > MAX_ENTRIES) {
    const oldest = order.shift()
    if (oldest) delete memory[oldest]
  }
  persist()
}

/** Tests only. */
export function resetScrollMemory(): void {
  memory = {}
  order = []
  hydrated = true
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* jsdom without storage */
  }
}

/**
 * Put a scroller — and every nested one — back at the origin.
 *
 * A record page keeps its columns mounted when you step to the next company, so the
 * activity feed's offset is still the last company's. The browser then clamps that
 * leftover to the new feed's height, which is how you land at the bottom of an
 * account you just opened.
 */
export function resetNestedScroll(root: HTMLElement | null): void {
  if (!root) return
  const reset = (node: HTMLElement) => {
    node.scrollTop = 0
    node.scrollLeft = 0
  }
  reset(root)
  const nested = root.querySelectorAll<HTMLElement>('*')
  for (let i = 0; i < nested.length; i++) reset(nested[i]!)
}

/**
 * Put a scroller back where it was, then keep it.
 *
 * Applied in layout so the restored offset paints — a `useEffect` would flash the top
 * for a frame. Writing is ignored while that apply is in flight: setting `scrollTop`
 * on an empty grid clamps to 0 and would otherwise overwrite the real position.
 *
 * `ready` is the content having arrived. A skeleton is not tall enough to hold a
 * saved offset, and applying into it would clamp.
 */
export function useScrollRestore(
  key: string | null | undefined,
  ref: RefObject<HTMLElement | null>,
  ready = true,
): void {
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !key || !ready) return

    let applying = true
    const saved = readScroll(key)
    node.scrollTop = saved?.top ?? 0
    node.scrollLeft = saved?.left ?? 0
    const done = requestAnimationFrame(() => {
      applying = false
    })

    const onScroll = () => {
      if (applying) return
      rememberScroll(key, { top: node.scrollTop, left: node.scrollLeft })
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(done)
      node.removeEventListener('scroll', onScroll)
      /* Closing a record unmounts this scroller. The last wheel already wrote, and this
         catches a programmatic move that did not fire in time — without writing the
         clamped 0 of an apply that never painted. */
      if (!applying) onScroll()
    }
  }, [key, ready])
}
