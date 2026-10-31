import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from './icons'
import { Checkbox } from './checkbox'
import { Select } from './select'
import { Skeleton } from './skeleton'
import { ScrollEdgeVeil, useScrollEdges } from './scroll-edges'
import { cn } from '../lib/cn'
import { isModifiedClick } from '../lib/click'
import { DURATION_FAST, DURATION_QUICK, EASE_SMOOTH_OUT } from '../lib/motion'
import { clickRowSelect, armClickSwallow, type RowSelectGesture } from '../lib/row-select'

export type SortDirection = 'asc' | 'desc'

export type TableColumn<T> = {
  /** Stable key; also the sort key handed to `onSort`. */
  id: string
  header: ReactNode
  /** Cell content. Given the row so a cell can render more than one field. */
  cell: (row: T) => ReactNode
  sortable?: boolean
  /**
   * `right` is a number: right-aligned, tabular and never truncated — the column widens to
   * its longest value rather than cut a digit.
   */
  align?: 'left' | 'right'
  /** A fixed width keeps a numeric column from jumping, and stops it yielding to a long name. */
  width?: string
  /**
   * The narrowest an unsized column gets before the table scrolls sideways instead of
   * crushing it. Unsized columns share the leftover equally, so the widest floor among
   * them is the one that holds. Default `FLOOR`.
   */
  minWidth?: string
  /** Hidden below `sm`. For the third and fourth columns of a wide table. */
  hideOnMobile?: boolean
  /**
   * Let this cell wrap instead of truncating to the row. The row then sizes to the
   * tallest wrapping cell; other columns stay one line. Default is to truncate —
   * a sentence in the first cell must not push status and counts off the card.
   */
  wrap?: boolean
  /**
   * Truncate overflowing content (the default). Pass `false` for a cell that must stay
   * fully painted — an avatar stack, a control whose focus ring passes its edge.
   */
  clip?: boolean
}

export type TableProps<T> = {
  columns: TableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  /**
   * URL for this row. When set, the row is a real link: a plain click still goes
   * through `onRowClick` (SPA), Cmd/Ctrl-click and middle-click open a tab.
   */
  rowHref?: (row: T) => string | undefined
  sortBy?: string | null
  sortDir?: SortDirection
  onSort?: (columnId: string, dir: SortDirection) => void
  /** Pass both to make the table selectable. Shift-click paints a range from the last tick. */
  selected?: Set<string>
  onSelectedChange?: (next: Set<string>) => void
  loading?: boolean
  /** Rendered in place of the body when there are no rows and nothing is loading. */
  empty?: ReactNode
  /** Trailing chrome pinned to the right of every row, e.g. a row menu. */
  rowActions?: (row: T) => ReactNode
  /**
   * Which surface this table is sitting on.
   *
   * `card` — a framed panel on a reading surface: settings, a report, a dialog.
   * `grid` — flush under a workspace's chrome, at `DataGrid`'s density and with its cell
   *   rules. Lists and Tasks are the same kind of surface as an object index, and a
   *   rounded card pressed against the window edge reads as neither a card nor a grid.
   */
  variant?: 'card' | 'grid'
  className?: string
}

/** 56px on a reading surface; the grid's own 36px under workspace chrome. */
const ROW_H = { card: 56, grid: 36 } as const

/** The narrowest an unsized column gets: past it the table scrolls instead of crushing the column. */
const FLOOR = '10rem'
/**
 * From `sm` up, the floor of a first column that alone takes the slack: the name that is read
 * and stays pinned while the rest scroll. Not with other unsized columns, which fixed layout
 * would widen to it too.
 */
const LEAD_FLOOR = '16rem'
/** `w-10` and `w-36`, the checkbox and row-action columns, in the units the floor is summed in. */
const CHECK_W = '2.5rem'
const ACTIONS_W = '9rem'

const HIDDEN_COL = 'hidden sm:table-column'
const HIDDEN_CELL = 'hidden sm:table-cell'

/** Above the header row, which is itself above the rows: the corner where both stick. */
const Z_PINNED_HEAD = 'z-[calc(var(--z-index-sticky)+1)]'
/** Above the row link (1) and the controls lifted over it (2), under the sticky header. */
const Z_PINNED_CELL = 'z-[3]'

