import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown, Expand, Plus, type IconComponent } from './icons'
import { Checkbox } from './checkbox'
import { Skeleton } from './skeleton'
import { GlassMenu, useMenuOpen } from './glass-menu'
import { MenuItem, MenuLabel } from './menu'
import { ScrollEdgeVeil, useScrollEdges } from './scroll-edges'
import { cn } from '../lib/cn'
import { isModifiedClick } from '../lib/click'
import { useScrollRestore } from '../lib/scroll-restore'
import { iconStroke } from '../lib/motion'
import {
  beginRowSelectWith,
  clickRowSelect,
  extendRowSelect,
  type RowSelectGesture,
} from '../lib/row-select'

/**
 * First-column inset. Matches CRM chrome (`px-3 sm:px-4`) so the checkbox sits on
 * the same line as the object glyph rather than inside a flush table.
 */
const PINNED_X = 'pr-2 pl-3 sm:pl-4'

export type SortDir = 'asc' | 'desc'

/**
 * What a footer cell can compute for a column.
 *
 * Deliberately not open-ended: these are the questions people ask of a column while
 * scanning a list, and every one of them has to be answerable in SQL over the whole
 * filtered set rather than over the page in front of you.
 */
export type GridAggregation =
  | 'count_empty'
  | 'count_filled'
  | 'count_unique'
  | 'percent_empty'
  | 'percent_filled'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'

/** Handed to a cell editor so it can hand control back. */
export type GridEditApi = {
  /** Leave edit mode, keeping the cell selected. */
  close: () => void
  /** Leave edit mode and step to the row below — Enter, as a spreadsheet does it. */
  closeDown: () => void
}

export type GridColumn<Row> = {
  /** Stable key. Also the sort key and the aggregation key. */
  id: string
  header: string
  /** Field-type glyph. Tells somebody what a column takes before they edit it. */
  icon?: IconComponent
  align?: 'left' | 'right'
  sortable?: boolean
  /** Read mode. */
  cell: (row: Row) => ReactNode
  /**
   * Edit mode, rendered in an overlay pinned to the cell's own top-left corner so the
   * value does not move as you start typing. Omit for a column nobody may edit — the
   * grid then skips it when stepping with the keyboard's edit key.
   */
  edit?: (row: Row, api: GridEditApi) => ReactNode
  /**
   * Per-row lock on top of `edit`. An SDR can edit some contacts and not a colleague's;
   * without this the column would open an editor that the API then refuses.
   */
  editable?: (row: Row) => boolean
  /** Editors that need more room than the column has — long text, a picker list. */
  editWidth?: number
  /** Extra classes on the in-cell overlay — a wrap of chips is a cell, not a floating menu. */
  editClassName?: string
  /** Primary column only: the mark shown left of the name. The row checkbox sits to its left. */
  leading?: (row: Row) => ReactNode
  /**
   * Primary column only: wrap the identity (mark + name).
   *
   * The grid owns the control that opens the row — an `<a>` when `rowHref` is set, so
   * Cmd-click is a new tab; the caller owns anything around it, a hover card. Wrapping
   * rather than replacing keeps open/keyboard behaviour in one place. The wrapper's box
   * starts at the mark, so a hover card lines up with the avatar rather than the text.
   */
  wrapName?: (row: Row, name: ReactNode) => ReactNode
  /** Aggregations offered in this column's footer cell. Empty means no footer menu. */
  aggregations?: GridAggregation[]
}

function isEditable<Row>(column: GridColumn<Row>, row: Row | undefined): boolean {
  if (!column.edit || row === undefined) return false
  return column.editable?.(row) !== false
}

export type GridLabels = {
  addCalculation: string
  aggregation: (kind: GridAggregation) => string
  aggregations: string
  count: (n: number) => string
  clearCalculation: string
  selectAll: string
  selectRow: string
  openRecord: string
  sortAscending: string
  sortDescending: string
  /** Header button that opens the column menu rather than sorting immediately. */
  columnOptions: string
}

export type DataGridProps<Row> = {
  columns: GridColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  labels: GridLabels

  /** Column widths in px, keyed by column id. Uncontrolled columns fall back to 180. */
  widths: Record<string, number>
  onResize: (columnId: string, width: number) => void
  /** Called with the index the dragged column should land on. */
  onReorder?: (columnId: string, toIndex: number) => void

  sortBy?: string | null
  sortDir?: SortDir
  onSort?: (columnId: string, dir: SortDir) => void
  /**
   * Menu that opens from a header click. When set, a click no longer sorts on its own —
   * sorting lives in the menu, which is where hide, move and insert also belong. Omit
   * to keep the old one-click sort.
   */
  renderHeaderMenu?: (args: {
    column: GridColumn<Row>
    index: number
    close: () => void
  }) => ReactNode

  selected: Set<string>
  onSelectedChange: (next: Set<string>) => void

  /** Opens the record. The index lets the caller step through the list from inside. */
  onOpenRow: (row: Row, index: number) => void
  /**
   * URL for this row. When set, the name and the expand control are real links: a plain
   * click still goes through `onOpenRow` (SPA), Cmd/Ctrl-click and middle-click open a
   * tab. Omit — or answer undefined for one row — and that name stays a button, which is
   * what a grid whose rows do not all resolve to a page needs.
   */
  rowHref?: (row: Row) => string | undefined
  /**
   * The pointer settled on a row. For fetching what the click is about to ask for — the
   * grid does not know what that is, so it only reports the hover.
   */
  onHoverRow?: (row: Row, index: number) => void
  /**
   * Pointer down on a row. The click is still coming; this is the moment to fetch what
   * it will ask for, without waiting for a hover dwell.
   */
  onPressRow?: (row: Row, index: number) => void
  /** The row currently open, kept marked so the grid still says where you are. */
  openRowKey?: string | null
  /**
   * Drawn in the primary cell, after the selection checkbox and before the mark.
   *
   * The grid owns the wall around it: pointer, click and keys do not leave the slot, so
   * the control cannot select the row, open the record, or start a cell edit. Tasks use
   * it for the one-click complete checkbox. Omit and the column is unchanged.
   */
  rowAccessory?: (row: Row) => ReactNode

  /** Footer: the chosen aggregation per column, and its already-formatted result. */
  aggregation?: Record<string, GridAggregation | undefined>
  onAggregationChange?: (columnId: string, kind: GridAggregation | null) => void
  /** Formatted value per column. `null` while it is still being computed. */
  aggregationValues?: Record<string, string | null>
  /** Total matching the current filter, shown under the primary column. */
  total?: number

  loading?: boolean
  /** Shown in place of the body when nothing matched. */
  empty?: ReactNode
  className?: string
  /**
   * Identity of this page of rows. When set, scroll survives leaving and coming back —
   * opening a record unmounts the grid, and without this the new one would start at the
   * top. Omit and a new page of rows still resets to the top, which is what paging is.
   */
  scrollKey?: string | null
  /**
   * Pixels kept after the table while a selection dock covers the bottom of this scroller.
   *
   * A trailing spacer, not padding. Padding on the scroller insets `position: sticky`, so
   * the footer would jump up over the rows at the moment a box is ticked — the jump the
   * dock was introduced to avoid. The spacer only adds room you can scroll into, and
   * `scroll-padding` tells keyboard focus the same number. Zero leaves the grid as it was.
   */
  endClearance?: number
}

