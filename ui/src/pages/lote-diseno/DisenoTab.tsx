import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Field } from '@/components/Field'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { fieldAria } from '@/lib/field'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { useApi } from '@/hooks/use-api'
import { Alert, Badge, Button, Drawer, DrawerBody, DrawerHeader, EmptyState, Input, Skeleton, Textarea, useToast } from '@/ui'
import { Fact, FactCard } from '@/pages/bodega/chrome'
import { captureRecipe, messageOf, saveDesign } from '@/pages/lote-diseno/api'
import { DisenoForm } from '@/pages/lote-diseno/DisenoForm'
import {
  agingName,
  cloneDesign,
  destinationText,
  emptyDesign,
  inoculationName,
  normalizeDesign,
  practiceName,
  validateDesign,
  vinificationName,
  type DesignInput,
  type DesignView,
  type NamedRef,
  type RecipeSummary,
} from '@/pages/lote-diseno/model'

export function DisenoTab({ me, lotCode }: { me: Me; lotCode: string }) {
  const canOperate = allows(me, 'cellar.operate')
  const design = useApi<DesignView>(`/v1/lots/${encodeURIComponent(lotCode)}/design`)
  const wines = useApi<{ items: NamedRef[] }>('/v1/wines?limit=100')
  const products = useApi<{ items: NamedRef[] }>('/v1/products?kind=wine&limit=100')
  const yeasts = useApi<{ items: NamedRef[] }>('/v1/products?kind=oenological_product&limit=100')
  const recipes = useApi<{ items: RecipeSummary[] }>(design.data ? `/v1/recipes?lot_id=${design.data.lot_id}&limit=20` : null)

  if (design.loading && !design.data) return <Skeleton className="h-40" />
  if (design.error || !design.data) {
    return <ErrorState title={`${copy.error.load} (${design.error?.code ?? 'WC_ERROR'})`} detail={design.error?.message} onRetry={design.reload} />
  }

  return (
    <Loaded
      meCanOperate={canOperate}
      lotCode={lotCode}
      view={design.data}
      wines={wines.data?.items ?? []}
      products={products.data?.items ?? []}
      yeasts={yeasts.data?.items ?? []}
      recipes={recipes.data?.items ?? []}
      onSaved={() => {
        design.reload()
        recipes.reload()
      }}
    />
  )
}

