import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy, fill } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { getSettlement } from '@/pages/intercompania/api'
import { ListFrame } from '@/pages/intercompania/frame'
import {
  fold,
  formatAmount,
  formatCivil,
  formatQty,
  GRID_LABELS,
  litersLabel,
  madridToday,
  periodTitle,
  periodWindow,
  watcherLabel,
  watcherTone,
  type Settlement,
} from '@/pages/intercompania/model'
import { Search } from '@/ui/icons'
import {
  Alert,
  Badge,
  Chip,
  DataGrid,
  EmptyState,
  GlassMenu,
  Input,
  MenuChip,
  MenuItem,
  useMenuOpen,
  type GridColumn,
} from '@/ui'

type Filter = 'moves' | 'all' | 'pending' | 'overdue'
type ColumnId = 'period' | 'status' | 'deadline' | 'units' | 'amount' | 'liters'

const COLUMN_IDS: ColumnId[] = ['period', 'status', 'deadline', 'units', 'amount', 'liters']
const DEFAULT_HIDDEN = new Set<ColumnId>(['liters'])

export function SettlementList({ me }: { me: Me }) {
  const [rows, setRows] = useState<Settlement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const periods = periodWindow(madridToday().slice(0, 7), 11)
    Promise.all(periods.map((period) => getSettlement(period, controller.signal)))
      .then((items) => {
        if (!active) return
        setRows(items)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  if (!allows(me, 'billing.read')) return <NoPermission />
  if (error && rows.length === 0) {
    return (
      <div className="p-4">
        <ErrorState
          title={`${copy.error.load} (${error.code})`}
          detail={error.message}
          onRetry={() => {
            setLoading(true)
            setAttempt((value) => value + 1)
          }}
        />
      </div>
    )
  }
  return <Loaded rows={rows} loading={loading} current={madridToday().slice(0, 7)} />
}

function Loaded({ rows, loading, current }: { rows: Settlement[]; loading: boolean; current: string }) {
  const navigate = useNavigate()
  const columnsMenu = useMenuOpen()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('moves')
  const [hidden, setHidden] = useState<Set<ColumnId>>(new Set(DEFAULT_HIDDEN))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ period: 280, status: 180, deadline: 140, amount: 140 })

  const filtered = useMemo(() => {
    const query = fold(q.trim())
    return [...rows]
      .filter((row) => matches(row, filter, current))
      .filter((row) => {
        if (!query) return true
        return fold(`${periodTitle(row.period)} ${watcherLabel(row.watcher_status)} ${row.watcher_message}`).includes(query)
      })
      .sort((a, b) => b.period.localeCompare(a.period))
  }, [current, filter, q, rows])

  const columns = useMemo<GridColumn<Settlement>[]>(() => {
    const labels: Record<ColumnId, string> = {
      period: copy.intercompany.period,
      status: copy.intercompany.status,
      deadline: copy.intercompany.deadline,
      units: copy.intercompany.units,
      amount: copy.intercompany.amount,
      liters: copy.intercompany.liters,
    }
    const all: GridColumn<Settlement>[] = [
      { id: 'period', header: labels.period, cell: (row) => periodTitle(row.period) },
      {
        id: 'status',
        header: labels.status,
        cell: (row) => (
          <Badge tone={watcherTone(row.watcher_status)} size="sm">
            {watcherLabel(row.watcher_status)}
          </Badge>
        ),
      },
      { id: 'deadline', header: labels.deadline, cell: (row) => formatCivil(row.issue_deadline) },
      { id: 'units', header: labels.units, align: 'right', cell: (row) => formatQty(row.totals.units) },
      { id: 'amount', header: labels.amount, align: 'right', cell: (row) => formatAmount(row.totals.amount) },
      { id: 'liters', header: labels.liters, align: 'right', cell: (row) => litersLabel(row.totals.liters) },
    ]
    return all.filter((column) => !hidden.has(column.id as ColumnId))
  }, [hidden])

  const filtersActive = Boolean(q.trim() || filter !== 'moves')
  const empty = !loading && filtered.length === 0
  const screen = loading ? 'intercompania-cargando' : empty ? 'intercompania-vacio' : 'intercompania-lista'
  const urgent = bannerOf(rows)

  return (
    <ListFrame
      screen={screen}
      object="liquidaciones"
      toolbar={
        <>
          <Input
            id="buscar-liquidaciones"
            size="sm"
            type="search"
            value={q}
            placeholder={copy.intercompany.searchMonth}
            aria-label={copy.intercompany.searchMonth}
            className="w-36 shrink-0 sm:w-56"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
          <GlassMenu
            open={columnsMenu.open}
            onOpenChange={columnsMenu.setOpen}
            placement="bottom-start"
            panelClassName="min-w-[200px]"
            trigger={
              <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.intercompany.columns}>
                {copy.intercompany.columns}
              </MenuChip>
            }
          >
            {COLUMN_IDS.map((id) => (
              <MenuItem
                key={id}
                checked={!hidden.has(id)}
                disabled={id === 'period'}
                onClick={() =>
                  setHidden((currentSet) => {
                    const next = new Set(currentSet)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
              >
                {id === 'period'
                  ? copy.intercompany.period
                  : id === 'status'
                    ? copy.intercompany.status
                    : id === 'deadline'
                      ? copy.intercompany.deadline
                      : id === 'units'
                        ? copy.intercompany.units
                        : id === 'amount'
                          ? copy.intercompany.amount
                          : copy.intercompany.liters}
              </MenuItem>
            ))}
          </GlassMenu>
        </>
      }
      filters={
        <>
          {(
            [
              ['moves', copy.intercompany.withMoves],
              ['all', copy.intercompany.all],
              ['pending', copy.intercompany.pending],
              ['overdue', copy.intercompany.overdue],
            ] as const
          ).map(([id, label]) => (
            <Chip key={id} pressed={filter === id} active={filter === id} onClick={() => setFilter(id)}>
              {label}
            </Chip>
          ))}
        </>
      }
      banner={
        urgent && filtered.some((row) => row.period === urgent.row.period) ? (
          <DeadlineBanner settlement={urgent.row} text={urgent.text} />
        ) : null
      }
    >
      <DataGrid
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.period}
        labels={GRID_LABELS}
        widths={widths}
        onResize={(id, width) => setWidths((currentWidths) => ({ ...currentWidths, [id]: width }))}
        selected={picked}
        onSelectedChange={setPicked}
        rowHref={(row) => `/intercompania/${row.period}`}
        onOpenRow={(row) => navigate(`/intercompania/${row.period}`)}
        total={filtered.length}
        loading={loading}
        empty={
          <EmptyState
            size="sm"
            title={filtersActive ? copy.intercompany.noMatch : copy.intercompany.emptySettlements}
            description={filtersActive ? undefined : copy.intercompany.emptySettlementsHint}
          />
        }
      />
    </ListFrame>
  )
}

function matches(row: Settlement, filter: Filter, current: string): boolean {
  if (filter === 'pending') return row.watcher_status === 'pending_issue'
  if (filter === 'overdue') return row.watcher_status === 'overdue'
  if (filter === 'all') return true
  return row.period === current || row.id != null || row.lines.length > 0 || row.watcher_status !== 'open'
}

function bannerOf(rows: Settlement[]): { row: Settlement; text: string } | null {
  const overdue = rows
    .filter((row) => row.watcher_status === 'overdue')
    .sort((a, b) => a.issue_deadline.localeCompare(b.issue_deadline))
  const pending = rows
    .filter((row) => row.watcher_status === 'pending_issue')
    .sort((a, b) => a.issue_deadline.localeCompare(b.issue_deadline))
  const row = overdue[0] ?? pending[0]
  if (!row) return null
  if (overdue.length > 1) return { row, text: fill(copy.intercompany.overdueCount, { count: String(overdue.length) }) }
  if (overdue.length === 0 && pending.length > 1) {
    return { row, text: fill(copy.intercompany.pendingCount, { count: String(pending.length) }) }
  }
  return {
    row,
    text: `${periodTitle(row.period)} · ${row.watcher_message}`,
  }
}

function DeadlineBanner({ settlement, text }: { settlement: Settlement; text: string }) {
  const tone = settlement.watcher_status === 'overdue' ? 'danger' : 'warning'
  return (
    <div className="shrink-0 border-b border-border-subtle px-3 py-2 sm:px-4">
      <Alert tone={tone}>
        <Link to={`/intercompania/${settlement.period}`} className="text-label font-medium underline-offset-2 hover:underline">
          {text}
        </Link>
      </Alert>
    </div>
  )
}
