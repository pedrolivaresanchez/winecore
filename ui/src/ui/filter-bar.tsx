import { Fragment, useState, type ReactNode } from 'react'
import { Calendar, ChevronDown, Plus, Search, X, type IconComponent } from './icons'
import { Chip, ChipDivider } from './toolbar-chip'
import { GlassMenu } from './glass-menu'
import { MenuEmpty, MenuItem, MenuScroll, MenuSearch, MenuSeparator } from './menu'
import { Input } from './input'
import { STATUS_TAG_TONE, StatusPill } from './status-pill'
import { tagToneClass } from './tag-palette'
import { DateRangeMenu, dateRangeSummary, type DateRangeValue } from './grid-auto'
import { useGridFilters, type GridFilterLink } from './grid-filter-link'
import { SelectionBar, type SelectionBarProps } from './selection-bar'
import { FRAME_STRIP_SCROLL, LIST_BAR } from './frame'
import { useUiLabels } from './ui-labels'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'
import type { StatusTone } from '../lib/status-tones'

export type { DateRangeValue }

export type FilterOption = {
  value: string
  label: string
  /** Drawn as the status chip it filters by, so the menu and the column agree on colour. */
  tone?: StatusTone
  count?: number
}

type FilterBase = {
  id: string
  label: string
  icon?: IconComponent
  /** Kept behind «+ Filtro» until somebody adds it or it holds a value. */
  optional?: boolean
}

/**
 * A filter, declared as data.
 *
 * `toggle` is one chip that is on or off (Archivados). `single` and `multi` pick from options:
 * as a row of quick chips (`display: 'chips'`) when there are few and they are the main cut,
 * or as one chip that opens a checkable menu (`'menu'`, the default) when there are many. `date`
 * is a day range from presets or a calendar.
 */
export type FilterDef =
  | (FilterBase & { kind: 'toggle'; count?: number })
  | (FilterBase & { kind: 'single'; options: FilterOption[]; display?: 'chips' | 'menu' })
  | (FilterBase & { kind: 'multi'; options: FilterOption[]; display?: 'chips' | 'menu' })
  | (FilterBase & { kind: 'date' })

/** `toggle` → boolean, `single` → string, `multi` → string[], `date` → a range. Empty is null. */
export type FilterValue = boolean | string | string[] | DateRangeValue | null | undefined
export type FilterValues = Record<string, FilterValue>

