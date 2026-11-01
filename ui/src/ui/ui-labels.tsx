import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * The few words a primitive says on its own.
 *
 * `src/ui` does not import i18n: the primitives are a design-system export and the app owns
 * its copy. The strings a primitive has to utter without a caller handing them over — the
 * name of the × on a dialog — live here, defaulted in English and overridden once at the
 * root, the way `ToastProvider` takes its labels. A `DialogHeader` reads its close label
 * from this rather than from a prop because thirty call sites passing the same word is
 * thirty chances to leave one in English.
 */
export type GridDatePreset = 'today' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'lastYear'

/** What a `DataGrid` says in its own column menu and filter strip. `{q}`, `{n}`, `{shown}`, `{total}` are filled in. */
export type GridToolLabels = {
  sortAscending: string
  sortDescending: string
  clearSort: string
  searchValues: string
  contains: string
  empty: string
  noMatch: string
  more: string
  clearFilter: string
  clearFilters: string
  shown: string
  custom: string
  today: string
  presets: Record<GridDatePreset, string>
}

/** What a list's `FilterBar`, `SelectionBar` and `Pagination` say. `{value}`, `{from}`, `{to}`, `{total}`, `{page}`, `{pages}` are filled in. */
export type ListToolLabels = {
  filters: {
    search: string
    clear: string
    add: string
    addTitle: string
    searchOptions: string
    noOptions: string
    remove: string
    pageOnly: string
  }
  selection: {
    label: string
    selectAll: string
    clear: string
  }
  pagination: {
    range: string
    rangeOpen: string
    page: string
    pageOf: string
    previous: string
    next: string
    rowsPerPage: string
  }
}

export type UiLabels = {
  /** Accessible name of the × that closes a dialog or a drawer. */
  close: string
  /** The way out of a confirmation without doing the thing. */
  cancel: string
  /** Accessible name of an `InfoTip`'s «i» when the caller does not name it. */
  moreInfo: string
  /** The words on a `WhyPopover` that brings no trigger of its own. */
  why: string
  grid: GridToolLabels
  lists: ListToolLabels
}

const DEFAULT_LABELS: UiLabels = {
  close: 'Close',
  cancel: 'Cancel',
  moreInfo: 'More information',
  why: 'Why?',
  lists: {
    filters: {
      search: 'Search',
      clear: 'Clear',
      add: 'Filter',
      addTitle: 'Add filter',
      searchOptions: 'Search',
      noOptions: 'Nothing matches',
      remove: 'Remove filter',
      pageOnly: 'Filters the rows on this page',
    },
    selection: {
      label: 'selected',
      selectAll: 'Select all',
      clear: 'Clear selection',
    },
    pagination: {
      range: '{from}–{to} of {total}',
      rangeOpen: '{from}–{to}',
      page: 'Page {page}',
      pageOf: 'Page {page} of {pages}',
      previous: 'Previous',
      next: 'Next',
      rowsPerPage: 'Rows per page',
    },
  },
  grid: {
    sortAscending: 'Sort ascending',
    sortDescending: 'Sort descending',
    clearSort: 'Clear sort',
    searchValues: 'Search values',
    contains: 'Contains “{q}”',
    empty: '(empty)',
    noMatch: 'Nothing matches',
    more: '{n} more · type to narrow',
    clearFilter: 'Clear filter',
    clearFilters: 'Clear filters',
    shown: '{shown} of {total}',
    custom: 'Custom range',
    today: 'Today',
    presets: {
      today: 'Today',
      last7: 'Last 7 days',
      last30: 'Last 30 days',
      thisMonth: 'This month',
      lastMonth: 'Last month',
      thisQuarter: 'This quarter',
      thisYear: 'This year',
      lastYear: 'Last year',
    },
  },
}

const UiLabelsContext = createContext<UiLabels>(DEFAULT_LABELS)

export function UiLabelsProvider({
  labels,
  children,
}: {
  labels: Partial<UiLabels>
  children: ReactNode
}) {
  const value = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels])
  return <UiLabelsContext.Provider value={value}>{children}</UiLabelsContext.Provider>
}

export function fillLabel(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''))
}

export function useUiLabels(): UiLabels {
  return useContext(UiLabelsContext)
}