/** A body row and the sticky footer. `h-9`. The selection dock rises by this. */
export const GRID_ROW_H = 36
const ROW_H = GRID_ROW_H
/** The sticky header's height — `h-9` on every header cell. Part of the scroll maths. */
const HEAD_H = 36
const DEFAULT_W = 180
const MIN_W = 96
const MAX_W = 720
/**
 * The pinned column's floor. It carries the checkbox, the record's mark and often a
 * LinkedIn bug before the name starts; at the 180 every other column gets, that leaves the
 * name — the one thing the row is read by — eight letters.
 */
const PINNED_MIN_W = 240
/** Pointer travel before a header press becomes a reorder rather than a click. */
const DRAG_THRESHOLD = 5

function clampWidth(width: number) {
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(width)))
}

type Cursor = { row: number; col: number }

/**
 * The spreadsheet the CRM is read and edited in.
 *
 * A real `<table>` with `table-layout: fixed`. Dragged widths are definite — a long
 * company name ellipsizes instead of stretching the column, which is the only way a
 * resize handle can actually shrink. `border-separate` rather than collapse because a
 * collapsed border disappears under a sticky cell, and the pinned first column is the
 * feature that makes a forty-column list navigable at all.
 *
 * Three things make this feel like a workspace rather than a report:
 *
 *   - The first column is pinned, carries the record's mark, and shows a checkbox to the
 *     left of that mark on hover. Selection is where your cursor already is. Shift-click
 *     and a drag across the rows paint a range, the way a spreadsheet selects. The grid
 *     does not highlight text — that is a document trick, and this is a sheet. A
 *     `rowAccessory` can sit between that checkbox and the mark — a task's complete
 *     control — and is walled off from selection, opening and cell editing.
 *   - Every cell is a value you can change in place. Click selects, Enter or a second
 *     click opens the editor over the cell, arrows move, Escape backs out. Nobody opens a
 *     record page to fix a phone number.
 *   - The footer is a row of questions about the column above it, and the answers come
 *     from the server over the whole filtered set — a sum of the fifty rows on screen
 *     would be a number that looks right and is wrong.
 *
 * Nothing here animates. A grid is the surface people touch a hundred times a day, and a
 * row that fades in is a row you have to wait for; the motion contract bans it outright.
 * The only movement is direct manipulation — a column following the pointer that drags it.
 *
 * Every row of the page is drawn, however long the page is. Windowing was tried here when
 * the page length became the reader's choice (`records/page-size.ts`) and taken back out:
 * it holds the undrawn rows as height and fills them in as the scroller moves, so a scroll
 * faster than React can re-render lands on rows that are not there yet — and a band of
 * empty rows in a spreadsheet does not read as "still drawing", it reads as data that
 * failed to load. There is no way around that in a real `<table>`, because the browser's
 * own answer, `content-visibility`, relies on containment that does not apply to table
 * rows. So the page length stops at 200 instead: four times the rows this grid has always
 * drawn, paid once when the page lands, and never seen as a hole in somebody's list.
 */
