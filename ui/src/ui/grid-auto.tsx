import { isValidElement, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Calendar, Filter, SortAsc, SortDesc, X } from './icons'
import { Button } from './button'
import { EntityChip } from './chip'
import { DateRangeCalendar } from './date-picker'
import { formatCivilRange } from './date-range'
import { EmptyState } from './empty-state'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from './frame'
import { MenuEmpty, MenuFoot, MenuItem, MenuScroll, MenuSearch, MenuSeparator } from './menu'
import { fillLabel, useUiLabels, type GridDatePreset, type GridToolLabels } from './ui-labels'
import type { GridColumn, SortDir } from './data-grid'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'

/**
 * What a grid can do for itself when the page does not.
 *
 * Most lists hand `DataGrid` a page of rows and nothing else: no sort, no way to cut by a
 * column, and a width that resets on every visit. Rather than teach forty pages the same
 * three things, the grid reads its own cells — the text a person sees is what they sort and
 * filter by — and keeps the arrangement per list. A page that owns sorting server-side keeps
 * it; a column that draws no text (a mark, a meter) is left alone. It works over the rows the
 * page has loaded, and the strip says so with «N de M».
 */

export type ColumnFilter =
  | { kind: 'values'; values: string[] }
  | { kind: 'contains'; q: string }
  | { kind: 'date'; from: string; to: string; preset?: GridDatePreset }

type ColumnKind = 'date' | 'number' | 'text' | 'none'

export const EMPTY_VALUE = '\u2205'

const TEXT_PROPS = ['children', 'label', 'value', 'full', 'title', 'text', 'name'] as const

function walk(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'bigint') return String(node)
  if (Array.isArray(node)) return node.map((child) => (isValidElement(child) ? ` ${walk(child)} ` : walk(child))).join('')
  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>
    for (const key of TEXT_PROPS) {
      const text = walk(props[key])
      if (text.trim()) return text
    }
  }
  return ''
}

/** The words a cell shows, without rendering it. */
export function nodeText(node: ReactNode): string {
  return walk(node).replace(/\s+/g, ' ').trim()
}

function isBlank(text: string): boolean {
  return text === '' || text === '—' || text === '–' || text === '-'
}

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/
const ISO = /^(\d{4})-(\d{2})-(\d{2})/

