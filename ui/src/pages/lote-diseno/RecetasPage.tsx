import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { fieldAria } from '@/lib/field'
import type { LotListItem } from '@/lib/cellar'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { FileText, Search } from '@/ui/icons'
import {
  Alert,
  Badge,
  Button,
  Chip,
  DataGrid,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Input,
  Select,
  useToast,
  type GridColumn,
} from '@/ui'
import { GRID_LABELS } from '@/pages/bodega/labels'
import { captureRecipe, listRecipes, messageOf } from '@/pages/lote-diseno/api'
import { statusName, type RecipeSummary } from '@/pages/lote-diseno/model'

export function RecetasPage({ me }: { me: Me }) {
  useChromeTitle(copy.lote.recipes)
  const navigate = useNavigate()
  const toast = useToast()
  const canOperate = allows(me, 'cellar.operate')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('')
  const [items, setItems] = useState<RecipeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    name: 240,
    code: 220,
    status: 120,
    lot: 200,
    version: 110,
    steps: 88,
  })
  const [open, setOpen] = useState(false)
  const lots = useApi<{ items: LotListItem[] }>(open ? '/v1/lots?limit=100' : null)
  const [lotCode, setLotCode] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    let active = true
    setLoading(true)
    listRecipes(status || undefined)
      .then((page) => {
        if (!active) return
        setItems(page.items)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [me, status, attempt])

  const rows = useMemo(() => {
    const needle = debounced.toLowerCase()
    if (!needle) return items
    return items.filter((item) => `${item.code} ${item.name} ${item.source_lot_code ?? ''}`.toLowerCase().includes(needle))
  }, [debounced, items])

  const columns = useMemo<GridColumn<RecipeSummary>[]>(
    () => [
      { id: 'name', header: copy.lote.recipeName, cell: (row) => row.name },
      { id: 'code', header: copy.cellar.code, cell: (row) => row.code },
      {
        id: 'status',
        header: copy.cellar.status,
        cell: (row) => (
          <Badge tone={row.status === 'published' ? 'success' : 'warning'} size="sm">
            {statusName(row.status)}
          </Badge>
        ),
      },
      { id: 'lot', header: copy.lote.sourceLot, cell: (row) => row.source_lot_code || '—' },
      {
        id: 'version',
        header: copy.lote.version,
        cell: (row) => (row.latest_version_no == null ? '—' : `v${row.latest_version_no}`),
      },
      { id: 'steps', header: copy.lote.steps, align: 'right', cell: (row) => String(row.step_count) },
    ],
    [],
  )

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const filtersActive = Boolean(debounced || status)
  const screen = loading && items.length === 0 ? 'lote-recetas-cargando' : rows.length === 0 && !filtersActive ? 'lote-recetas-vacio' : 'lote-recetas'

  async function create() {
    if (!lotCode) return
    setSaving(true)
    setBanner(null)
    try {
      const created = await captureRecipe(lotCode, name.trim() ? { name: name.trim() } : {})
      toast(copy.lote.captured)
      setOpen(false)
      navigate(`/bodega/recetas/${created.id}`)
    } catch (err: unknown) {
      setBanner(messageOf(err, copy.lote.notFinished))
    } finally {
      setSaving(false)
    }
  }

  const createButton = canOperate ? (
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={() => {
        setBanner(null)
        setOpen(true)
      }}
    >
      {copy.lote.fromLot}
    </Button>
  ) : null

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <FileText className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.lote.recipes}</h1>
        <div className="ml-auto">{createButton}</div>
      </header>
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            size="sm"
            type="search"
            value={q}
            placeholder={copy.lote.searchRecipes}
            aria-label={copy.lote.searchRecipes}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        <div className="ml-auto flex shrink-0 md:hidden">{createButton}</div>
      </div>
      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          {[
            { id: '', label: copy.lote.all },
            { id: 'draft', label: copy.lote.draft },
            { id: 'published', label: copy.lote.published },
          ].map((pill) => (
            <Chip key={pill.id || 'todas'} pressed={status === pill.id} active={status === pill.id} onClick={() => setStatus(pill.id)}>
              {pill.label}
            </Chip>
          ))}
        </div>
      </div>
      {error && items.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          labels={{ ...GRID_LABELS, openRecord: copy.lote.openRecipe }}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/bodega/recetas/${row.id}`)}
          rowHref={(row) => `/bodega/recetas/${row.id}`}
          total={rows.length}
          loading={loading && items.length === 0}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.lote.noMatch : copy.lote.emptyRecipes}
              description={filtersActive ? undefined : copy.lote.emptyRecipesHint}
              action={filtersActive ? undefined : createButton}
            />
          }
        />
      )}
      <Dialog open={open} onClose={() => setOpen(false)} labelledBy="receta-desde-lote" size="sm">
        <DialogHeader titleId="receta-desde-lote" title={copy.lote.captureTitle} onClose={() => setOpen(false)} />
        <DialogBody>
          <div className="grid gap-4" data-screen="lote-desde-lote">
            {banner ? <Alert tone="danger">{banner}</Alert> : null}
            <Field id="lote-origen" label={copy.lote.lot}>
              <Select
                {...fieldAria('lote-origen')}
                className="w-full"
                value={lotCode}
                disabled={saving || lots.loading}
                onChange={(event) => setLotCode(event.target.value)}
              >
                <option value="">{copy.lote.chooseLot}</option>
                {(lots.data?.items ?? []).map((lot) => (
                  <option key={lot.id} value={lot.code}>
                    {lot.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="nombre-receta" label={copy.lote.recipeName}>
              <Input {...fieldAria('nombre-receta')} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => setOpen(false)}>
            {copy.lote.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={saving} disabled={!lotCode} onClick={() => void create()}>
            {copy.lote.save}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
