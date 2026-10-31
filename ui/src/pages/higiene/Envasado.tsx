import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { formatDate, formatInteger } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { isOwner } from '@/pages/aprobaciones/model'
import {
  fetchAppcc,
  getPolicy,
  listOperations,
  putPolicy,
  todayMadrid,
  yearStart,
  type AppccCheck,
  type OperationHeader,
} from '@/pages/higiene/api'
import { useColumns } from '@/pages/higiene/columns'
import { ColumnPicker, HygieneFrame } from '@/pages/higiene/frame'
import { GRID_LABELS, closureLabel, matches, sealLabel } from '@/pages/higiene/labels'
import { Search } from '@/ui/icons'
import { Badge, Button, Chip, DataGrid, EmptyState, Input, Switch, useToast, type GridColumn } from '@/ui'

type Row = {
  id: string
  operationId: string | null
  number: string
  date: string
  closure: string
  seal: string
  rejects: string
  operator: string
  status: 'draft' | 'confirmed'
}

const COLUMN_IDS = ['number', 'date', 'closure', 'seal', 'rejects', 'operator', 'status'] as const

export function Envasado({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const owner = isOwner(me)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'' | 'draft' | 'confirmed'>('')
  const [rows, setRows] = useState<Row[]>([])
  const [required, setRequired] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    number: 260,
    date: 120,
    closure: 160,
    seal: 120,
    rejects: 120,
    operator: 180,
    status: 120,
  })
  const columnsState = useColumns('winecore.columns.hygiene.envasado', COLUMN_IDS, ['seal'])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    Promise.all([
      fetchAppcc(yearStart(), todayMadrid(), controller.signal),
      listOperations({ op_type: 'bottling', status: 'draft', limit: 50 }, controller.signal),
      listOperations({ op_type: 'bottling', status: 'confirmed', limit: 50 }, controller.signal),
      getPolicy(controller.signal),
    ])
      .then(([report, drafts, confirmed, policy]) => {
        if (!active) return
        setRows(merge(report.bottling_checks, drafts.items, confirmed.items))
        setRequired(policy.bottling_checklist_required)
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
  }, [attempt, me])

  const visible = useMemo(
    () => rows.filter((row) => (status ? row.status === status : true) && matches(query, [row.number, row.operator, row.closure, row.seal])),
    [query, rows, status],
  )

  const columns = useMemo<GridColumn<Row>[]>(() => {
    const all: GridColumn<Row>[] = [
      { id: 'number', header: copy.higiene.operation, cell: (row) => row.number },
      { id: 'date', header: copy.higiene.date, cell: (row) => row.date },
      { id: 'closure', header: copy.higiene.closure, cell: (row) => row.closure },
      { id: 'seal', header: copy.higiene.seal, cell: (row) => row.seal },
      { id: 'rejects', header: copy.higiene.rejects, cell: (row) => row.rejects },
      { id: 'operator', header: copy.higiene.operator, cell: (row) => row.operator },
      {
        id: 'status',
        header: copy.higiene.status,
        cell: (row) => (
          <Badge tone={row.status === 'confirmed' ? 'success' : 'warning'} size="sm">
            {row.status === 'confirmed' ? copy.higiene.confirmed : copy.higiene.draft}
          </Badge>
        ),
      },
    ]
    return all.filter((column) => !columnsState.hidden.has(column.id))
  }, [columnsState.hidden])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const filtersActive = Boolean(query.trim() || status)
  const screen = loading ? 'higiene-envasado-cargando' : visible.length === 0 && !filtersActive ? 'higiene-envasado-vacio' : 'higiene-envasado'

  async function togglePolicy(next: boolean) {
    const previous = required
    setRequired(next)
    try {
      await putPolicy(next)
    } catch (err: unknown) {
      setRequired(previous)
      toast(err instanceof ApiError ? err.message : copy.higiene.failed)
    }
  }

  return (
    <HygieneFrame
      me={me}
      screen={screen}
      primary={
        allows(me, 'cellar.operate') ? (
          <Button type="button" variant="primary" size="sm" onClick={() => navigate('/bodega/operaciones/nueva?tipo=bottling')}>
            {copy.higiene.newBottling}
          </Button>
        ) : null
      }
      toolbar={
        <>
          <Input
            size="sm"
            type="search"
            value={query}
            placeholder={copy.higiene.search}
            aria-label={copy.higiene.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ColumnPicker
            columns={COLUMN_IDS.map((id) => ({ id, header: headerOf(id) }))}
            hidden={columnsState.hidden}
            locked="number"
            onToggle={columnsState.toggle}
          />
        </>
      }
      filters={
        <>
          <Chip pressed={status === ''} active={status === ''} onClick={() => setStatus('')}>
            {copy.higiene.all}
          </Chip>
          <Chip pressed={status === 'draft'} active={status === 'draft'} onClick={() => setStatus(status === 'draft' ? '' : 'draft')}>
            {copy.higiene.draft}
          </Chip>
          <Chip pressed={status === 'confirmed'} active={status === 'confirmed'} onClick={() => setStatus(status === 'confirmed' ? '' : 'confirmed')}>
            {copy.higiene.confirmed}
          </Chip>
          {owner ? (
            <span className="flex items-center gap-2 pl-1">
              <Switch checked={required} aria-label={copy.higiene.policy} onChange={(value) => void togglePolicy(value)} />
              <span className="text-label text-text-secondary">{copy.higiene.policy}</span>
            </span>
          ) : (
            <Badge tone={required ? 'warning' : 'neutral'} size="sm">
              {required ? copy.higiene.policyOn : copy.higiene.policyOff}
            </Badge>
          )}
        </>
      }
    >
      {error && rows.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => {
            if (row.operationId) navigate(`/bodega/higiene/envasado/${row.operationId}`)
          }}
          rowHref={(row) => (row.operationId ? `/bodega/higiene/envasado/${row.operationId}` : undefined)}
          total={visible.length}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.higiene.noMatch : copy.higiene.emptyBottling}
              description={filtersActive ? undefined : copy.higiene.emptyBottlingHint}
              action={
                allows(me, 'cellar.operate') && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => navigate('/bodega/operaciones/nueva?tipo=bottling')}>
                    {copy.higiene.newBottling}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
    </HygieneFrame>
  )
}