export function dayOf(text: string): string | null {
  const dmy = DMY.exec(text)
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`
  const iso = ISO.exec(text)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

const UNIT = /\s*(€|%|[a-zA-Zºª³]{1,4}\.?)$/
const ES_NUMBER = /^[-+]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/

/** A figure in Spanish notation — `1.030,00 €`, `12.000,000 L`, `-5,3 %` — or null. */
export function numberOf(text: string): number | null {
  const bare = text.replace(/\u2212/g, '-').replace(/[\u00a0\u202f]/g, ' ').replace(/^[€$]\s*/, '').replace(UNIT, '').trim()
  if (!ES_NUMBER.test(bare)) return null
  const value = Number(bare.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function kindOf(texts: string[]): ColumnKind {
  const filled = texts.filter((text) => !isBlank(text))
  if (filled.length === 0) return 'none'
  const share = (test: (text: string) => boolean) => filled.filter(test).length / filled.length
  if (share((text) => dayOf(text) != null) >= 0.8) return 'date'
  if (share((text) => numberOf(text) != null) >= 0.8) return 'number'
  return 'text'
}

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

function compare(a: string, b: string, kind: ColumnKind): number {
  if (kind === 'date') return (dayOf(a) ?? '').localeCompare(dayOf(b) ?? '')
  if (kind === 'number') return (numberOf(a) ?? 0) - (numberOf(b) ?? 0)
  return collator.compare(a, b)
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function matches(text: string, filter: ColumnFilter): boolean {
  if (filter.kind === 'values') return filter.values.includes(isBlank(text) ? EMPTY_VALUE : text)
  if (filter.kind === 'contains') return fold(text).includes(fold(filter.q))
  const day = dayOf(text)
  return day != null && day >= filter.from && day <= filter.to
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function presetRange(preset: GridDatePreset, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear()
  const m = now.getMonth()
  const day = (offset: number) => new Date(y, m, now.getDate() + offset, 12)
  switch (preset) {
    case 'today':
      return { from: iso(now), to: iso(now) }
    case 'last7':
      return { from: iso(day(-6)), to: iso(now) }
    case 'last30':
      return { from: iso(day(-29)), to: iso(now) }
    case 'thisMonth':
      return { from: iso(new Date(y, m, 1, 12)), to: iso(new Date(y, m + 1, 0, 12)) }
    case 'lastMonth':
      return { from: iso(new Date(y, m - 1, 1, 12)), to: iso(new Date(y, m, 0, 12)) }
    case 'thisQuarter': {
      const first = m - (m % 3)
      return { from: iso(new Date(y, first, 1, 12)), to: iso(new Date(y, first + 3, 0, 12)) }
    }
    case 'thisYear':
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  }
}

const PRESETS: GridDatePreset[] = ['today', 'last7', 'last30', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'lastYear']

function filterSummary(filter: ColumnFilter, labels: GridToolLabels): string {
  if (filter.kind === 'contains') return `«${filter.q}»`
  if (filter.kind === 'date') return filter.preset ? labels.presets[filter.preset] : (formatCivilRange(filter.from, filter.to, 'es') ?? '')
  const [first, ...rest] = filter.values.map((value) => (value === EMPTY_VALUE ? labels.empty : value))
  return rest.length > 0 ? `${first} +${rest.length}` : (first ?? '')
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function read<T>(store: 'local' | 'session', key: string): T | null {
  try {
    const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(store: 'local' | 'session', key: string, value: unknown) {
  try {
    const target = store === 'local' ? localStorage : sessionStorage
    if (value == null || (typeof value === 'object' && Object.keys(value).length === 0)) target.removeItem(key)
    else target.setItem(key, JSON.stringify(value))
  } catch {
    /* Storage can be blocked; the arrangement still holds for this visit. */
  }
}

/**
 * One list, one key: the route with record ids folded out, and the pinned column. A second
 * grid on the same page has another first column, and a record's own grid is shared by
 * every record of its kind.
 */
function listKey<Row>(columns: GridColumn<Row>[]): string {
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  const route = path
    .split('/')
    .map((segment) => (/\d/.test(segment) || segment.length > 24 ? ':' : segment))
    .join('/')
  return `winecore.grid.${route}.${columns[0]?.id ?? ''}`
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

type Sort = { id: string; dir: SortDir }

export type GridAutoInput<Row> = {
  columns: GridColumn<Row>[]
  rows: Row[]
  widths: Record<string, number>
  onResize: (columnId: string, width: number) => void
  sortBy?: string | null
  sortDir?: SortDir
  onSort?: (columnId: string, dir: SortDir) => void
  total?: number
  /** `null` keeps nothing between visits. */
  persistKey?: string | null
  enabled: boolean
}

export function useGridAuto<Row>({
  columns,
  rows,
  widths,
  onResize,
  sortBy,
  sortDir,
  onSort,
  total,
  persistKey,
  enabled,
}: GridAutoInput<Row>) {
  const key = persistKey === null ? null : (persistKey ?? listKey(columns))
  const [localSort, setLocalSort] = useState<Sort | null>(() => (enabled && key ? read<Sort>('local', `${key}.sort`) : null))
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>(() =>
    enabled && key ? (read<Record<string, ColumnFilter>>('session', `${key}.filters`) ?? {}) : {},
  )
  const [savedWidths, setSavedWidths] = useState<Record<string, number>>(() =>
    key ? (read<Record<string, number>>('local', `${key}.widths`) ?? {}) : {},
  )

  useEffect(() => {
    if (!key) return
    setLocalSort(enabled ? read<Sort>('local', `${key}.sort`) : null)
    setFilters(enabled ? (read<Record<string, ColumnFilter>>('session', `${key}.filters`) ?? {}) : {})
    setSavedWidths(read<Record<string, number>>('local', `${key}.widths`) ?? {})
  }, [key, enabled])

  const texts = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!enabled) return map
    for (const column of columns) {
      map.set(
        column.id,
        rows.map((row) => {
          const own = column.filterValue?.(row)
          return own != null ? own : nodeText(column.cell(row))
        }),
      )
    }
    return map
  }, [enabled, columns, rows])

  const kinds = useMemo(() => {
    const map = new Map<string, ColumnKind>()
    for (const [id, list] of texts) map.set(id, kindOf(list))
    return map
  }, [texts])

  const controlled = Boolean(onSort)
  const sort: Sort | null = controlled ? (sortBy ? { id: sortBy, dir: sortDir ?? 'desc' } : null) : localSort
  const liveFilters = useMemo(() => {
    const ids = new Set(columns.map((column) => column.id))
    return Object.fromEntries(Object.entries(filters).filter(([id]) => ids.has(id)))
  }, [columns, filters])
  const filterCount = Object.keys(liveFilters).length

  const visible = useMemo(() => {
    if (!enabled) return rows
    let order = rows.map((_, index) => index)
    for (const [id, filter] of Object.entries(liveFilters)) {
      const list = texts.get(id)
      if (list) order = order.filter((index) => matches(list[index] ?? '', filter))
    }
    if (!controlled && sort) {
      const list = texts.get(sort.id)
      const kind = kinds.get(sort.id) ?? 'text'
      if (list && kind !== 'none') {
        order = [...order].sort((a, b) => {
          const left = list[a] ?? ''
          const right = list[b] ?? ''
          const blankA = isBlank(left)
          const blankB = isBlank(right)
          if (blankA || blankB) return blankA === blankB ? a - b : blankA ? 1 : -1
          const result = compare(left, right, kind)
          return (sort.dir === 'asc' ? result : -result) || a - b
        })
      }
    }
    if (order.length === rows.length && order.every((index, at) => index === at)) return rows
    return order.map((index) => rows[index]!)
  }, [enabled, rows, liveFilters, texts, controlled, sort, kinds])

  const applySort = useCallback(
    (next: Sort | null) => {
      if (controlled) {
        if (next) onSort?.(next.id, next.dir)
        return
      }
      setLocalSort(next)
      if (key) write('local', `${key}.sort`, next)
    },
    [controlled, onSort, key],
  )

  const setFilter = useCallback(
    (id: string, filter: ColumnFilter | null) => {
      setFilters((current) => {
        const next = { ...current }
        if (filter) next[id] = filter
        else delete next[id]
        if (key) write('session', `${key}.filters`, next)
        return next
      })
    },
    [key],
  )

  const clearFilters = useCallback(() => {
    setFilters({})
    if (key) write('session', `${key}.filters`, null)
  }, [key])

  const mergedWidths = useMemo(() => ({ ...widths, ...savedWidths }), [widths, savedWidths])
  const resize = useCallback(
    (id: string, width: number) => {
      setSavedWidths((current) => {
        const next = { ...current, [id]: width }
        if (key) write('local', `${key}.widths`, next)
        return next
      })
      onResize(id, width)
    },
    [key, onResize],
  )

  /* A page that sorts on the server has said which columns it can sort; the rest stay put. */
  const autoColumns = useMemo(
    () =>
      enabled
        ? columns.map((column) =>
            column.sortable !== undefined ? column : { ...column, sortable: !controlled && kinds.get(column.id) !== 'none' },
          )
        : columns,
    [enabled, controlled, columns, kinds],
  )

  /** A column with nothing to sort or filter has no menu to open. */
  const hasMenu = useCallback(
    (column: GridColumn<Row>) => {
      const kind = kinds.get(column.id) ?? 'none'
      const sortable = column.sortable !== false && kind !== 'none'
      const filterable = column.filterable !== false && (kind === 'text' || kind === 'date')
      return sortable || filterable
    },
    [kinds],
  )

  return {
    rows: visible,
    columns: autoColumns,
    widths: mergedWidths,
    onResize: resize,
    sort,
    applySort,
    filters: liveFilters,
    filterCount,
    setFilter,
    clearFilters,
    texts,
    kinds,
    hasMenu,
    total: filterCount > 0 ? visible.length : total,
    loaded: rows.length,
  }
}

// ---------------------------------------------------------------------------
// The column menu
// ---------------------------------------------------------------------------

const VALUE_CAP = 60

export function AutoColumnMenu<Row>({
  column,
  kind,
  texts,
  sort,
  onSort,
  filter,
  onFilter,
  close,
}: {
  column: GridColumn<Row>
  kind: ColumnKind
  texts: string[]
  sort: Sort | null
  onSort: (next: Sort | null) => void
  filter: ColumnFilter | undefined
  onFilter: (filter: ColumnFilter | null) => void
  close: () => void
}) {
  const labels = useUiLabels().grid
  const sorted = sort?.id === column.id ? sort.dir : null
  const sortable = column.sortable !== false && kind !== 'none'
  const filterable = column.filterable !== false && (kind === 'text' || kind === 'date')

  return (
    <>
      {filterable && kind === 'text' ? <ValueFilter texts={texts} filter={filter} onFilter={onFilter} /> : null}
      {!sortable ? null : (
        <>
          <MenuItem
            icon={<SortAsc className="size-3.5" strokeWidth={iconStroke} />}
            active={sorted === 'asc'}
            onClick={() => {
              onSort({ id: column.id, dir: 'asc' })
              close()
            }}
          >
            {labels.sortAscending}
          </MenuItem>
          <MenuItem
            icon={<SortDesc className="size-3.5" strokeWidth={iconStroke} />}
            active={sorted === 'desc'}
            onClick={() => {
              onSort({ id: column.id, dir: 'desc' })
              close()
            }}
          >
            {labels.sortDescending}
          </MenuItem>
          {sorted ? (
            <MenuItem
              icon={<X className="size-3.5" strokeWidth={iconStroke} />}
              onClick={() => {
                onSort(null)
                close()
              }}
            >
              {labels.clearSort}
            </MenuItem>
          ) : null}
        </>
      )}
      {filterable && kind === 'date' ? <DateFilter filter={filter} onFilter={onFilter} close={close} /> : null}
    </>
  )
}

function ValueFilter({
  texts,
  filter,
  onFilter,
}: {
  texts: string[]
  filter: ColumnFilter | undefined
  onFilter: (filter: ColumnFilter | null) => void
}) {
  const labels = useUiLabels().grid
  const [q, setQ] = useState('')
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const text of texts) {
      const value = isBlank(text) ? EMPTY_VALUE : text
      map.set(value, (map.get(value) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
  }, [texts])
  const picked = filter?.kind === 'values' ? new Set(filter.values) : new Set<string>()
  const term = fold(q.trim())
  const shown = term ? counts.filter(([value]) => fold(value).includes(term)) : counts
  const capped = shown.slice(0, VALUE_CAP)

  function toggle(value: string) {
    const next = new Set(picked)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onFilter(next.size > 0 ? { kind: 'values', values: [...next] } : null)
  }

  return (
    <>
      <MenuSearch
        value={q}
        onChange={setQ}
        placeholder={labels.searchValues}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && q.trim()) {
            event.preventDefault()
            onFilter({ kind: 'contains', q: q.trim() })
          }
        }}
      />
      <MenuScroll className="max-h-60">
        {q.trim() ? (
          <MenuItem checked={filter?.kind === 'contains' && filter.q === q.trim()} onClick={() => onFilter({ kind: 'contains', q: q.trim() })}>
            {fillLabel(labels.contains, { q: q.trim() })}
          </MenuItem>
        ) : filter?.kind === 'contains' ? (
          <MenuItem checked onClick={() => onFilter(null)}>
            {fillLabel(labels.contains, { q: filter.q })}
          </MenuItem>
        ) : null}
        {capped.map(([value, count]) => (
          <MenuItem key={value} checked={picked.has(value)} trailing={count} onClick={() => toggle(value)}>
            {value === EMPTY_VALUE ? labels.empty : value}
          </MenuItem>
        ))}
        {capped.length === 0 && !q.trim() ? <MenuEmpty>{labels.noMatch}</MenuEmpty> : null}
      </MenuScroll>
      {shown.length > VALUE_CAP ? <MenuFoot>{fillLabel(labels.more, { n: shown.length - VALUE_CAP })}</MenuFoot> : null}
      {filter ? (
        <MenuItem icon={<X className="size-3.5" strokeWidth={iconStroke} />} onClick={() => onFilter(null)}>
          {labels.clearFilter}
        </MenuItem>
      ) : null}
      <MenuSeparator />
    </>
  )
}

function DateFilter({
  filter,
  onFilter,
  close,
}: {
  filter: ColumnFilter | undefined
  onFilter: (filter: ColumnFilter | null) => void
  close: () => void
}) {
  const labels = useUiLabels().grid
  const range = filter?.kind === 'date' ? filter : null
  const [custom, setCustom] = useState(Boolean(range && !range.preset))

  return (
    <>
      <MenuSeparator />
      {custom ? (
        <DateRangeCalendar
          from={range?.from ?? null}
          to={range?.to ?? null}
          labels={{ clear: labels.clearFilter, today: labels.today }}
          onChange={(next, complete) => {
            if (!next.from) {
              onFilter(null)
              return
            }
            onFilter({ kind: 'date', from: next.from, to: next.to ?? next.from })
            if (complete) close()
          }}
        />
      ) : (
        <>
          {PRESETS.map((preset) => (
            <MenuItem
              key={preset}
              radio
              checked={range?.preset === preset}
              onClick={() => {
                onFilter({ kind: 'date', preset, ...presetRange(preset) })
                close()
              }}
            >
              {labels.presets[preset]}
            </MenuItem>
          ))}
          <MenuItem icon={<Calendar className="size-3.5" strokeWidth={iconStroke} />} onClick={() => setCustom(true)}>
            {labels.custom}
          </MenuItem>
        </>
      )}
      {range ? (
        <MenuItem
          icon={<X className="size-3.5" strokeWidth={iconStroke} />}
          onClick={() => {
            onFilter(null)
            close()
          }}
        >
          {labels.clearFilter}
        </MenuItem>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------

/** The conditions the column menus set, readable and removable in one place. */
export function FilterStrip<Row>({
  columns,
  filters,
  shown,
  loaded,
  onRemove,
  onClear,
}: {
  columns: GridColumn<Row>[]
  filters: Record<string, ColumnFilter>
  shown: number
  loaded: number
  onRemove: (id: string) => void
  onClear: () => void
}) {
  const labels = useUiLabels().grid
  const entries = columns.filter((column) => filters[column.id])
  if (entries.length === 0) return null
  return (
    <div className={cn('flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle bg-info-50/60', FRAME_GUTTER)}>
      <Filter className="size-3.5 shrink-0 text-info-600" strokeWidth={iconStroke} aria-hidden />
      <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
        {entries.map((column) => (
          <EntityChip key={column.id} onRemove={() => onRemove(column.id)} removeLabel={`${labels.clearFilter}: ${column.header}`}>
            <span className="text-text-tertiary">{column.header}:</span>
            <span className="max-w-48 truncate font-medium">{filterSummary(filters[column.id]!, labels)}</span>
          </EntityChip>
        ))}
      </div>
      <span className="shrink-0 text-caption tabular-nums text-text-tertiary">{fillLabel(labels.shown, { shown, total: loaded })}</span>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        {labels.clearFilters}
      </Button>
    </div>
  )
}

export function FilteredEmpty({ onClear }: { onClear: () => void }) {
  const labels = useUiLabels().grid
  return (
    <EmptyState
      size="sm"
      title={labels.noMatch}
      action={
        <Button type="button" variant="secondary" size="sm" onClick={onClear}>
          {labels.clearFilters}
        </Button>
      }
    />
  )
}