export function DataGrid<Row>({
  columns,
  rows,
  rowKey,
  labels,
  widths,
  onResize,
  onReorder,
  sortBy,
  sortDir = 'desc',
  onSort,
  renderHeaderMenu,
  selected,
  onSelectedChange,
  onOpenRow,
  rowHref,
  onHoverRow,
  onPressRow,
  openRowKey,
  aggregation,
  onAggregationChange,
  aggregationValues,
  total,
  loading,
  empty,
  className,
  scrollKey,
  rowAccessory,
  endClearance = 0,
}: DataGridProps<Row>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headRefs = useRef(new Map<string, HTMLTableCellElement>())
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [editing, setEditing] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const edges = useScrollEdges(scrollRef)

  const pinnedId = columns[0]?.id
  const widthOf = useCallback(
    (id: string) => {
      const width = clampWidth(widths[id] ?? DEFAULT_W)
      return id === pinnedId ? Math.max(PINNED_MIN_W, width) : width
    },
    [widths, pinnedId],
  )
  const tableWidth = columns.reduce((sum, column) => sum + widthOf(column.id), 0)

  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey])

  /**
   * Callbacks the rows are handed, held stable through refs.
   *
   * A row only redraws when something about *that row* changed, and it can only tell that
   * from its props — so a handler rebuilt on every render would defeat the whole thing and
   * put fifty rows' worth of cells back through React on every click. The refs let the
   * handlers close over current state without changing identity.
   */
  const latest = useRef({
    selected,
    onSelectedChange,
    onOpenRow,
    onHoverRow,
    onPressRow,
    rowHref,
    keys,
    editing,
  })
  latest.current = {
    selected,
    onSelectedChange,
    onOpenRow,
    onHoverRow,
    onPressRow,
    rowHref,
    keys,
    editing,
  }

  const hrefOf = useCallback((row: Row) => latest.current.rowHref?.(row), [])

  /**
   * Last planted origin. Survives across renders so Shift-click and a drag can paint
   * from the row you started on without the parent storing it.
   */
  const gestureRef = useRef<RowSelectGesture | null>(null)
  const paintCleanupRef = useRef<(() => void) | null>(null)
  const lastPaintIndexRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)

  const swallowNextClick = useCallback(() => {
    suppressClickRef.current = true
  }, [])

  const releaseClickSwallow = useCallback(() => {
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }, [])

  const applyClick = useCallback((index: number, shiftKey: boolean) => {
    const { keys: page, selected: current, onSelectedChange: emit } = latest.current
    const result = clickRowSelect(page, current, gestureRef.current, index, shiftKey)
    if (!result) return
    gestureRef.current = result.gesture
    emit(result.selected)
  }, [])

  /* Keyboard Space on the checkbox. A pointer already applied the tick on press — the
     click that follows on release must not toggle it back off. */
  const onSelectKey = useCallback(
    (index: number, shiftKey: boolean) => {
      if (suppressClickRef.current) return
      applyClick(index, shiftKey)
    },
    [applyClick],
  )

  const applyExtend = useCallback((index: number) => {
    const gesture = gestureRef.current
    if (!gesture) return
    if (lastPaintIndexRef.current === index) return
    lastPaintIndexRef.current = index
    const { keys: page, onSelectedChange: emit } = latest.current
    if (index < 0 || index >= page.length) return
    emit(extendRowSelect(page, gesture, index))
  }, [])

  const rowIndexAt = useCallback((clientY: number, clamp = true) => {
    const node = scrollRef.current
    const count = latest.current.keys.length
    if (!node || count === 0) return null
    const rect = node.getBoundingClientRect()
    const y = clientY - rect.top + node.scrollTop - HEAD_H
    const raw = Math.floor(y / ROW_H)
    if (!clamp) {
      if (raw < 0 || raw >= count) return null
      return raw
    }
    return Math.max(0, Math.min(count - 1, raw))
  }, [])

  const paintFromPointer = useCallback(
    (event: PointerEvent) => {
      const node = scrollRef.current
      if (node) {
        const rect = node.getBoundingClientRect()
        const foot = Math.max(ROW_H, endClearance)
        if (event.clientY < rect.top + ROW_H) node.scrollTop -= ROW_H
        else if (event.clientY > rect.bottom - foot) node.scrollTop += ROW_H
      }
      const next = rowIndexAt(event.clientY)
      if (next != null) applyExtend(next)
    },
    [applyExtend, endClearance, rowIndexAt],
  )

  const listenPaint = useCallback(
    (onArmedUp?: () => void) => {
      paintCleanupRef.current?.()
      window.getSelection()?.removeAllRanges()
      const onMove = (event: PointerEvent) => {
        event.preventDefault()
        paintFromPointer(event)
      }
      const onUp = () => {
        paintCleanupRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        releaseClickSwallow()
        onArmedUp?.()
      }
      paintCleanupRef.current = onUp
      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [paintFromPointer, releaseClickSwallow],
  )

  const onSelectPointerDown = useCallback(
    (index: number, shiftKey: boolean) => {
      applyClick(index, shiftKey)
      lastPaintIndexRef.current = index
      scrollRef.current?.focus({ preventScroll: true })
      /* Press applied the tick. Swallow the click that the browser still fires on
         release, or the checkbox `onChange` toggles the same row back off. */
      swallowNextClick()
      listenPaint()
    },
    [applyClick, listenPaint, swallowNextClick],
  )

  const onBodyPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      if (latest.current.editing) return
      const target = event.target as HTMLElement
      if (target.closest('thead, tfoot, [data-row-select], [data-row-accessory], [data-grid-edit]'))
        return
      const index = rowIndexAt(event.clientY, false)
      if (index == null) return

      /* Shift-click on a name is a new window. Shift-click on any other cell extends
         the ticked run, then a drag keeps painting. */
      if (event.shiftKey && !target.closest('a')) {
        event.preventDefault()
        applyClick(index, true)
        lastPaintIndexRef.current = index
        scrollRef.current?.focus({ preventScroll: true })
        swallowNextClick()
        listenPaint()
        return
      }

      const startY = event.clientY
      let armed = false
      paintCleanupRef.current?.()
      const onMove = (move: PointerEvent) => {
        const dy = move.clientY - startY
        if (!armed) {
          const nextRow = rowIndexAt(move.clientY, false)
          const crossed = nextRow != null && nextRow !== index
          if (!crossed && Math.abs(dy) < DRAG_THRESHOLD) return
          const { keys: page, selected: current, onSelectedChange: emit } = latest.current
          const planted = beginRowSelectWith(page, current, index, true)
          if (!planted) return
          armed = true
          gestureRef.current = planted.gesture
          lastPaintIndexRef.current = index
          emit(planted.selected)
          swallowNextClick()
          scrollRef.current?.focus({ preventScroll: true })
          window.getSelection()?.removeAllRanges()
        }
        move.preventDefault()
        paintFromPointer(move)
      }
      const onUp = () => {
        paintCleanupRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        if (armed) releaseClickSwallow()
      }
      paintCleanupRef.current = onUp
      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [applyClick, listenPaint, paintFromPointer, releaseClickSwallow, rowIndexAt, swallowNextClick],
  )

  const onGridClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
    suppressClickRef.current = false
  }, [])

  useEffect(() => () => paintCleanupRef.current?.(), [])

  const openRow = useCallback((row: Row, index: number) => {
    latest.current.onOpenRow(row, index)
  }, [])

  const hoverRow = useCallback((row: Row, index: number) => {
    latest.current.onHoverRow?.(row, index)
  }, [])

  const pressRow = useCallback((row: Row, index: number) => {
    latest.current.onPressRow?.(row, index)
  }, [])

  const focusCell = useCallback((row: number, col: number, edit: boolean) => {
    setCursor((current) => {
      /* A second press on the cell you are already on opens it — the double-click
         everybody tries, without the timing. */
      if (current?.row === row && current?.col === col) {
        if (edit) setEditing(true)
        return current
      }
      setEditing(false)
      return { row, col }
    })
  }, [])

  const hasFooter = Boolean(onAggregationChange) && rows.length > 0

  /**
   * Bring a row inside the viewport, by arithmetic rather than by asking the DOM.
   *
   * Every row is `ROW_H` tall and the first one starts below a header of `HEAD_H`, so where
   * a row sits is known without measuring it. Both sticky bands are subtracted: landing a
   * row under the header or behind the footer totals is the same as not scrolling to it.
   */
  const reveal = useCallback(
    (index: number) => {
      const node = scrollRef.current
      if (!node) return
      /* The spacer sits under the footer once you have scrolled to it, so a row has to
         clear both or the last one lands in the footer. */
      const foot = (hasFooter ? ROW_H : 0) + endClearance
      const top = HEAD_H + index * ROW_H
      const bottom = top + ROW_H
      if (top - HEAD_H < node.scrollTop) node.scrollTop = top - HEAD_H
      else if (bottom + foot > node.scrollTop + node.clientHeight) {
        node.scrollTop = bottom + foot - node.clientHeight
      }
    },
    [endClearance, hasFooter],
  )

  /* The pinned column needs a veil the moment content passes under it — without
     it the first column and the second read as one cell mid-scroll. */
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onScroll = () => setScrolled(node.scrollLeft > 0)
    const onSelectStart = (event: Event) => {
      if ((event.target as HTMLElement).closest('[data-grid-edit]')) return
      event.preventDefault()
    }
    const onClick = (event: Event) => {
      if (!suppressClickRef.current) return
      event.preventDefault()
      event.stopPropagation()
      suppressClickRef.current = false
    }
    onScroll()
    node.addEventListener('scroll', onScroll, { passive: true })
    node.addEventListener('selectstart', onSelectStart)
    node.addEventListener('click', onClick, true)
    return () => {
      node.removeEventListener('scroll', onScroll)
      node.removeEventListener('selectstart', onSelectStart)
      node.removeEventListener('click', onClick, true)
    }
  }, [])

  /* A cursor pointing at row 40 of a page that just became 12 rows long would put the
     ring on nothing and swallow every arrow key. */
  useLayoutEffect(() => {
    setCursor((current) => {
      if (!current) return null
      if (current.row < rows.length && current.col < columns.length) return current
      return null
    })
    setEditing(false)
  }, [rows.length, columns.length])

  /* Stepping with the arrow keys walks off the viewport long before it walks off the page,
     and a cursor you cannot see is a cursor you have lost. */
  useLayoutEffect(() => {
    if (cursor === null) return
    reveal(cursor.row)
  }, [cursor, reveal])

  /**
   * A new page starts at its top.
   *
   * Turning a page does not remount the grid, so the scroll position survives it — which
   * was survivable at fifty rows and is not at two hundred: "next" would hand somebody row
   * 120 of a page they have not seen the beginning of. The first row's key is what tells a
   * page turn, a re-sort or a new filter from the things that must *not* move the scroll —
   * a cell edited in place, or a background refresh of the page being read.
   *
   * When `scrollKey` is set, that key already changes with the page, and restore owns the
   * offset — including putting a remounted grid back where it was after closing a record.
   * Zeroing here would race that restore and dump the reader at the top anyway.
   */
  const firstKey = keys[0] ?? null
  const previousFirstKey = useRef(firstKey)
  useLayoutEffect(() => {
    if (previousFirstKey.current === firstKey) return
    previousFirstKey.current = firstKey
    /* The cell that was selected belongs to a record that is no longer here, and a ring
       left on its row number would be pointing at somebody else's record. */
    setCursor(null)
    setEditing(false)
    gestureRef.current = null
    if (scrollKey) return
    const node = scrollRef.current
    if (node) node.scrollTop = 0
  }, [firstKey, scrollKey])

  useScrollRestore(scrollKey, scrollRef, keys.length > 0)

  useLayoutEffect(() => {
    if (selected.size === 0) gestureRef.current = null
  }, [selected])

  const move = useCallback(
    (dRow: number, dCol: number) => {
      setCursor((current) => {
        const from = current ?? { row: 0, col: 0 }
        return {
          row: Math.min(rows.length - 1, Math.max(0, from.row + dRow)),
          col: Math.min(columns.length - 1, Math.max(0, from.col + dCol)),
        }
      })
    },
    [rows.length, columns.length],
  )

  const selectedHere = keys.filter((key) => selected.has(key)).length
  const allSelected = keys.length > 0 && selectedHere === keys.length

  const toggleAll = (next: boolean) => {
    gestureRef.current = null
    const set = new Set(selected)
    /* This page's keys only. A selection that survives paging is the difference between
       "edit these twelve" and "edit these twelve and whatever was ticked three pages ago". */
    for (const key of keys) {
      if (next) set.add(key)
      else set.delete(key)
    }
    onSelectedChange(set)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing) return
    /* Space on the complete checkbox is that control's own toggle. Left to bubble, it
       is the grid's "tick this row" shortcut and the task never completes. */
    if ((event.target as HTMLElement).closest('[data-row-accessory]')) return
    const active = cursor
    const column = active ? columns[active.col] : null
    const row = active ? rows[active.row] : undefined

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1, 0)
        return
      case 'ArrowUp':
        event.preventDefault()
        move(-1, 0)
        return
      case 'ArrowRight':
        event.preventDefault()
        move(0, 1)
        return
      case 'ArrowLeft':
        event.preventDefault()
        move(0, -1)
        return
      case 'Tab':
        if (!active) return
        event.preventDefault()
        move(0, event.shiftKey ? -1 : 1)
        return
      case 'Enter':
        if (!active || !column) return
        event.preventDefault()
        /* Enter on a column nobody may edit still means "show me this record" — the
           alternative is a key that silently does nothing on a third of the grid. */
        if (isEditable(column, row)) setEditing(true)
        else openRow(rows[active.row], active.row)
        return
      case 'Escape':
        setCursor(null)
        return
      case ' ':
        if (!active) return
        event.preventDefault()
        applyClick(active.row, event.shiftKey)
        return
      default:
        /* Typing over a selected cell replaces its contents, as every grid does. Only
           printable single characters, so Cmd-C and F5 stay themselves. */
        if (
          column &&
          isEditable(column, row) &&
          active &&
          event.key.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          setEditing(true)
        }
    }
  }

  const editApi = useMemo<GridEditApi>(
    () => ({
      close: () => {
        setEditing(false)
        scrollRef.current?.focus()
      },
      closeDown: () => {
        setEditing(false)
        move(1, 0)
        scrollRef.current?.focus()
      },
    }),
    [move],
  )

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
      <div
        ref={scrollRef}
        data-grid-scroll=""
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onBodyPointerDown}
        onClickCapture={onGridClickCapture}
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest('[data-grid-edit]')) return
          event.preventDefault()
        }}
        /* `group/grid` is what keeps the footer's calculation prompts hidden until the
           pointer is somewhere in the grid at all. No focus ring on the scroller itself —
           the cursor ring already says where the keyboard is, and a second ring around
           the whole grid says nothing. */
        className="group/grid relative min-h-0 flex-1 overflow-auto outline-none select-none"
        style={endClearance > 0 ? { scrollPaddingBottom: endClearance } : undefined}
      >
        <table
          className="min-w-full border-separate border-spacing-0 text-body font-medium select-none"
          style={{ tableLayout: 'fixed', width: tableWidth }}
        >
          <colgroup>
            {columns.map((column) => {
              const w = widthOf(column.id)
              return <col key={column.id} style={{ width: w, minWidth: w }} />
            })}
            {/* Trailing filler so short column sets still stripe the full width. */}
            <col />
          </colgroup>

          <thead>
            <tr>
              {columns.map((column, index) => (
                <HeaderCell
                  key={column.id}
                  column={column}
                  index={index}
                  pinned={index === 0}
                  pinnedShadow={index === 0 && scrolled}
                  width={widthOf(column.id)}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={onSort}
                  renderHeaderMenu={renderHeaderMenu}
                  onResize={onResize}
                  onReorder={onReorder}
                  headRefs={headRefs}
                  columns={columns}
                  labels={labels}
                  selectAll={
                    index === 0 ? (
                      <Checkbox
                        size="sm"
                        checked={allSelected ? true : selectedHere > 0 ? 'indeterminate' : false}
                        onChange={toggleAll}
                        ariaLabel={labels.selectAll}
                      />
                    ) : null
                  }
                  hasRowAccessory={index === 0 && Boolean(rowAccessory)}
                />
              ))}
              <th className="sticky top-0 z-20 border-b border-border-subtle bg-surface-subtle" />
            </tr>
          </thead>

          <tbody>
            {loading && rows.length === 0
              ? Array.from({ length: 10 }, (_, index) => (
                  <tr key={`skeleton-${index}`} style={{ height: ROW_H }}>
                    {columns.map((column, col) => (
                      <td
                        key={column.id}
                        className={cn(
                          'min-w-0 overflow-hidden border-b border-r border-border-subtle',
                          col === 0 ? cn('sticky left-0 z-10 bg-surface', PINNED_X) : 'px-3',
                          col === 0 && scrolled && 'pinned-veil',
                        )}
                        style={{ width: widthOf(column.id), maxWidth: widthOf(column.id) }}
                      >
                        <Skeleton className="h-3 w-full max-w-24" />
                      </td>
                    ))}
                    <td className="border-b border-border-subtle" />
                  </tr>
                ))
              : rows.map((row, rowIndex) => {
                  const key = keys[rowIndex]
                  return (
                    <GridRow
                      key={key}
                      row={row}
                      index={rowIndex}
                      columns={columns}
                      selected={selected.has(key)}
                      open={openRowKey === key}
                      cursorCol={cursor?.row === rowIndex ? cursor.col : null}
                      editing={cursor?.row === rowIndex && editing}
                      scrolled={scrolled}
                      widthOf={widthOf}
                      editApi={editApi}
                      labels={labels}
                      onSelectPointerDown={onSelectPointerDown}
                      onSelectKey={onSelectKey}
                      onOpen={openRow}
                      hrefOf={hrefOf}
                      onHover={hoverRow}
                      onPress={pressRow}
                      onFocusCell={focusCell}
                      rowAccessory={rowAccessory}
                    />
                  )
                })}
          </tbody>

          {hasFooter ? (
            <tfoot>
              <tr style={{ height: ROW_H }}>
                {columns.map((column, index) => (
                  <FooterCell
                    key={column.id}
                    column={column}
                    pinned={index === 0}
                    pinnedShadow={index === 0 && scrolled}
                    /* The primary column's footer is the row count. Everything a list is
                       for starts with how many things are in it. */
                    fixed={index === 0 ? labels.count(total ?? rows.length) : undefined}
                    kind={aggregation?.[column.id]}
                    value={aggregationValues?.[column.id]}
                    onChange={onAggregationChange}
                    labels={labels}
                  />
                ))}
                <th className="sticky bottom-0 z-20 border-t border-border-subtle bg-surface-subtle" />
              </tr>
            </tfoot>
          ) : null}
        </table>

        {!loading && rows.length === 0 && empty ? (
          <div className="flex items-center justify-center px-6 py-20">{empty}</div>
        ) : null}

        {/* After the table, not padding on this scroller. Padding would inset the sticky
            footer and slide it up over the rows as soon as the dock appears. */}
        {endClearance > 0 ? (
          <div aria-hidden style={{ height: endClearance, overflowAnchor: 'none' }} />
        ) : null}
      </div>
      {/* Over the sticky header and footer (20–30), under a cell being edited (40). */}
      <ScrollEdgeVeil show={edges.end} className="z-[35]" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

