import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import {
  Badge,
  Button,
  Chip,
  DataGrid,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Drawer,
  DrawerBody,
  DrawerHeader,
  EmptyState,
  Input,
  useToast,
  type GridColumn,
} from '@/ui'
import { Search } from '@/ui/icons'
import { createWine } from '@/pages/catalogo/api'
import { Fact, FactCard, ListFrame } from '@/pages/catalogo/frame'
import { GRID_LABELS } from '@/pages/catalogo/labels'
import { categoryLabel, colorLabel, emptyWineInput, type ListPage, type Wine, type WineInput } from '@/pages/catalogo/model'
import { WineForm } from '@/pages/catalogo/ProductForm'
import { validateWine } from '@/pages/catalogo/validate'

export function WinesPage({ me }: { me: Me }) {
  const canWrite = allows(me, 'catalog.write')
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const wines = useApi<ListPage<Wine>>('/v1/wines?limit=100')
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ name: 280, code: 120 })
  const [selected, setSelected] = useState<Wine | null>(null)

  useEffect(() => {
    if (params.get('crear') === 'vino') setOpen(true)
  }, [params])

  function closeCreate() {
    setOpen(false)
    if (params.has('crear')) {
      const next = new URLSearchParams(params)
      next.delete('crear')
      setParams(next, { replace: true })
    }
  }

  const needle = q.trim().toLowerCase()
  const rows = (wines.data?.items ?? []).filter((wine) => {
    if (activeOnly && !wine.is_active) return false
    if (!needle) return true
    return wine.name.toLowerCase().includes(needle) || wine.code.toLowerCase().includes(needle)
  })
  const columns = useMemo<GridColumn<Wine>[]>(
    () => [
      { id: 'name', header: 'Nombre', cell: (row) => row.name },
      { id: 'code', header: 'Código', cell: (row) => <span className="font-mono text-caption">{row.code}</span> },
      { id: 'color', header: 'Color', cell: (row) => colorLabel(row.color) },
      { id: 'category', header: 'Categoría', cell: (row) => categoryLabel(row.category) },
      { id: 'organic', header: 'Ecológico', cell: (row) => (row.is_organic ? 'Sí' : 'No') },
      {
        id: 'active',
        header: 'Activo',
        cell: (row) => <Badge tone={row.is_active ? 'success' : 'neutral'}>{row.is_active ? 'Activo' : 'Inactivo'}</Badge>,
      },
    ],
    [],
  )

  if (!allows(me, 'catalog.read')) return <NoPermission />
  const loading = wines.loading && !wines.data
  const empty = !loading && !wines.error && (wines.data?.items.length ?? 0) === 0 && !needle
  const screen = loading ? 'vinos-cargando' : empty ? 'vinos-vacio' : 'vinos'
  const filtered = Boolean(needle || activeOnly)
  const create = canWrite ? (
    <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
      <span className="sm:hidden">Nuevo</span>
      <span className="hidden sm:inline">{copy.catalog.newWine}</span>
    </Button>
  ) : null

  return (
    <ListFrame
      screen={screen}
      object="vinos"
      actions={create}
      mobileActions={create}
      toolbar={
        <Input
          id="buscar-vinos"
          size="sm"
          type="search"
          value={q}
          placeholder={copy.catalog.search}
          aria-label={copy.catalog.search}
          className="w-28 min-w-0 flex-1 sm:w-56 sm:flex-none"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          onChange={(event) => setQ(event.target.value)}
        />
      }
      filters={
        <Chip pressed={activeOnly} active={activeOnly} onClick={() => setActiveOnly((current) => !current)}>
          {copy.catalog.activeOnly}
        </Chip>
      }
    >
      {wines.error ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${wines.error.code})`} detail={wines.error.message} onRetry={wines.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => setSelected(row)}
          openRowKey={selected?.id}
          loading={loading}
          total={rows.length}
          empty={
            <EmptyState
              size="sm"
              title={filtered ? copy.catalog.noMatch : copy.catalog.emptyWines}
              description={filtered ? undefined : copy.catalog.emptyWinesHint}
              action={canWrite && !filtered ? create : undefined}
            />
          }
        />
      )}
      <WineDialog
        open={open}
        onClose={closeCreate}
        onCreated={() => {
          toast('Vino creado')
          wines.reload()
          closeCreate()
        }}
      />
      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} labelledBy="vino-preview" size="md">
        <DrawerHeader titleId="vino-preview" title={selected?.name ?? 'Vino'} description={selected?.code} onClose={() => setSelected(null)} />
        <DrawerBody>
          {selected ? (
            <div data-screen="vino-preview">
              <FactCard title="Referencia">
                <Fact label="Código" value={selected.code} />
                <Fact label="Color" value={colorLabel(selected.color)} />
                <Fact label="Categoría" value={categoryLabel(selected.category)} />
                <Fact label="DOP / IGP" value={selected.pdo_pgi_name || '—'} />
                <Fact label="Ecológico" value={selected.is_organic ? 'Sí' : 'No'} />
                <Fact label="Sin sulfitos" value={selected.no_added_sulfites ? 'Sí' : 'No'} />
                <Fact label="Parcela única" value={selected.is_single_plot ? 'Sí' : 'No'} />
              </FactCard>
            </div>
          ) : null}
        </DrawerBody>
      </Drawer>
    </ListFrame>
  )
}

function WineDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [value, setValue] = useState<WineInput>(emptyWineInput)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const idempotency = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!open) return
    setValue(emptyWineInput())
    setErrors({})
    idempotency.current = crypto.randomUUID()
  }, [open])

  async function onSubmit() {
    const found = validateWine(value)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    try {
      await createWine(value, idempotency.current)
      onCreated()
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else setErrors({ name: error instanceof ApiError ? error.message : 'No se ha podido crear el vino.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="nuevo-vino" size="lg">
      <DialogHeader titleId="nuevo-vino" title={copy.catalog.newWine} onClose={onClose} />
      <DialogBody>
        <form
          id="vino-alta"
          data-screen="vino-alta"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onSubmit()
          }}
        >
          <WineForm value={value} onChange={setValue} errors={errors} disabled={saving} />
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" form="vino-alta" variant="primary" size="sm" loading={saving}>
          {saving ? 'Creando…' : copy.catalog.createWine}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