export function isFilterActive(value: FilterValue): boolean {
  if (value == null || value === false || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

export type FilterBarProps = {
  search?: { value: string; onChange: (value: string) => void; placeholder?: string; id?: string }
  filters?: FilterDef[]
  values?: FilterValues
  onChange?: (id: string, value: FilterValue) => void
  /**
   * Empties everything the page owns — search included — in one write. Pass it when the
   * filters live in the URL: one `setParams` per filter would each start from the same stale
   * params and only the last would land. Without it the bar clears them one by one.
   */
  onClear?: () => void
  /** The grid's column conditions (`useGridFilterLink`), drawn here as chips. */
  grid?: GridFilterLink
  /** While rows are ticked, the bar hands its row to their actions. */
  selection?: SelectionBarProps
  /** Before the search: an object switcher on a phone. */
  leading?: ReactNode
  /** After the chips: Columnas, the view's own controls. */
  trailing?: ReactNode
  className?: string
}

/**
 * The cut of a list, in one row over the grid.
 *
 * Search, then the page's filters as chips, then whatever the column menus set, then «+ Filtro»
 * for the rest and «Limpiar» once anything is on. A chip with nothing in it is dashed; one that
 * holds a value wears the face and names it, in the value's own colour when it is a state. The
 * row scrolls sideways on a phone rather than wrapping into a second strip of chrome.
 */
export function FilterBar({ selection, ...props }: FilterBarProps) {
  if (selection && selection.count > 0) return <SelectionBar {...selection} className={props.className} />
  return <FilterRow {...props} />
}

const ADD = '\u0000add'
const columnMenu = (id: string) => `\u0000column:${id}`

function FilterRow({ search, filters = [], values = {}, onChange, onClear, grid, leading, trailing, className }: Omit<FilterBarProps, 'selection'>) {
  const labels = useUiLabels().lists.filters
  const columns = useGridFilters(grid)
  const [openId, setOpenId] = useState<string | null>(null)
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())
  const [pendingColumn, setPendingColumn] = useState<string | null>(null)

  const visible = filters.filter((def) => !def.optional || added.has(def.id) || isFilterActive(values[def.id]))
  const tucked = filters.filter((def) => def.optional && !visible.includes(def))
  const activeColumns = new Set(columns.active.map((entry) => entry.id))
  const columnIds = [...columns.active.map((entry) => entry.id), ...(pendingColumn && !activeColumns.has(pendingColumn) ? [pendingColumn] : [])]
  const addableColumns = columns.available.filter((column) => !columnIds.includes(column.id))
  const anyActive =
    Boolean(search?.value.trim()) || filters.some((def) => isFilterActive(values[def.id])) || columns.active.length > 0

  const menuState = (id: string) => ({
    open: openId === id,
    onOpenChange: (open: boolean) => setOpenId(open ? id : null),
    close: () => setOpenId(null),
    toggle: () => setOpenId((current) => (current === id ? null : id)),
  })

  function clearAll() {
    if (onClear) onClear()
    else {
      if (search?.value) search.onChange('')
      for (const def of filters) if (isFilterActive(values[def.id])) onChange?.(def.id, null)
    }
    grid?.clear()
    setAdded(new Set())
    setPendingColumn(null)
    setOpenId(null)
  }

  return (
    <div role="toolbar" data-filter-bar="" className={cn(LIST_BAR, className)}>
      {leading}
      {search ? (
        <Input
          id={search.id}
          size="sm"
          type="search"
          value={search.value}
          placeholder={search.placeholder ?? labels.search}
          aria-label={search.placeholder ?? labels.search}
          className="w-36 shrink-0 sm:w-56"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          onChange={(event) => search.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search.value) {
              event.stopPropagation()
              search.onChange('')
            }
          }}
        />
      ) : null}
      <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
        {visible.map((def, index) => {
          const quickRow = (def.kind === 'single' || def.kind === 'multi') && def.display === 'chips'
          const divide = quickRow && index < visible.length - 1
          return (
            <Fragment key={def.id}>
              <FilterControl
                def={def}
                value={values[def.id]}
                onChange={(value) => onChange?.(def.id, value)}
                menu={menuState(def.id)}
              />
              {divide ? <ChipDivider /> : null}
            </Fragment>
          )
        })}
        {visible.length > 0 && columnIds.length > 0 ? <ChipDivider /> : null}
        {columnIds.map((id) => {
          const entry = columns.active.find((item) => item.id === id)
          const label = entry?.label ?? columns.available.find((item) => item.id === id)?.label ?? id
          const menu = menuState(columnMenu(id))
          return (
            <GlassMenu
              key={columnMenu(id)}
              open={menu.open}
              onOpenChange={(open) => {
                menu.onOpenChange(open)
                if (!open && pendingColumn === id) setPendingColumn(null)
              }}
              placement="bottom-start"
              panelClassName="w-64"
              fitTrigger={false}
              trigger={
                entry ? (
                  <Chip
                    data-filter-chip={`column:${id}`}
                    label={label}
                    onClick={menu.toggle}
                    onClear={() => grid?.remove(id)}
                    active={menu.open}
                    title={labels.pageOnly}
                    className="max-w-72"
                  >
                    {entry.summary}
                  </Chip>
                ) : (
                  <Chip data-filter-chip={`column:${id}`} variant="dashed" onClick={menu.toggle} active={menu.open} trailing={<Chevron />}>
                    {label}
                  </Chip>
                )
              }
            >
              {menu.open ? grid?.menu(id, menu.close) : null}
            </GlassMenu>
          )
        })}
        {tucked.length > 0 || addableColumns.length > 0 ? (
          <AddFilter
            tucked={tucked}
            columns={addableColumns}
            menu={menuState(ADD)}
            compact={anyActive || visible.length > 0}
            onPick={(id, column) => {
              if (column) setPendingColumn(id)
              else setAdded((current) => new Set(current).add(id))
              setOpenId(column ? columnMenu(id) : id)
            }}
          />
        ) : null}
        {anyActive ? (
          <button
            type="button"
            data-filter-clear=""
            onClick={clearAll}
            className={cn(
              'flex h-7 items-center gap-1 rounded-[7px] px-2 text-label text-text-secondary outline-none',
              'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
              'hover:bg-fill-hover hover:text-ink-900 focus-visible:shadow-(--shadow-focus)',
            )}
          >
            <X className="size-3" strokeWidth={2} />
            {labels.clear}
          </button>
        ) : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
    </div>
  )
}