type GridRowProps<Row> = {
  row: Row
  index: number
  columns: GridColumn<Row>[]
  selected: boolean
  open: boolean
  /** Which cell in *this* row holds the cursor, or null when the cursor is elsewhere. */
  cursorCol: number | null
  editing: boolean
  scrolled: boolean
  widthOf: (id: string) => number
  editApi: GridEditApi
  labels: GridLabels
  onSelectPointerDown: (index: number, shiftKey: boolean) => void
  onSelectKey: (index: number, shiftKey: boolean) => void
  onOpen: (row: Row, index: number) => void
  hrefOf: (row: Row) => string | undefined
  onHover: (row: Row, index: number) => void
  onPress: (row: Row, index: number) => void
  onFocusCell: (row: number, col: number, edit: boolean) => void
  rowAccessory?: (row: Row) => ReactNode
}

/**
 * One row, drawn only when something about it changed.
 *
 * A cell is not cheap — a stage is a coloured chip resolved against the pipeline, an owner
 * is an avatar resolved against the directory — and a page holds fifty rows of them. Left
 * unmemoised, moving the cursor one cell rebuilds all four hundred, which is most of why
 * the grid felt heavy under a pointer. `cursorCol` is passed as a number rather than the
 * whole cursor so that only the row losing it and the row gaining it redraw.
 */