function headerOf(id: (typeof COLUMN_IDS)[number]): string {
  if (id === 'number') return copy.higiene.operation
  if (id === 'date') return copy.higiene.date
  if (id === 'closure') return copy.higiene.closure
  if (id === 'seal') return copy.higiene.seal
  if (id === 'rejects') return copy.higiene.rejects
  if (id === 'operator') return copy.higiene.operator
  return copy.higiene.status
}

function merge(checks: AppccCheck[], drafts: OperationHeader[], confirmed: OperationHeader[]): Row[] {
  const byNumber = new Map(confirmed.filter((item) => item.number).map((item) => [item.number as string, item]))
  const seen = new Set<string>()
  const done: Row[] = checks.map((row, index) => {
    const operation = row.operation_number ? byNumber.get(row.operation_number) : undefined
    if (operation) seen.add(operation.id)
    return {
      id: `c-${row.operation_number ?? index}`,
      operationId: operation?.id ?? null,
      number: row.operation_number || '—',
      date: formatDate(row.occurred_on),
      closure: closureLabel(row.closure_type),
      seal: sealLabel(row.seal_type),
      rejects: `${formatInteger(row.fill_rejects)} · ${formatInteger(row.closure_rejects)} · ${formatInteger(row.label_rejects)}`,
      operator: row.operator,
      status: 'confirmed',
    }
  })
  const pending: Row[] = drafts
    .filter((row) => !seen.has(row.id))
    .map((row) => ({
      id: `d-${row.id}`,
      operationId: row.id,
      number: row.number || copy.higiene.draft,
      date: formatDate(row.occurred_at),
      closure: '—',
      seal: '—',
      rejects: '—',
      operator: row.performed_by,
      status: 'draft' as const,
    }))
  return [...pending, ...done]
}
