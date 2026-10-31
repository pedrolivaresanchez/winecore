import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { Plus, Search } from '@/ui/icons'
import { Badge, Button, DataGrid, DatePicker, EmptyState, Input, Select, type GridColumn } from '@/ui'
import { listNotes, messageOf } from '@/pages/catas/api'
import { CatasFrame } from '@/pages/catas/frame'
import {
  GRID_LABELS,
  descriptorName,
  formatScore,
  rangeEnd,
  rangeStart,
  subjectLabel,
} from '@/pages/catas/labels'
import type { Note } from '@/pages/catas/types'
import { useCatalog } from '@/pages/catas/use-catalog'

export function NotesPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const catalog = useCatalog(allows(me, 'cellar.read'))
  const canWrite = allows(me, 'tasting.write')
  const sheet = params.get('ficha') ?? ''
  const lotId = params.get('lot_id') ?? ''
  const wineId = params.get('wine_id') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [items, setItems] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    sheet: 240,
    when: 120,
    where: 160,
    taster: 150,
    score: 88,
    defects: 140,
  })

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim().toLowerCase()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    listNotes(
      {
        template_code: sheet || undefined,
        lot_id: lotId || undefined,
        wine_id: wineId || undefined,
        from: from ? rangeStart(from) : undefined,
        to: to ? rangeEnd(to) : undefined,
      },
      controller.signal,
    )
      .then((page) => {
        if (!active) return
        setItems(page.items)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(messageOf(err instanceof ApiError ? err : err))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, from, lotId, me, sheet, to, wineId])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  const rows = useMemo(() => {
    if (!debounced) return items
    return items.filter((note) => {
      const where = `${catalog.lotCode(note.lot_id)} ${catalog.wineName(note.wine_id)} ${catalog.templateName(note.template_code)}`
      return `${note.taster_name} ${where}`.toLowerCase().includes(debounced)
    })
  }, [catalog, debounced, items])

  const filtersActive = Boolean(debounced || sheet || lotId || wineId || from || to)

  const columns = useMemo<GridColumn<Note>[]>(
    () => [
      {
        id: 'sheet',
        header: copy.catas.columns.sheet,
        cell: (row) => catalog.templateName(row.template_code) || row.template_code,
      },
      { id: 'when', header: copy.catas.columns.when, cell: (row) => formatDate(row.tasted_at) },
      {
        id: 'where',
        header: copy.catas.columns.where,
        cell: (row) => catalog.lotCode(row.lot_id) || catalog.wineName(row.wine_id) || subjectLabel(row.subject),
      },
      { id: 'taster', header: copy.catas.columns.taster, cell: (row) => row.taster_name },
      {
        id: 'score',
        header: copy.catas.columns.score,
        align: 'right',
        cell: (row) => formatScore(row.overall_score),
      },
      {
        id: 'defects',
        header: copy.catas.columns.defects,
        cell: (row) =>
          row.defects.length === 0 ? (
            '—'
          ) : (
            <Badge tone="danger" size="sm">
              {row.defects.length === 1 ? descriptorName(catalog.descriptors, row.defects[0] ?? '') : String(row.defects.length)}
            </Badge>
          ),
      },
    ],
    [catalog],
  )

  const createTo = `/bodega/catas/nueva${params.toString() ? `?${params}` : ''}`
  function addButton() {
    if (!canWrite) return null
    return (
      <Button type="button" variant="primary" size="sm" onClick={() => navigate(createTo)}>
        <Plus strokeWidth={iconStroke} />
        {copy.catas.newNote}
      </Button>
    )
  }

  const screen = loading ? 'catas-notas-cargando' : rows.length === 0 && !filtersActive ? 'catas-notas-vacio' : 'catas-notas'

  return (
    <CatasFrame
      screen={screen}
      section="notas"
      title={copy.catas.notes}
      action={addButton()}
      toolbar={
        <Input
          id="buscar-catas"
          size="sm"
          type="search"
          value={q}
          placeholder={copy.catas.search}
          aria-label={copy.catas.search}
          className="w-44 shrink-0"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          onChange={(event) => setQ(event.target.value)}
        />
      }
      filters={
        <>
          <Select
            size="sm"
            aria-label={copy.catas.sheet}
            value={sheet}
            className="max-w-52"
            onChange={(event) => setFilter('ficha', event.target.value)}
          >
            <option value="">{copy.catas.allSheets}</option>
            {catalog.templates.map((template) => (
              <option key={template.id} value={template.code}>
                {template.name}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            aria-label={copy.catas.lot}
            value={lotId}
            className="max-w-40"
            onChange={(event) => setFilter('lot_id', event.target.value)}
          >
            <option value="">{copy.catas.lot}</option>
            {lotId && !catalog.lots.some((lot) => lot.id === lotId) ? <option value={lotId}>{copy.catas.lot}</option> : null}
            {catalog.lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.code}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            aria-label={copy.catas.wine}
            value={wineId}
            className="max-w-44"
            onChange={(event) => setFilter('wine_id', event.target.value)}
          >
            <option value="">{copy.catas.wine}</option>
            {wineId && !catalog.wines.some((wine) => wine.id === wineId) ? <option value={wineId}>{copy.catas.wine}</option> : null}
            {catalog.wines.map((wine) => (
              <option key={wine.id} value={wine.id}>
                {wine.name}
              </option>
            ))}
          </Select>
          <DatePicker
            size="sm"
            value={from || null}
            onChange={(next) => setFilter('from', next?.slice(0, 10) ?? '')}
            placeholder={copy.catas.from}
            labels={{ clear: copy.catas.clearDate, today: copy.catas.today }}
          />
          <DatePicker
            size="sm"
            value={to || null}
            onChange={(next) => setFilter('to', next?.slice(0, 10) ?? '')}
            placeholder={copy.catas.to}
            labels={{ clear: copy.catas.clearDate, today: copy.catas.today }}
          />
        </>
      }
    >
      {error && items.length === 0 ? (
        <div className="p-4">
          <ErrorState title={error} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          labels={{ ...GRID_LABELS, openRecord: copy.catas.notes }}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/bodega/catas/notas/${row.id}`)}
          rowHref={(row) => `/bodega/catas/notas/${row.id}`}
          total={rows.length}
          loading={loading || catalog.loading}
          scrollKey="catas-notas"
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.catas.noMatch : copy.catas.emptyNotes}
              description={filtersActive ? undefined : copy.catas.emptyNotesHint}
              action={filtersActive ? undefined : addButton()}
            />
          }
        />
      )}
    </CatasFrame>
  )
}