function GridRowInner<Row>({
  row,
  index,
  columns,
  selected,
  open,
  cursorCol,
  editing,
  scrolled,
  widthOf,
  editApi,
  labels,
  onSelectPointerDown,
  onSelectKey,
  onOpen,
  hrefOf,
  onHover,
  onPress,
  onFocusCell,
  rowAccessory,
}: GridRowProps<Row>) {
  const marked = selected || open

  return (
    <tr
      className={cn('group/row', marked ? 'is-marked' : null)}
      style={{ height: ROW_H }}
      onMouseEnter={() => onHover(row, index)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        onPress(row, index)
      }}
    >
      {columns.map((column, colIndex) => {
        const active = cursorCol === colIndex
        const canEdit = isEditable(column, row)
        const isEditing = active && editing && canEdit

        return (
          <td
            key={column.id}
            onMouseDown={() => onFocusCell(index, colIndex, canEdit)}
            className={cn(
              'relative min-w-0 border-b border-r border-border-subtle align-middle',
              'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
              colIndex === 0
                ? cn('sticky left-0 z-10', PINNED_X, scrolled && 'pinned-veil')
                : 'px-3',
              column.align === 'right' && 'text-right',
              /* Opaque fills, always: the pinned column has live content sliding under
                 it, and a translucent wash would show it. */
              marked ? 'bg-info-50' : 'bg-surface group-hover/row:bg-fill-hover',
              active && 'z-30 outline-2 -outline-offset-2 outline-info-500',
              /* Clip while reading so a long name cannot stretch the column; drop the
                 clip while editing so a wider overlay (a picker, a textarea) can escape. */
              isEditing ? 'overflow-visible' : 'overflow-hidden',
            )}
            style={{ width: widthOf(column.id), maxWidth: widthOf(column.id) }}
          >
            {colIndex === 0 ? (
              <PrimaryCell
                column={column}
                row={row}
                index={index}
                selected={selected}
                onSelectPointerDown={(shiftKey) => onSelectPointerDown(index, shiftKey)}
                onSelectKey={() => onSelectKey(index, false)}
                onOpen={() => onOpen(row, index)}
                href={hrefOf(row)}
                labels={labels}
                accessory={rowAccessory?.(row)}
              />
            ) : (
              <div className="min-w-0 truncate">{column.cell(row)}</div>
            )}

            {isEditing ? (
              <div
                data-grid-edit
                className={cn(
                  'absolute -top-px -left-px z-40 rounded-md select-text',
                  column.editClassName ??
                    'border-2 border-info-500 bg-surface shadow-(--shadow-overlay)',
                )}
                style={{ minWidth: widthOf(column.id) + 2, width: column.editWidth }}
              >
                {column.edit?.(row, editApi)}
              </div>
            ) : null}
          </td>
        )
      })}
      <td
        className={cn(
          'border-b border-border-subtle',
          marked ? 'bg-info-50' : 'bg-surface group-hover/row:bg-fill-hover',
        )}
      />
    </tr>
  )
}