function Loaded({
  meCanOperate,
  lotCode,
  view,
  wines,
  products,
  yeasts,
  recipes,
  onSaved,
}: {
  meCanOperate: boolean
  lotCode: string
  view: DesignView
  wines: NamedRef[]
  products: NamedRef[]
  yeasts: NamedRef[]
  recipes: RecipeSummary[]
  onSaved: () => void
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const current = view.design
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DesignInput>(() => cloneDesign(current ?? emptyDesign()))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)

  function beginEdit() {
    setDraft(cloneDesign(current ?? emptyDesign()))
    setErrors({})
    setBanner(null)
    setOpen(true)
  }

  async function save() {
    const found = validateDesign(draft, view)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    setBanner(null)
    try {
      await saveDesign(lotCode, normalizeDesign(draft))
      toast(copy.lote.designSaved)
      setOpen(false)
      onSaved()
    } catch (error: unknown) {
      setBanner(messageOf(error, copy.api.generic))
    } finally {
      setSaving(false)
    }
  }

  async function capture() {
    setCapturing(true)
    setCaptureError(null)
    try {
      const created = await captureRecipe(lotCode, {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      toast(copy.lote.captured)
      setCaptureOpen(false)
      onSaved()
      navigate(`/bodega/recetas/${created.id}`)
    } catch (error: unknown) {
      setCaptureError(messageOf(error, copy.lote.notFinished))
    } finally {
      setCapturing(false)
    }
  }

  const actions = meCanOperate ? (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="primary" size="sm" onClick={beginEdit}>
        {copy.lote.edit}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setCaptureError(null)
          setCaptureOpen(true)
        }}
      >
        {copy.lote.capture}
      </Button>
    </div>
  ) : null

  return (
    <div className="grid gap-4">
      {current ? (
        <>
          <div className="flex justify-end">{actions}</div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="neutral">{destinationText(current, wines, products)}</Badge>
            <Badge tone="neutral">{vinificationName(current.vinification)}</Badge>
            {current.single_plot ? <Badge tone="info">{copy.lote.singlePlot}</Badge> : null}
            {current.no_intervention ? <Badge tone="success">{copy.lote.fields.no_intervention}</Badge> : null}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <FactCard title={copy.lote.destination}>
              <Fact label={copy.lote.destination} value={destinationText(current, wines, products)} />
              <Fact label={copy.lote.vinification} value={vinificationName(current.vinification)} />
              <Fact label={copy.lote.destemmed} value={current.destemmed ? copy.lote.yes : copy.lote.no} />
              <Fact label={copy.lote.inoculation} value={inoculationName(current.inoculation_kind)} />
              {current.yeast_name ? <Fact label={copy.lote.yeast} value={current.yeast_name} /> : null}
              {current.yeast_lot_code ? <Fact label={copy.lote.yeastLot} value={current.yeast_lot_code} /> : null}
            </FactCard>
            <FactCard title={copy.lote.aging}>
              <Fact
                label={copy.lote.aging}
                value={
                  current.aging_duration_days != null
                    ? `${agingName(current.aging_method)} · ${current.aging_duration_days} d`
                    : agingName(current.aging_method)
                }
              />
              <Fact label={copy.lote.singlePlot} value={current.single_plot ? copy.lote.yes : copy.lote.no} />
              <Fact label={copy.lote.labelNumber} value={current.label_number == null ? '—' : String(current.label_number)} />
              <Fact label={copy.lote.origin} value={view.origin_parcels.map((parcel) => parcel.code).join(' · ') || '—'} />
            </FactCard>
          </div>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <h2 className="text-caption text-text-tertiary">{copy.lote.applied}</h2>
              <div className="flex flex-wrap gap-1.5">
                {current.practices_applied.length === 0 ? (
                  <span className="text-label text-text-secondary">—</span>
                ) : (
                  current.practices_applied.map((code) => (
                    <Badge key={code} tone="success" size="sm">
                      {practiceName(view.practice_catalog, code)}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div className="grid gap-1.5">
              <h2 className="text-caption text-text-tertiary">{copy.lote.notApplied}</h2>
              <div className="flex flex-wrap gap-1.5">
                {current.practices_not_applied.length === 0 ? (
                  <span className="text-label text-text-secondary">—</span>
                ) : (
                  current.practices_not_applied.map((code) => (
                    <Badge key={code} tone="neutral" size="sm">
                      {practiceName(view.practice_catalog, code)}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </section>
          {current.notes ? <p className="text-label text-text-secondary">{current.notes}</p> : null}
        </>
      ) : (
        <EmptyState size="sm" title={copy.lote.emptyDesign} description={copy.lote.emptyDesignHint} action={actions} />
      )}
      {recipes.length > 0 ? (
        <ul className="grid gap-1">
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <Link className="text-label text-ink-900 underline" to={`/bodega/recetas/${recipe.id}`}>
                {recipe.code} · {recipe.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <Drawer open={open} onClose={() => setOpen(false)} labelledBy="editar-diseno" size="lg">
        <DrawerHeader titleId="editar-diseno" title={copy.cellar.design} onClose={() => setOpen(false)} />
        <DrawerBody>
          {banner ? <Alert tone="danger">{banner}</Alert> : null}
          <DisenoForm
            value={draft}
            view={view}
            wines={wines}
            products={products}
            yeasts={yeasts}
            errors={errors}
            disabled={saving}
            onChange={setDraft}
          />
        </DrawerBody>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3 sm:px-6">
          <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => setOpen(false)}>
            {copy.lote.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void save()}>
            {copy.lote.save}
          </Button>
        </div>
      </Drawer>
      <Drawer open={captureOpen} onClose={() => setCaptureOpen(false)} labelledBy="guardar-receta" size="md">
        <DrawerHeader titleId="guardar-receta" title={copy.lote.captureTitle} onClose={() => setCaptureOpen(false)} />
        <DrawerBody>
          <div className="grid gap-4" data-screen="lote-captura">
            {captureError ? <Alert tone="danger">{captureError}</Alert> : null}
            <Field id="recipe-name" label={copy.lote.recipeName}>
              <Input {...fieldAria('recipe-name')} value={name} disabled={capturing} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field id="recipe-notes" label={copy.lote.notes}>
              <Textarea id="recipe-notes" value={notes} disabled={capturing} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </div>
        </DrawerBody>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3 sm:px-6">
          <Button type="button" variant="secondary" size="sm" disabled={capturing} onClick={() => setCaptureOpen(false)}>
            {copy.lote.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={capturing} onClick={() => void capture()}>
            {copy.lote.save}
          </Button>
        </div>
      </Drawer>
    </div>
  )
}