type MenuState = { open: boolean; onOpenChange: (open: boolean) => void; close: () => void; toggle: () => void }

function Chevron() {
  return <ChevronDown className="size-3 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
}

function ToneDot({ tone }: { tone: StatusTone }) {
  return <span aria-hidden className={cn('tag-dot size-1.5 shrink-0 rounded-full', tagToneClass(STATUS_TAG_TONE[tone]))} />
}

function Count({ value }: { value: number | undefined }) {
  if (value == null) return null
  return <span className="ml-1 font-normal tabular-nums text-text-tertiary">{value.toLocaleString('es')}</span>
}

function FilterControl({
  def,
  value,
  onChange,
  menu,
}: {
  def: FilterDef
  value: FilterValue
  onChange: (value: FilterValue) => void
  menu: MenuState
}) {
  const labels = useUiLabels()

  if (def.kind === 'toggle') {
    const on = value === true
    return (
      <Chip data-filter-chip={def.id} icon={def.icon} selected={on} pressed={on} onClick={() => onChange(on ? null : true)}>
        {def.label}
        <Count value={def.count} />
      </Chip>
    )
  }

  if (def.kind === 'date') {
    const range = value && typeof value === 'object' && !Array.isArray(value) ? value : null
    return (
      <GlassMenu
        open={menu.open}
        onOpenChange={menu.onOpenChange}
        placement="bottom-start"
        panelClassName="w-64"
        fitTrigger={false}
        trigger={
          range ? (
            <Chip
              data-filter-chip={def.id}
              icon={def.icon ?? Calendar}
              label={def.label}
              onClick={menu.toggle}
              onClear={() => onChange(null)}
              active={menu.open}
              title={labels.lists.filters.remove}
            >
              {dateRangeSummary(range, labels.grid)}
            </Chip>
          ) : (
            <Chip data-filter-chip={def.id} icon={def.icon ?? Calendar} variant="dashed" onClick={menu.toggle} active={menu.open} trailing={<Chevron />}>
              {def.label}
            </Chip>
          )
        }
      >
        <DateRangeMenu value={range} onChange={onChange} close={menu.close} />
      </GlassMenu>
    )
  }

  const picked: string[] = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []
  const pick = (option: string) => {
    if (def.kind === 'single') onChange(picked[0] === option ? null : option)
    else onChange(picked.includes(option) ? picked.filter((item) => item !== option) : [...picked, option])
  }

  if (def.display === 'chips') {
    return (
      <span data-filter-chip={def.id} role="group" aria-label={def.label} className="flex shrink-0 items-center gap-1.5">
        {def.options.map((option) => {
          const on = picked.includes(option.value)
          return (
            <Chip key={option.value} selected={on} pressed={on} onClick={() => pick(option.value)}>
              <span className="inline-flex items-center gap-1.5">
                {option.tone ? <ToneDot tone={option.tone} /> : null}
                {option.label}
              </span>
              <Count value={option.count} />
            </Chip>
          )
        })}
      </span>
    )
  }

  return <OptionMenu def={def} picked={picked} onPick={pick} onClear={() => onChange(null)} menu={menu} />
}

const SEARCH_FROM = 8