/** Measured width of each right-aligned column's longest value, padding included, in px. */
type Fits = Record<string, number>

type Sizing = Pick<TableColumn<unknown>, 'id' | 'width' | 'minWidth'>

function sizedWidth(column: Sizing, fits: Fits): string | undefined {
  const fit = fits[column.id]
  if (!column.width) return undefined
  return fit ? `max(${column.width}, ${fit}px)` : column.width
}

function floorOf(column: Sizing, fits: Fits, fallback = FLOOR): string {
  const floor = column.minWidth ?? fallback
  const fit = fits[column.id]
  return fit ? `max(${floor}, ${fit}px)` : floor
}

/**
 * The width under which the table stops shrinking and scrolls instead: every sized column
 * at its width, and every unsized one at the widest floor among them, because fixed layout
 * shares the leftover equally and a smaller floor would not hold. `leadFloor` replaces the
 * default floor of a first column that is the only unsized one. Spelled as CSS so a rem
 * stays a rem.
 */
export function tableFloor(columns: Sizing[], fits: Fits, extras: string[], leadFloor?: string): string {
  const parts = [...extras]
  const unsized: string[] = []
  const leadAlone = Boolean(leadFloor) && columns.filter((column) => !sizedWidth(column, fits)).length === 1
  columns.forEach((column, index) => {
    const width = sizedWidth(column, fits)
    if (width) parts.push(width)
    else unsized.push(floorOf(column, fits, index === 0 && leadAlone ? leadFloor : FLOOR))
  })
  if (unsized.length) {
    const floors = [...new Set(unsized)]
    const floor = floors.length === 1 ? floors[0] : `max(${floors.join(', ')})`
    parts.push(unsized.length === 1 ? floor : `${unsized.length} * ${floor}`)
  }
  return parts.length ? `calc(${parts.join(' + ')})` : '0px'
}

/** Nothing to show: drawn as the muted dash every empty value in the CRM wears. */
export function isBlankCell(node: ReactNode): boolean {
  if (node == null || node === false || node === '') return true
  return typeof node === 'string' && /^\s*[—–-]\s*$/.test(node)
}

function sameFits(a: Fits, b: Fits): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/**
 * The outer surface. Ported from timbal-platform `TABLE_FRAME`: a CSS border, not an
 * inset ring, because the header's muted fill paints over a ring and the table then
 * looks edgeless at the top. `border-border` (ink-200) rather than `border-subtle`, for
 * the same reason — the lighter token disappears against the sunken head. The lift is
 * `--shadow-card`, the same 1–2px contact shadow `Card` uses; it sits outside the box,
 * so `overflow-hidden` (which clips the rows to the radius) does not eat it.
 *
 * Radius is `--radius-xl` (12px, the card token) rather than the 16px panel rim — nested
 * inside a dialog or sheet that already carries 16px, a matching curve reads as a pill
 * and eats the first pixels of every cell.
 *
 * Last-row hover fills follow the frame curve. A scroll layer can defeat ancestor
 * overflow+radius clipping, so the last row owns the same bottom radii rather than
 * relying on the clip alone. The head fill needs the same treatment at the top.
 */
const TABLE_FRAME = cn(
  'relative flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-(--shadow-card)',
  '[&_thead_th:first-child]:rounded-tl-xl [&_thead_th:last-child]:rounded-tr-xl',
  '[&_tbody_tr:last-child_td]:border-b-0',
  '[&_tbody_tr:last-child_td:first-child]:rounded-bl-xl',
  '[&_tbody_tr:last-child_td:last-child]:rounded-br-xl',
)

/**
 * Card tables are part of the page, not their own scrollport. `overflow-auto` plus
 * `overscroll-contain` made every table a nested scroller — even with no overflow, a
 * scroll container at its boundary swallows the wheel, so the pointer could not scroll
 * the settings sheet (or any other reading surface) while it sat over the rows.
 *
 * Wide columns may still pan sideways. Vertical motion belongs to the page.
 */