/* `memo` erases the generic, so the original signature is put back on the way out. */
const GridRow = memo(GridRowInner) as typeof GridRowInner

/**
 * Wall around a primary-cell control that is not the row's selection checkbox.
 *
 * Same isolation as `[data-row-select]`: the pointer must not start a range, the click
 * must not open the record, and a key must not edit the cell. `pointerdown` is not
 * cancelled — cancelling it suppresses the click the control inside commits with. The
 * selection checkbox cancels it only because that gesture is applied on pointerdown, so
 * a drag can paint a range.
 */
function RowAccessorySlot({ children }: { children: ReactNode }) {
  return (
    <span
      data-row-accessory
      className="flex shrink-0 touch-none items-center"
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
      }}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Primary column
// ---------------------------------------------------------------------------

/**
 * The record's own cell: its mark, its name, and the way in.
 *
 * The checkbox sits to the left of the mark and appears on hover, rather than replacing
 * it. A company is recognised by its logo; swapping that for a tick is how a row stops
 * looking like the record you were about to open. Space is reserved so the name does
 * not jump when the box appears. `accessory` is a second control between the two — a
 * task's complete checkbox — and stays visible, because it is the row's state, not a
 * way to select it.
 */
function PrimaryCell<Row>({
  column,
  row,
  index,
  selected,
  onSelectPointerDown,
  onSelectKey,
  onOpen,
  href,
  labels,
  accessory,
}: {
  column: GridColumn<Row>
  row: Row
  index: number
  selected: boolean
  onSelectPointerDown: (shiftKey: boolean) => void
  onSelectKey: () => void
  onOpen: () => void
  href?: string
  labels: GridLabels
  accessory?: ReactNode
}) {
  const mark = column.leading?.(row)
  const label = column.cell(row)
  const nameClass = cn(
    'min-w-0 w-full truncate rounded-xs text-left text-text outline-none',
    'hover:underline underline-offset-2',
  )
  /* A hover card already names the record; a native `title` would fire at ~1s and sit
     on top of the peek. Activities have no card, so a truncated name still gets one. */
  const title = column.wrapName || typeof label !== 'string' ? undefined : label
  const onNameClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (isModifiedClick(event)) return
    event.preventDefault()
    onOpen()
  }
  const name = href ? (
    <a href={href} onClick={onNameClick} title={title} className={nameClass}>
      {label}
    </a>
  ) : (
    <button type="button" onClick={onOpen} title={title} className={nameClass}>
      {label}
    </button>
  )
  const openClass = cn(
    'flex size-5 shrink-0 items-center justify-center rounded-sm text-icon-muted',
    'opacity-0 transition-opacity duration-(--duration-quick) ease-(--ease-smooth-out)',
    'hover:bg-fill-muted hover:text-ink-900 group-hover/row:opacity-100',
    'focus-visible:opacity-100',
  )
  /* Mark sits inside the wrap so a hover card's trigger starts at the avatar, not
     the text. The checkbox stays outside — ticking a row is not inspecting it. */
  const identity = (
    <div className="flex min-w-0 w-full items-center gap-2 overflow-hidden">
      {mark ? (
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          {mark}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 overflow-hidden">{name}</div>
    </div>
  )
  const checkVisible = !mark || selected

  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
      <span
        data-row-select
        className="flex shrink-0 touch-none items-center"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          /* Own the pointer so the checkbox button does not also fire `onChange` and
             undo the range this gesture just painted. Keyboard still uses `onChange`. */
          event.preventDefault()
          event.stopPropagation()
          onSelectPointerDown(event.shiftKey)
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <span
          className={
            checkVisible
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100'
          }
        >
          <Checkbox
            size="sm"
            checked={selected}
            onChange={onSelectKey}
            ariaLabel={labels.selectRow}
          />
        </span>
      </span>

      {accessory ? <RowAccessorySlot>{accessory}</RowAccessorySlot> : null}

      <div className="min-w-0 flex-1 overflow-hidden">
        {column.wrapName ? column.wrapName(row, identity) : identity}
      </div>

      {href ? (
        <a
          href={href}
          onClick={onNameClick}
          aria-label={labels.openRecord}
          title={labels.openRecord}
          className={openClass}
          data-row={index}
        >
          <Expand className="size-3" strokeWidth={iconStroke} />
        </a>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={labels.openRecord}
          title={labels.openRecord}
          className={openClass}
          data-row={index}
        >
          <Expand className="size-3" strokeWidth={iconStroke} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function HeaderCell<Row>({
  column,
  index,
  pinned,
  pinnedShadow,
  width,
  sortBy,
  sortDir,
  onSort,
  renderHeaderMenu,
  onResize,
  onReorder,
  headRefs,
  columns,
  labels,
  selectAll,
  hasRowAccessory,
}: {
  column: GridColumn<Row>
  index: number
  pinned: boolean
  pinnedShadow: boolean
  width: number
  sortBy?: string | null
  sortDir: SortDir
  onSort?: (columnId: string, dir: SortDir) => void
  renderHeaderMenu?: (args: {
    column: GridColumn<Row>
    index: number
    close: () => void
  }) => ReactNode
  onResize: (columnId: string, width: number) => void
  onReorder?: (columnId: string, toIndex: number) => void
  headRefs: { current: Map<string, HTMLTableCellElement> }
  columns: GridColumn<Row>[]
  labels: GridLabels
  selectAll: ReactNode
  /** Keeps the column title over the mark once a row accessory takes a slot. */
  hasRowAccessory?: boolean
}) {
  const active = sortBy === column.id
  const Icon = column.icon
  const [drag, setDrag] = useState<{ dx: number; target: number } | null>(null)
  const [resizing, setResizing] = useState(false)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)

  /* The pinned column is the record's name and the anchor everything else is read
     against; letting it be dragged into the middle of the table loses that anchor. */
  const draggable = Boolean(onReorder) && !pinned

  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    resizeRef.current = { startX: event.clientX, startW: width }
    setResizing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const onResizeMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const state = resizeRef.current
    if (!state) return
    onResize(column.id, clampWidth(state.startW + (event.clientX - state.startX)))
  }

  const endResize = () => {
    if (!resizeRef.current) return
    resizeRef.current = null
    setResizing(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggable) return
    const startX = event.clientX
    let moved = false

    const boundaries = columns.map((c) => {
      const rect = headRefs.current.get(c.id)?.getBoundingClientRect()
      return rect ? rect.left + rect.width / 2 : 0
    })

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - startX
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD) return
      moved = true
      /* Land where the pointer is, never at index 0 — that slot belongs to the name. */
      let next = 1
      for (let i = 1; i < boundaries.length; i += 1) {
        if (move.clientX > boundaries[i]) next = i
      }
      setDrag({ dx, target: next })
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDrag((current) => {
        if (current && current.target !== index) onReorder?.(column.id, current.target)
        return null
      })
      /* A press that never travelled is a sort, and the click handler will see it. */
      if (moved) {
        const swallow = (click: MouseEvent) => {
          click.stopPropagation()
          click.preventDefault()
        }
        window.addEventListener('click', swallow, { capture: true, once: true })
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const nextDir: SortDir = active && sortDir === 'desc' ? 'asc' : 'desc'
  const dragTargetSide =
    drag && drag.target !== index ? (drag.target > index ? 'right' : 'left') : null
  const menu = useMenuOpen()
  const hasMenu = Boolean(renderHeaderMenu)

  const sortHint = column.sortable
    ? nextDir === 'asc'
      ? labels.sortAscending
      : labels.sortDescending
    : column.header

  const headerButton = (
    <button
      type="button"
      onPointerDown={startDrag}
      onClick={
        hasMenu
          ? menu.toggle
          : column.sortable && onSort
            ? () => onSort(column.id, nextDir)
            : undefined
      }
      title={hasMenu ? labels.columnOptions : sortHint}
      aria-haspopup={hasMenu ? 'menu' : undefined}
      aria-expanded={hasMenu ? menu.open : undefined}
      className={cn(
        'flex min-w-0 w-full flex-1 items-center gap-1.5 rounded-xs text-left outline-none',
        column.align === 'right' && 'flex-row-reverse',
        draggable && 'cursor-grab active:cursor-grabbing',
        menu.open && !active && 'text-ink-900',
      )}
    >
      {Icon ? (
        <Icon
          className={cn('size-3.5 shrink-0', active ? 'text-info-500' : 'text-icon-muted')}
          strokeWidth={iconStroke}
        />
      ) : null}
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          active ? 'text-info-700' : menu.open && 'text-ink-900',
        )}
      >
        {column.header}
      </span>
      {column.sortable && onSort ? (
        active ? (
          sortDir === 'asc' ? (
            <ChevronUp className="size-3 shrink-0 text-info-500" strokeWidth={2} />
          ) : (
            <ChevronDown className="size-3 shrink-0 text-info-500" strokeWidth={2} />
          )
        ) : (
          /* Always drawn, not hover-revealed. It is the only thing telling somebody a
             column can be sorted at all, and a hint you have to find by accident is not
             a hint. Muted enough that forty of them do not read as content. */
          <ChevronsUpDown
            className={cn(
              'size-3 shrink-0 text-icon-muted/60',
              'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
              'group-hover/head:text-icon',
            )}
            strokeWidth={2}
          />
        )
      ) : null}
    </button>
  )

  return (
    <th
      ref={(node) => {
        if (node) headRefs.current.set(column.id, node)
        else headRefs.current.delete(column.id)
      }}
      scope="col"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn(
        'group/head sticky top-0 z-20 h-9 min-w-0 border-b border-r border-border-subtle',
        'text-left font-normal',
        /* A sort whose only signal is a 12px chevron is a sort you miss on a forty-column
           grid. The wash and the contour are the same info tokens a selected row already
           uses, so the header is marked without inventing a third blue. */
        active
          ? 'bg-info-50 text-info-700 outline outline-1 -outline-offset-1 outline-info-500'
          : 'bg-surface-subtle text-text-secondary',
        pinned ? cn('left-0 z-30', PINNED_X) : 'px-3',
        pinnedShadow && 'pinned-veil',
        (drag || resizing) && 'z-40',
      )}
      style={{
        width,
        maxWidth: width,
        /* Left columns sit above the next header so the 8px handle that straddles the
           border stays grabbable instead of being covered by the neighbour. */
        zIndex: drag || resizing ? 40 : pinned ? undefined : 21 + (columns.length - index),
        /* Inset rather than a floating element: a drop line drawn as a sibling would need
           a positioned ancestor, and a table header has none to give. */
        boxShadow:
          dragTargetSide === 'left'
            ? 'inset 2px 0 0 0 var(--color-ink-900)'
            : dragTargetSide === 'right'
              ? 'inset -2px 0 0 0 var(--color-ink-900)'
              : undefined,
      }}
    >
      <div
        className={cn(
          'flex min-w-0 items-center overflow-hidden',
          /* The row is `gap-2`. Match it once an accessory sits in that row, so the
             title stays over the mark. */
          hasRowAccessory ? 'gap-2' : 'gap-1.5',
        )}
        style={drag ? { transform: `translateX(${drag.dx}px)` } : undefined}
      >
        {pinned ? <span className="shrink-0">{selectAll}</span> : null}
        {hasRowAccessory ? <span className="size-4 shrink-0" aria-hidden /> : null}

        {hasMenu && renderHeaderMenu ? (
          <GlassMenu
            open={menu.open}
            onOpenChange={menu.setOpen}
            placement="bottom-start"
            panelClassName="w-52"
            className="min-w-0 w-full flex-1"
            fitTrigger={false}
            trigger={headerButton}
          >
            {renderHeaderMenu({ column, index, close: menu.close })}
          </GlassMenu>
        ) : (
          headerButton
        )}
      </div>

      <span
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => onResize(column.id, DEFAULT_W)}
        className={cn(
          'absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none',
          'after:absolute after:top-0 after:left-1/2 after:h-full after:w-px',
          'after:bg-ink-900 after:opacity-0',
          'after:transition-opacity after:duration-(--duration-quick) after:ease-(--ease-smooth-out)',
          'hover:after:opacity-100',
          resizing && 'after:opacity-100',
        )}
      />
    </th>
  )
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