function OptionMenu({
  def,
  picked,
  onPick,
  onClear,
  menu,
}: {
  def: Extract<FilterDef, { kind: 'single' | 'multi' }>
  picked: string[]
  onPick: (value: string) => void
  onClear: () => void
  menu: MenuState
}) {
  const labels = useUiLabels().lists.filters
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const shown = term ? def.options.filter((option) => option.label.toLowerCase().includes(term)) : def.options
  const chosen = picked.map((value) => def.options.find((option) => option.value === value) ?? { value, label: value })

  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={(open) => {
        menu.onOpenChange(open)
        if (!open) setQ('')
      }}
      placement="bottom-start"
      panelClassName="w-60"
      fitTrigger={false}
      trigger={
        chosen.length > 0 ? (
          <Chip
            data-filter-chip={def.id}
            icon={def.icon}
            label={def.label}
            onClick={menu.toggle}
            onClear={onClear}
            active={menu.open}
            title={labels.remove}
            className="max-w-80"
          >
            <span className="inline-flex min-w-0 items-center gap-1">
              {chosen.slice(0, 2).map((option) =>
                option.tone ? (
                  <StatusPill key={option.value} tone={option.tone} className="max-w-32">
                    <span className="truncate">{option.label}</span>
                  </StatusPill>
                ) : (
                  <span key={option.value} className="truncate">
                    {option.label}
                  </span>
                ),
              )}
              {chosen.length > 2 ? <span className="font-normal tabular-nums text-text-tertiary">+{chosen.length - 2}</span> : null}
            </span>
          </Chip>
        ) : (
          <Chip data-filter-chip={def.id} icon={def.icon} variant="dashed" onClick={menu.toggle} active={menu.open} trailing={<Chevron />}>
            {def.label}
          </Chip>
        )
      }
    >
      {def.options.length > SEARCH_FROM ? <MenuSearch value={q} onChange={setQ} placeholder={labels.searchOptions} /> : null}
      <MenuScroll>
        {shown.map((option) => (
          <MenuItem
            key={option.value}
            checked={picked.includes(option.value)}
            radio={def.kind === 'single'}
            trailing={option.count != null ? option.count.toLocaleString('es') : undefined}
            onClick={() => {
              onPick(option.value)
              if (def.kind === 'single') menu.close()
            }}
          >
            {option.tone ? (
              <StatusPill tone={option.tone} className="max-w-full">
                <span className="truncate">{option.label}</span>
              </StatusPill>
            ) : (
              option.label
            )}
          </MenuItem>
        ))}
        {shown.length === 0 ? <MenuEmpty>{labels.noOptions}</MenuEmpty> : null}
      </MenuScroll>
      {chosen.length > 0 ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<X className="size-3.5" strokeWidth={iconStroke} />}
            onClick={() => {
              onClear()
              menu.close()
            }}
          >
            {labels.remove}
          </MenuItem>
        </>
      ) : null}
    </GlassMenu>
  )
}

function AddFilter({
  tucked,
  columns,
  menu,
  compact,
  onPick,
}: {
  tucked: FilterDef[]
  columns: { id: string; label: string }[]
  menu: MenuState
  compact: boolean
  onPick: (id: string, column: boolean) => void
}) {
  const labels = useUiLabels().lists.filters
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const match = (label: string) => !term || label.toLowerCase().includes(term)
  const own = tucked.filter((def) => match(def.label))
  const fromGrid = columns.filter((column) => match(column.label))

  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={(open) => {
        menu.onOpenChange(open)
        if (!open) setQ('')
      }}
      placement="bottom-start"
      panelClassName="w-56"
      fitTrigger={false}
      trigger={
        <Chip
          data-filter-chip="add"
          icon={Plus}
          variant="dashed"
          onClick={menu.toggle}
          active={menu.open}
          title={labels.addTitle}
        >
          {compact ? undefined : labels.add}
        </Chip>
      }
    >
      {tucked.length + columns.length > SEARCH_FROM ? <MenuSearch value={q} onChange={setQ} placeholder={labels.searchOptions} /> : null}
      <MenuScroll>
        {own.map((def) => {
          const Icon = def.icon
          return (
            <MenuItem key={def.id} icon={Icon ? <Icon className="size-3.5" strokeWidth={iconStroke} /> : undefined} onClick={() => onPick(def.id, false)}>
              {def.label}
            </MenuItem>
          )
        })}
        {own.length > 0 && fromGrid.length > 0 ? <MenuSeparator /> : null}
        {fromGrid.map((column) => (
          <MenuItem key={column.id} onClick={() => onPick(column.id, true)}>
            {column.label}
          </MenuItem>
        ))}
        {own.length + fromGrid.length === 0 ? <MenuEmpty>{labels.noOptions}</MenuEmpty> : null}
      </MenuScroll>
    </GlassMenu>
  )
}