const TABLE_SCROLL = 'overflow-x-auto rounded-[inherit]'

/**
 * Every list of rows that is not the CRM spreadsheet.
 *
 * Two faces, chosen by the surface underneath rather than by the table:
 *
 *   - `card` — a framed panel (12px card radius), boxed header band, 56px rows, a
 *     hairline between records and no vertical rules. Settings and reports read like
 *     documents, and a grid of cells inside a rounded card reads like a spreadsheet
 *     somebody wrapped in a card.
 *   - `grid` — the object index's own face: edge to edge, 36px rows, 12px cells and the
 *     grid's rules, so Lists and Tasks look like Companies. They are workspaces, and the
 *     frame has nowhere to sit when the page has no padding to sit in.
 *
 * Nothing is ever cut. Layout is `fixed`, so a long sentence ellipsizes instead of pushing
 * status and counts off the card — and the full value is one hover away (`OverflowTips`).
 * But the table never gets narrower than its columns' floors: past them it scrolls
 * sideways, the first column stays pinned so every row still says whose it is, and a veil
 * on the far edge says more columns wait there. Numbers widen their column rather than
 * lose a digit. A column that sets `wrap` grows its row instead, which is the way a queue
 * of recaps stays readable without becoming a spreadsheet. `DataGrid` remains the only
 * editable, resizable surface.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowHref,
  sortBy,
  sortDir = 'desc',
  onSort,
  selected,
  onSelectedChange,
  loading,
  empty,
  rowActions,
  variant = 'card',
  className,
}: TableProps<T>) {
  const flush = variant === 'grid'
  const selectable = Boolean(selected && onSelectedChange)
  const interactive = Boolean(onRowClick || rowHref)
  const wrapping = columns.some((column) => column.wrap)
  const keys = rows.map(rowKey)
  const selectedHere = keys.filter((k) => selected?.has(k)).length
  const allSelected = keys.length > 0 && selectedHere === keys.length
  const gestureRef = useRef<RowSelectGesture | null>(null)
  const swallowClickRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const edges = useScrollEdges(scrollRef)
  const [fits, setFits] = useState<Fits>({})
  const [, remeasure] = useReducer((n: number) => n + 1, 0)
  const keysSig = keys.join('\0')
  const prevKeysSig = useRef(keysSig)
  useLayoutEffect(() => {
    if (prevKeysSig.current === keysSig) return
    prevKeysSig.current = keysSig
    gestureRef.current = null
  }, [keysSig])

  /* A number measured in the fallback face is a few pixels short once the real one lands. */
  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => {
      if (live) remeasure()
    })
    return () => {
      live = false
    }
  }, [])

  /* Numbers are measured, not guessed: each right-aligned value sits in a shrink-wrapped
     box, and its header label is read as a text range, so neither width depends on the
     column it is in and widening the column cannot change the answer. */
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    const next: Fits = {}
    const padding = (el: HTMLElement) => {
      const style = getComputedStyle(el)
      return (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    }
    /* A pixel over: text is laid out in fractions, and a label 0.4px wider than its box
       still gets the ellipsis. */
    const keep = (id: string, need: number) => {
      next[id] = Math.max(next[id] ?? 0, Math.ceil(need) + 1)
    }
    for (const cell of table.querySelectorAll<HTMLElement>('td[data-numeric]')) {
      const value = cell.firstElementChild as HTMLElement | null
      if (!value?.offsetWidth) continue
      keep(cell.dataset.numeric!, value.offsetWidth + padding(cell))
    }
    for (const head of table.querySelectorAll<HTMLElement>('th[data-numeric]')) {
      const label = head.querySelector<HTMLElement>('[data-label]')
      if (!label || !head.offsetWidth) continue
      const range = document.createRange()
      range.selectNodeContents(label)
      const text = range.getBoundingClientRect().width
      /* A sort button carries its chevron beside the label, a gap apart. */
      const control = label.parentElement !== head ? label.parentElement : null
      let beside = 0
      if (control) {
        const gap = parseFloat(getComputedStyle(control).columnGap) || 0
        for (const child of control.children) {
          if (child !== label) beside += child.getBoundingClientRect().width + gap
        }
      }
      keep(head.dataset.numeric!, text + beside + padding(head))
    }
    setFits((prev) => (sameFits(prev, next) ? prev : next))
  })

  const reduce = useReducedMotion()
  /* One or two rows leaving is a delete. A search, an object filter or a page turn
     drops many at once, and animating that is a list performing while you type. */
  const prevKeys = useRef<string[] | null>(null)
  const removed = prevKeys.current
    ? prevKeys.current.filter((key) => !keys.includes(key)).length
    : 0
  const added = prevKeys.current
    ? keys.filter((key) => !prevKeys.current!.includes(key)).length
    : 0
  const burst = removed > 2 || added > 2 || prevKeys.current === null
  useLayoutEffect(() => {
    prevKeys.current = keys
  }, [keys])
  /* A refetch after a write sets `loading` while the old rows are still on screen.
     Zeroing duration then would clip the one-row exit that is already playing. */
  const skip = reduce || burst
  const rowEnter = {
    duration: skip ? 0 : DURATION_FAST,
    ease: EASE_SMOOTH_OUT,
  }
  const rowLeave = {
    duration: skip ? 0 : DURATION_QUICK,
    ease: EASE_SMOOTH_OUT,
  }

  const extras = [selectable ? CHECK_W : null, rowActions ? ACTIONS_W : null].filter(
    (part): part is string => part !== null,
  )
  const floors = {
    '--table-min': tableFloor(
      columns.filter((column) => !column.hideOnMobile),
      fits,
      extras,
    ),
    '--table-min-sm': tableFloor(columns, fits, extras, LEAD_FLOOR),
  } as CSSProperties

  const toggleAll = (next: boolean) => {
    if (!onSelectedChange) return
    gestureRef.current = null
    const set = new Set(selected)
    /* Only the page's own keys, added or removed. A selection that survives paging is
       the difference between "edit these 12" and "edit these 12 and whatever else was
       ticked three pages ago". */
    for (const key of keys) {
      if (next) set.add(key)
      else set.delete(key)
    }
    onSelectedChange(set)
  }

  const selectAt = (index: number, shiftKey: boolean) => {
    if (!onSelectedChange || !selected) return
    const result = clickRowSelect(keys, selected, gestureRef.current, index, shiftKey)
    if (!result) return
    gestureRef.current = result.gesture
    onSelectedChange(result.selected)
  }

  const header = (column: TableColumn<T>) => {
    const active = sortBy === column.id
    if (!column.sortable || !onSort) {
      return (
        <span data-label className="block truncate">
          {column.header}
        </span>
      )
    }
    const next: SortDirection = active && sortDir === 'desc' ? 'asc' : 'desc'
    return (
      <button
        type="button"
        onClick={() => onSort(column.id, next)}
        className={cn(
          'flex min-w-0 w-full flex-1 items-center gap-1.5 rounded-xs text-left outline-none',
          'focus-visible:shadow-(--shadow-focus)',
          column.align === 'right' && 'flex-row-reverse',
        )}
      >
        <span data-label className={cn('min-w-0 flex-1 truncate', active && 'text-info-700')}>
          {column.header}
        </span>
        {active ? (
          sortDir === 'asc' ? (
            <ChevronUp className="size-3 shrink-0 text-info-500" strokeWidth={2} />
          ) : (
            <ChevronDown className="size-3 shrink-0 text-info-500" strokeWidth={2} />
          )
        ) : (
          <ChevronsUpDown
            className="size-3 shrink-0 text-icon-muted/60 group-hover/head:text-icon"
            strokeWidth={2}
          />
        )}
      </button>
    )
  }

  /** The checkbox and the first column stay put while the rest of the row scrolls under them. */
  const pinned = (kind: 'check' | 'lead', head: boolean) =>
    cn(
      'sticky',
      kind === 'check' || !selectable ? 'left-0' : 'left-10',
      head ? Z_PINNED_HEAD : Z_PINNED_CELL,
      kind === 'lead' && edges.start && 'pinned-veil',
    )

  const headCell = (extra?: string, lead = false, sorted = false) =>
    cn(
      'group/head sticky top-0 z-(--z-sticky) overflow-hidden text-left font-normal whitespace-nowrap',
      sorted
        ? 'bg-info-50 text-info-700 outline outline-1 -outline-offset-1 outline-info-500'
        : 'bg-surface-subtle text-text-secondary',
      flush
        ? cn(
            'h-9 border-b border-r border-border-subtle',
            lead ? 'pr-2 pl-3 sm:pl-4' : 'px-3',
          )
        : 'h-11 border-b border-border px-5',
      extra,
    )

  /* Only a row that goes somewhere lights up under the pointer. */
  const fill = (marked: boolean) =>
    marked
      ? 'bg-info-50'
      : cn('bg-surface', interactive && 'group-hover/row:bg-fill-hover group-focus-visible/row:bg-fill-hover')

  const bodyCell = (
    marked: boolean,
    extra?: string,
    lead = false,
    wrap = false,
    clip = true,
  ) =>
    cn(
      wrapping ? 'align-top' : 'align-middle',
      'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
      flush
        ? cn(
            'border-b border-r border-border-subtle',
            lead ? 'pr-2 pl-3 sm:pl-4' : 'px-3',
          )
        : 'border-b border-border-subtle px-5',
      wrap || wrapping
        ? cn('py-2', wrap && 'whitespace-normal')
        : clip
          ? 'overflow-hidden'
          : undefined,
      fill(marked),
      extra,
    )

  const fillerCell = (marked: boolean) =>
    cn(
      'w-0 border-b border-border-subtle p-0',
      'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
      fill(marked),
    )

  const value = (column: TableColumn<T>, row: T) => {
    const content = column.cell(row)
    const shown = isBlankCell(content) ? <span className="text-text-disabled">—</span> : content
    if (column.align === 'right') {
      return <div className="inline-block align-middle whitespace-nowrap tabular-nums">{shown}</div>
    }
    return (
      <div
        className={cn(
          column.wrap
            ? 'min-w-0 whitespace-normal'
            : column.clip === false
              ? undefined
              : 'min-w-0 truncate',
        )}
      >
        {shown}
      </div>
    )
  }

  const rowLink = (row: T, href: string) => (
    <a
      href={href}
      tabIndex={-1}
      aria-hidden
      data-row-overlay
      className="absolute inset-0 z-[1]"
      onClick={(event) => {
        if (isModifiedClick(event)) return
        if (!onRowClick) return
        event.preventDefault()
        onRowClick(row)
      }}
    />
  )

  const hollow = !loading && rows.length === 0 && Boolean(empty)

  return (
    <div
      className={cn(
        flush ? 'relative flex min-h-0 w-full flex-col' : TABLE_FRAME,
        className,
      )}
    >
      <div
        ref={scrollRef}
        className={cn(
          flush ? 'min-h-0 overflow-auto' : TABLE_SCROLL,
          /* Grid tables fill the workspace and scroll there, like DataGrid. Card tables
             size to their rows so the page is the only vertical scroller. Empty grids
             keep the header's own height and let the empty state take the rest. */
          hollow ? 'shrink-0' : flush ? 'flex-1' : undefined,
        )}
      >
        <table
          ref={tableRef}
          style={floors}
          className={cn(
            'table-fixed border-separate border-spacing-0 text-body font-medium',
            'w-[max(100%,var(--table-min))] sm:w-[max(100%,var(--table-min-sm))]',
          )}
        >
        <colgroup>
          {selectable ? <col className="w-10" /> : null}
          {columns.map((column) => {
            const width = sizedWidth(column, fits)
            return (
              <col
                key={column.id}
                className={column.hideOnMobile ? HIDDEN_COL : undefined}
                style={width ? { width } : undefined}
              />
            )
          })}
          {rowActions ? <col className="w-36" /> : null}
          {/* Zero-width slot for the row overlay; leftover width goes to unsized columns. */}
          <col className="w-0" />
        </colgroup>

        <thead>
          <tr>
            {selectable ? (
              <th className={cn(headCell('w-10', true), pinned('check', true))}>
                <Checkbox
                  size="sm"
                  checked={allSelected ? true : selectedHere > 0 ? 'indeterminate' : false}
                  onChange={toggleAll}
                />
              </th>
            ) : null}
            {columns.map((column, index) => (
              <th
                key={column.id}
                data-numeric={column.align === 'right' ? column.id : undefined}
                aria-sort={
                  sortBy === column.id
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
                className={cn(
                  headCell(
                    cn(
                      column.align === 'right' && 'text-right',
                      column.hideOnMobile && HIDDEN_CELL,
                    ),
                    !selectable && index === 0,
                    sortBy === column.id,
                  ),
                  index === 0 && pinned('lead', true),
                )}
              >
                {header(column)}
              </th>
            ))}
            {rowActions ? <th className={headCell()} /> : null}
            <th
              className={cn(
                'sticky top-0 z-(--z-sticky) w-0 bg-surface-subtle p-0',
                flush ? 'h-9 border-b border-border-subtle' : 'h-11 border-b border-border',
              )}
            />
          </tr>
        </thead>

        <tbody>
          {loading && rows.length === 0
            ? Array.from({ length: 8 }, (_, i) => (
                <tr key={`skeleton-${i}`} style={{ height: ROW_H[variant] }}>
                  {selectable ? (
                    <td className={cn(bodyCell(false, undefined, true), pinned('check', false))} />
                  ) : null}
                  {columns.map((column, index) => (
                    <td
                      key={column.id}
                      className={cn(
                        bodyCell(
                          false,
                          column.hideOnMobile ? HIDDEN_CELL : undefined,
                          !selectable && index === 0,
                        ),
                        index === 0 && pinned('lead', false),
                      )}
                    >
                      <Skeleton className="h-3 w-full max-w-24" />
                    </td>
                  ))}
                  {rowActions ? <td className={bodyCell(false)} /> : null}
                  <td className={fillerCell(false)} />
                </tr>
              ))
            : (
                <AnimatePresence initial={false}>
                  {rows.map((row, index) => {
                    const key = rowKey(row)
                    const isSelected = selected?.has(key) === true
                    const height = ROW_H[variant]
                    const href = rowHref?.(row)
                    return (
                      <motion.tr
                        key={key}
                        tabIndex={href ? 0 : undefined}
                        onClick={!href && onRowClick ? () => onRowClick(row) : undefined}
                        onKeyDown={
                          href
                            ? (event) => {
                                if (event.key !== 'Enter') return
                                if (event.target !== event.currentTarget) return
                                event.preventDefault()
                                if (event.metaKey || event.ctrlKey) {
                                  window.open(href, '_blank', 'noopener,noreferrer')
                                  return
                                }
                                if (onRowClick) onRowClick(row)
                                else window.location.assign(href)
                              }
                            : undefined
                        }
                        className={cn(
                          'group/row outline-none',
                          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
                          !wrapping && 'overflow-hidden',
                          (onRowClick || href) && 'cursor-pointer',
                          href && 'relative',
                        )}
                        initial={wrapping ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        animate={
                          wrapping
                            ? { opacity: 1, transition: rowEnter }
                            : { opacity: 1, height, transition: rowEnter }
                        }
                        exit={
                          wrapping
                            ? { opacity: 0, transition: rowLeave }
                            : { opacity: 0, height: 0, transition: rowLeave }
                        }
                      >
                        {selectable ? (
                          <td
                            className={cn(bodyCell(isSelected, undefined, true), pinned('check', false))}
                            /* Ticking a box must not also open the record. */
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span
                              className="flex touch-none items-center"
                              onPointerDown={(event) => {
                                if (event.button !== 0) return
                                event.preventDefault()
                                event.stopPropagation()
                                armClickSwallow(swallowClickRef)
                                selectAt(index, event.shiftKey)
                              }}
                            >
                              <Checkbox
                                size="sm"
                                checked={isSelected}
                                onChange={() => {
                                  if (swallowClickRef.current) return
                                  selectAt(index, false)
                                }}
                              />
                            </span>
                          </td>
                        ) : null}
                        {columns.map((column, colIndex) => (
                          <td
                            key={column.id}
                            data-numeric={column.align === 'right' ? column.id : undefined}
                            className={cn(
                              bodyCell(
                                isSelected,
                                cn(
                                  column.align === 'right' && 'text-right',
                                  column.hideOnMobile && HIDDEN_CELL,
                                ),
                                !selectable && colIndex === 0,
                                column.wrap,
                                column.clip !== false,
                              ),
                              colIndex === 0 && pinned('lead', false),
                            )}
                          >
                            {value(column, row)}
                            {/* The pinned cell sits over the row's link, so it carries its own. */}
                            {colIndex === 0 && href ? rowLink(row, href) : null}
                          </td>
                        ))}
                        {rowActions ? (
                          <td
                            className={bodyCell(isSelected, 'relative z-[2] text-right')}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {rowActions(row)}
                          </td>
                        ) : null}
                        <td className={fillerCell(isSelected)}>
                          {href ? rowLink(row, href) : null}
                        </td>
                      </motion.tr>
                    )
                  })}
                </AnimatePresence>
              )}
        </tbody>
        </table>
      </div>

      <ScrollEdgeVeil show={edges.end && !hollow} />

      {hollow ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-16">{empty}</div>
      ) : null}
    </div>
  )
}