/**
 * One column's footer cell.
 *
 * Empty until asked, because a footer that guesses is a footer full of numbers nobody
 * requested. Once a column has an aggregation it keeps it, so a list that is really "how
 * much is in play this quarter" opens with that total already under the column.
 */
function FooterCell<Row>({
  column,
  pinned,
  pinnedShadow,
  fixed,
  kind,
  value,
  onChange,
  labels,
}: {
  column: GridColumn<Row>
  pinned: boolean
  pinnedShadow: boolean
  fixed?: string
  kind?: GridAggregation
  value?: string | null
  onChange?: (columnId: string, kind: GridAggregation | null) => void
  labels: GridLabels
}) {
  const menu = useMenuOpen()
  const options = column.aggregations ?? []

  return (
    <th
      className={cn(
        'sticky bottom-0 z-20 h-9 min-w-0 overflow-hidden border-t border-r border-border-subtle',
        'bg-surface-subtle text-right font-normal',
        pinned ? cn('left-0 z-30', PINNED_X) : 'px-3',
        pinnedShadow && 'pinned-veil',
      )}
    >
      {fixed ? (
        <span className="text-label tabular-nums text-text-secondary">{fixed}</span>
      ) : options.length === 0 || !onChange ? null : (
        <GlassMenu
          open={menu.open}
          onOpenChange={menu.setOpen}
          placement="top-end"
          panelClassName="w-48"
          /* The cell's width, not the label's: `w-fit` let the trigger grow to its text
             and wrap or spill past the cell, so the label had nothing to truncate against. */
          className="w-full min-w-0"
          trigger={
            <button
              type="button"
              onClick={menu.toggle}
              className={cn(
                /* One line, always. The row is 36px like every other; a label that wrapped
                   in a narrow column made the footer the tallest row on the grid, and one
                   that overflowed a pinned cell was clipped at its start ("dd / lation"). */
                'flex h-6 w-full min-w-0 items-center justify-end gap-1 whitespace-nowrap rounded-sm text-label',
                'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
                'hover:text-ink-900',
                kind ? 'text-ink-900' : 'text-text-tertiary opacity-0 group-hover/grid:opacity-100',
              )}
            >
              {kind ? (
                <>
                  <span className="min-w-0 truncate text-text-tertiary">{labels.aggregation(kind)}</span>
                  <span className="shrink-0 tabular-nums font-medium">
                    {value === null || value === undefined ? '…' : value}
                  </span>
                </>
              ) : (
                <>
                  <Plus className="size-3 shrink-0" strokeWidth={iconStroke} />
                  <span className="min-w-0 truncate">{labels.addCalculation}</span>
                </>
              )}
            </button>
          }
        >
          <MenuLabel>{labels.aggregations}</MenuLabel>
          {options.map((option) => (
            <MenuItem
              key={option}
              checked={kind === option}
              onClick={() => {
                onChange(column.id, kind === option ? null : option)
                menu.close()
              }}
            >
              {aggregationMenuLabel(option, labels.aggregation(option))}
            </MenuItem>
          ))}
        </GlassMenu>
      )}
    </th>
  )
}

/**
 * Menu copy for a calculation. Percent kinds share Empty/Filled with the counts, so the
 * sign is how the picker tells them apart. The footer keeps the short word: the value
 * already carries `%`.
 */
export function aggregationMenuLabel(kind: GridAggregation, label: string): string {
  return kind === 'percent_empty' || kind === 'percent_filled' ? `${label} %` : label
}

/**
 * Which aggregations make sense for a field type.
 *
 * Kept next to the grid rather than in the CRM so any future table gets the same answer:
 * a sum of a select column is nonsense, and offering it is how a footer ends up showing
 * `NaN` to somebody who was only curious.
 */
export function aggregationsForType(
  type:
    | 'text'
    | 'number'
    | 'currency'
    | 'date'
    | 'select'
    | 'boolean'
    | 'reference',
): GridAggregation[] {
  const fill: GridAggregation[] = ['count_empty', 'count_filled', 'percent_empty', 'percent_filled']
  switch (type) {
    case 'number':
    case 'currency':
      return ['sum', 'avg', 'min', 'max', ...fill]
    case 'date':
      return ['min', 'max', ...fill]
    case 'select':
    case 'boolean':
    case 'reference':
      return ['count_unique', ...fill]
    default:
      return ['count_unique', ...fill]
  }
}
