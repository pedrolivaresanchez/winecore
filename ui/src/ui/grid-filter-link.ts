import { useState, useSyncExternalStore, type ReactNode } from 'react'

/** One column condition, as the bar draws it: `País` · `España +1`. */
export type GridFilterEntry = { id: string; label: string; summary: string }

export type GridFilterSnapshot = {
  /** Conditions in force, in column order. */
  active: GridFilterEntry[]
  /** Columns a condition can be put on. */
  available: { id: string; label: string }[]
  /** Rows left after the conditions, of the rows the page loaded. */
  shown: number
  loaded: number
  /** Bumped when the loaded rows change, so an open value menu recounts. */
  revision: number
}

type Handlers = {
  remove: (id: string) => void
  clear: () => void
  menu: (id: string, close: () => void) => ReactNode
}

/**
 * The grid's column filters, readable from outside the grid.
 *
 * The conditions a header menu sets are the grid's own state, worked out from the cells it
 * draws; the bar above it is a sibling. Lifting that state would teach every page the grid's
 * internals, so the grid publishes what is in force here and the bar subscribes — and asks
 * the grid for the menu it would have opened, so a chip edits the same condition the header does.
 */
export type GridFilterLink = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => GridFilterSnapshot
  publish: (snapshot: GridFilterSnapshot, handlers: Handlers | null) => void
  remove: (id: string) => void
  clear: () => void
  menu: (id: string, close: () => void) => ReactNode
}

export const EMPTY_GRID_FILTERS: GridFilterSnapshot = { active: [], available: [], shown: 0, loaded: 0, revision: 0 }

export function createGridFilterLink(): GridFilterLink {
  let snapshot = EMPTY_GRID_FILTERS
  let signature = JSON.stringify(snapshot)
  let handlers: Handlers | null = null
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    publish: (next, nextHandlers) => {
      handlers = nextHandlers
      const nextSignature = JSON.stringify(next)
      if (nextSignature === signature) return
      signature = nextSignature
      snapshot = next
      for (const listener of listeners) listener()
    },
    remove: (id) => handlers?.remove(id),
    clear: () => handlers?.clear(),
    menu: (id, close) => handlers?.menu(id, close) ?? null,
  }
}

/** One per list: hand it to the `DataGrid` and to the `FilterBar` above it. */
export function useGridFilterLink(): GridFilterLink {
  const [link] = useState(createGridFilterLink)
  return link
}

const noSubscribe = () => () => undefined
const noSnapshot = () => EMPTY_GRID_FILTERS

export function useGridFilters(link: GridFilterLink | null | undefined): GridFilterSnapshot {
  return useSyncExternalStore(link?.subscribe ?? noSubscribe, link?.getSnapshot ?? noSnapshot, link?.getSnapshot ?? noSnapshot)
}