/**
 * Offset pagination for a table.
 *
 * Offset rather than a cursor because the CRM's tables are sortable on any column and
 * jumpable to any page, and a cursor cannot express "page 7 of 34 sorted by amount".
 *
 * `sizes` adds the other half of that: how long a page is. A named list of 105 records read
 * fifty at a time is three visits to the pager for one review, and the reader is better
 * placed than the code to say whether they want the set in front of them or a page of it.
 * Omit `sizes` and the bar is what it was — a range and two buttons.
 */
export function TablePagination({
  total,
  limit,
  offset,
  onOffsetChange,
  sizes,
  onLimitChange,
  labels,
}: {
  total: number
  limit: number
  offset: number
  onOffsetChange: (next: number) => void
  /** Page lengths offered, smallest first. Omit for a table with one fixed length. */
  sizes?: readonly number[]
  onLimitChange?: (next: number) => void
  labels: {
    range: (from: number, to: number, total: number) => string
    previous: string
    next: string
    /** Names the size control for anybody who cannot see it sitting next to the pager. */
    rowsPerPage?: string
  }
}) {
  const resizable = Boolean(sizes?.length && onLimitChange)
  /* The bar earns its inch once the set is longer than the shortest page on offer. Below
     that there is neither a page to turn nor a length to choose — and a bar that says
     "1–3 of 3" beside a control that can only make the page longer than the set is chrome
     pretending to be a decision. */
  const floor = resizable ? Math.min(limit, ...(sizes ?? [])) : limit
  if (total <= floor) return null

  const from = offset + 1
  const to = Math.min(offset + limit, total)
  /* A page longer than the set has nothing to turn to. The size control still belongs —
     it is the only way back to a shorter page. */
  const pageable = total > limit

  return (
    <div className="flex items-center justify-between gap-4 px-1">
      <span className="text-label tabular-nums text-text-tertiary">
        {labels.range(from, to, total)}
      </span>
      <div className="flex items-center gap-2">
        {pageable ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => onOffsetChange(Math.max(0, offset - limit))}
              className={cn(
                'rounded-md px-2.5 py-1 text-label font-medium text-control',
                'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-fill-hover',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              {labels.previous}
            </button>
            <button
              type="button"
              disabled={to >= total}
              onClick={() => onOffsetChange(offset + limit)}
              className={cn(
                'rounded-md px-2.5 py-1 text-label font-medium text-control',
                'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-fill-hover',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              {labels.next}
            </button>
          </div>
        ) : null}

        {resizable ? (
          <Select
            size="sm"
            value={String(limit)}
            aria-label={labels.rowsPerPage}
            onChange={(event) => onLimitChange?.(Number(event.target.value))}
          >
            {/* The number and nothing else. "200 rows per page" is the widest control on a
                bar whose whole job is to stay out of the way, and it repeats the range
                sitting an inch to its left; the accessible name carries the meaning. */}
            {sizes?.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
    </div>
  )
}
