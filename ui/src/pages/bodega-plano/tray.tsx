import type { PointerEvent as ReactPointerEvent } from 'react'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { Button, Input, Select } from '@/ui'
import { Search } from '@/ui/icons'
import type { LooseItem } from '@/pages/bodega-plano/types'

const FILTERS = ['all', 'tank_storage', 'tank_fermenter', 'barrel', 'demijohn', 'ibc', 'other', 'jaulon', 'nicho'] as const

export type TrayFilter = (typeof FILTERS)[number]

export function UnplacedTray({
  items,
  query,
  filter,
  editing,
  placing,
  onQuery,
  onFilter,
  onOpen,
  onPointerDown,
}: {
  items: LooseItem[]
  query: string
  filter: TrayFilter
  editing: boolean
  placing: boolean
  onQuery: (value: string) => void
  onFilter: (value: TrayFilter) => void
  onOpen: (item: LooseItem) => void
  onPointerDown: (item: LooseItem, event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const present = new Set(items.map((item) => item.kind))
  const options = FILTERS.filter((value) => value === 'all' || present.has(value))
  const needle = query.trim().toLowerCase()
  const shown = items.filter((item) => {
    if (filter !== 'all' && item.kind !== filter) return false
    if (!needle) return true
    return `${item.code} ${item.name} ${item.label}`.toLowerCase().includes(needle)
  })

  return (
    <div data-tray="" className="shrink-0 border-t border-border-subtle bg-surface px-3 py-2 sm:px-4">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <p className="text-label font-medium text-ink-900">{copy.plano.unplaced}</p>
        <span className="text-caption text-text-tertiary">{items.length}</span>
        <Input
          id="plano-bandeja"
          size="sm"
          type="search"
          value={query}
          placeholder={copy.plano.traySearch}
          aria-label={copy.plano.traySearch}
          className="w-full sm:ml-auto sm:w-44"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          onChange={(event) => onQuery(event.target.value)}
        />
        <Select
          size="sm"
          aria-label={copy.plano.filterType}
          value={filter}
          onChange={(event) => onFilter(event.target.value as TrayFilter)}
        >
          {options.map((value) => (
            <option key={value} value={value}>
              {value === 'all' ? copy.plano.all : labelOf(value, items)}
            </option>
          ))}
        </Select>
      </div>
      {items.length === 0 ? (
        <p className="text-label text-text-secondary">{copy.plano.trayEmpty}</p>
      ) : shown.length === 0 ? (
        <p className="text-label text-text-secondary">{copy.plano.noMatch}</p>
      ) : (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
          {shown.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="secondary"
              size="sm"
              disabled={placing}
              data-code={item.code}
              data-kind={item.kind}
              className={editing ? 'touch-none' : undefined}
              aria-label={`${editing ? copy.plano.place : copy.plano.openCard} ${item.code}`}
              onClick={() => {
                if (!editing) onOpen(item)
              }}
              onPointerDown={(event) => {
                if (editing) onPointerDown(item, event)
              }}
            >
              {item.code}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

function labelOf(kind: string, items: LooseItem[]): string {
  return items.find((item) => item.kind === kind)?.label ?? kind
}
