import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { fieldAria } from '@/lib/field'
import { allows } from '@/lib/permissions'
import type { LotListItem } from '@/lib/cellar'
import type { Me } from '@/lib/types'
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Select,
  Skeleton,
  Table,
  useToast,
  type TableColumn,
} from '@/ui'
import { Fact, FactCard, ReadingColumn, RecordBar, SectionTabs } from '@/pages/bodega/chrome'
import { createPlan, messageOf, openVersion, patchRecipe, publishRecipe, readDeviations } from '@/pages/lote-diseno/api'
import { PasoEditor } from '@/pages/lote-diseno/PasoEditor'
import { StepList } from '@/pages/lote-diseno/StepList'
import {
  agingName,
  deviationKind,
  draftsFromSteps,
  fieldName,
  formatCivil,
  isOwner,
  opName,
  statusName,
  stepsFromDrafts,
  todayMadrid,
  valueLabel,
  vinificationName,
  type Deviation,
  type DeviationReport,
  type NamedRef,
  type PlanView,
  type RecipeDetail,
  type RecipeVersion,
  type StepDraft,
} from '@/pages/lote-diseno/model'

const DATE_LABELS = { clear: copy.lote.dateClear, today: copy.lote.dateToday }

const SECTIONS = [
  { id: 'pasos', label: copy.lote.steps },
  { id: 'desviaciones', label: copy.lote.deviations },
] as const

type Section = (typeof SECTIONS)[number]['id']

export function RecetaPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const recipe = useApi<RecipeDetail>(id ? `/v1/recipes/${id}` : null)
  const lots = useApi<{ items: LotListItem[] }>('/v1/lots?limit=100')
  const wines = useApi<{ items: NamedRef[] }>('/v1/wines?limit=100')
  useChromeTitle(recipe.data?.name || copy.lote.recipes)

  if (!allows(me, 'cellar.read')) return <NoPermission />
  if (recipe.loading && !recipe.data) {
    return (
      <div aria-busy="true" className="grid gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (recipe.error || !recipe.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${recipe.error?.code ?? 'WC_ERROR'})`} detail={recipe.error?.message} onRetry={recipe.reload} />
      </div>
    )
  }

  return (
    <Loaded
      key={recipe.data.id}
      me={me}
      recipe={recipe.data}
      lots={lots.data?.items ?? []}
      wines={wines.data?.items ?? []}
      onReload={recipe.reload}
    />
  )
}

function Loaded({
  me,
  recipe,
  lots,
  wines,
  onReload,
}: {
  me: Me
  recipe: RecipeDetail
  lots: LotListItem[]
  wines: NamedRef[]
  onReload: () => void
}) {
  const toast = useToast()
  const canOperate = allows(me, 'cellar.operate')
  const owner = isOwner(me.roles)
  const latest = recipe.versions[recipe.versions.length - 1]
  const [versionNo, setVersionNo] = useState(latest?.version_no ?? 1)
  const [section, setSection] = useState<Section>('pasos')
  const version = recipe.versions.find((item) => item.version_no === versionNo) ?? latest
  const editable = Boolean(canOperate && version && version.status === 'draft' && version.id === latest?.id)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(recipe.name)
  const [notes, setNotes] = useState(recipe.notes ?? '')
  const [steps, setSteps] = useState<StepDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [lotCode, setLotCode] = useState('')
  const [start, setStart] = useState(todayMadrid())
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [compareLot, setCompareLot] = useState('')
  const [report, setReport] = useState<DeviationReport | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  function beginEdit() {
    if (!version) return
    setName(recipe.name)
    setNotes(recipe.notes ?? '')
    setSteps(draftsFromSteps(version.steps))
    setBanner(null)
    setEditing(true)
  }

  async function saveSteps() {
    const parsed = stepsFromDrafts(steps)
    if ('error' in parsed) {
      setBanner(parsed.error)
      return
    }
    if (name.trim().length < 2) {
      setBanner(copy.lote.nameShort)
      return
    }
    setSaving(true)
    setBanner(null)
    try {
      await patchRecipe(recipe.id, { name: name.trim(), notes: notes.trim() || null, steps: parsed.steps })
      toast(copy.lote.stepsSaved)
      setEditing(false)
      onReload()
    } catch (error: unknown) {
      setBanner(messageOf(error, copy.lote.locked))
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    setSaving(true)
    try {
      await publishRecipe(recipe.id)
      toast(copy.lote.publishedToast)
      onReload()
    } catch (error: unknown) {
      toast(messageOf(error, copy.api.generic))
    } finally {
      setSaving(false)
    }
  }

  async function nextVersion() {
    setSaving(true)
    try {
      const next = await openVersion(recipe.id)
      setVersionNo(next.latest_version_no ?? versionNo)
      toast(copy.lote.versionOpened)
      onReload()
    } catch (error: unknown) {
      toast(messageOf(error, copy.api.generic))
    } finally {
      setSaving(false)
    }
  }

  async function apply() {
    if (!version || !lotCode) return
    setSaving(true)
    setBanner(null)
    try {
      const created = await createPlan(lotCode, { recipe_id: recipe.id, version_no: version.version_no, start_date: start })
      setApplyOpen(false)
      setPlan(created)
    } catch (error: unknown) {
      setBanner(messageOf(error, copy.api.generic))
    } finally {
      setSaving(false)
    }
  }

  async function compare() {
    if (!compareLot) return
    setComparing(true)
    setCompareError(null)
    try {
      setReport(await readDeviations(compareLot, recipe.id, version?.version_no ?? null))
    } catch (error: unknown) {
      setReport(null)
      setCompareError(messageOf(error, copy.error.load))
    } finally {
      setComparing(false)
    }
  }

  const draftOpen = version?.status === 'draft'
  const primary = owner && draftOpen ? (
    <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void publish()}>
      {copy.lote.publish}
    </Button>
  ) : canOperate ? (
    <Button type="button" variant="primary" size="sm" onClick={() => { setBanner(null); setApplyOpen(true) }}>
      {copy.lote.apply}
    </Button>
  ) : null

  return (
    <ReadingColumn screen="lote-receta" tab={section}>
      <RecordBar backTo="/bodega/recetas" backLabel={copy.lote.recipes}>
        {primary}
      </RecordBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header className="grid gap-2">
            <h1 className="text-body font-medium break-words text-ink-900">{recipe.name}</h1>
            <p className="text-label text-text-secondary">
              {recipe.code}
              {recipe.source_lot_code ? (
                <>
                  {' · '}
                  <Link className="underline" to={`/bodega/lotes/${encodeURIComponent(recipe.source_lot_code)}`}>
                    {recipe.source_lot_code}
                  </Link>
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {version ? (
                <Badge tone={version.status === 'published' ? 'success' : 'warning'}>
                  {statusName(version.status)} · v{version.version_no}
                </Badge>
              ) : null}
              {recipe.published_version_no && recipe.published_version_no !== version?.version_no ? (
                <Badge tone="success">
                  {copy.lote.published} · v{recipe.published_version_no}
                </Badge>
              ) : null}
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-2">
            {recipe.versions.length > 1 ? (
              <Select aria-label={copy.lote.version} size="sm" value={String(version?.version_no ?? '')} onChange={(event) => setVersionNo(Number(event.target.value))}>
                {recipe.versions.map((item) => (
                  <option key={item.id} value={item.version_no}>
                    v{item.version_no} · {statusName(item.status)}
                  </option>
                ))}
              </Select>
            ) : null}
            {canOperate && owner && draftOpen ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => { setBanner(null); setApplyOpen(true) }}>
                {copy.lote.apply}
              </Button>
            ) : null}
            {canOperate && !draftOpen ? (
              <Button type="button" variant="secondary" size="sm" loading={saving} onClick={() => void nextVersion()}>
                {copy.lote.newVersion}
              </Button>
            ) : null}
            {editable ? (
              <Button type="button" variant="secondary" size="sm" onClick={beginEdit}>
                {copy.lote.editSteps}
              </Button>
            ) : null}
          </div>
          {version ? <DesignFacts version={version} wines={wines} /> : null}
          <SectionTabs label={copy.lote.recipes} tabs={SECTIONS} value={section} onChange={setSection} />
          {section === 'pasos' ? (
            version && version.steps.length > 0 ? (
              <StepList steps={version.steps} />
            ) : (
              <EmptyState size="sm" title={copy.lote.emptySteps} description={copy.lote.emptyStepsHint} />
            )
          ) : (
            <Deviations
              lots={lots}
              lotCode={compareLot}
              report={report}
              error={compareError}
              loading={comparing}
              onLot={setCompareLot}
              onCompare={() => void compare()}
            />
          )}
        </div>
      </div>
      <PasoEditor
        open={editing}
        name={name}
        notes={notes}
        steps={steps}
        lots={lots}
        error={banner}
        saving={saving}
        onClose={() => setEditing(false)}
        onName={setName}
        onNotes={setNotes}
        onSteps={setSteps}
        onSave={() => void saveSteps()}
      />
      <Dialog open={applyOpen} onClose={() => setApplyOpen(false)} labelledBy="aplicar-receta" size="sm">
        <DialogHeader titleId="aplicar-receta" title={copy.lote.apply} onClose={() => setApplyOpen(false)} />
        <DialogBody>
          <div className="grid gap-4" data-screen="lote-aplicar">
            {banner ? <Alert tone="danger">{banner}</Alert> : null}
            <Field id="aplicar-lote" label={copy.lote.lot}>
              <Select {...fieldAria('aplicar-lote')} className="w-full" value={lotCode} disabled={saving} onChange={(event) => setLotCode(event.target.value)}>
                <option value="">{copy.lote.chooseLot}</option>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.code}>
                    {lot.code}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-1.5">
              <span className="text-label text-text-secondary">{copy.lote.startDate}</span>
              <DatePicker value={start} onChange={(next) => setStart(next ?? todayMadrid())} labels={DATE_LABELS} timeZone="Europe/Madrid" className="w-full" />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => setApplyOpen(false)}>
            {copy.lote.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={saving} disabled={!lotCode} onClick={() => void apply()}>
            {copy.lote.applyAction}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog open={plan != null} onClose={() => setPlan(null)} labelledBy="plan-sugerido" size="lg">
        <DialogHeader
          titleId="plan-sugerido"
          title={copy.lote.planTitle}
          description={<Badge tone="neutral">{copy.lote.noOperations}</Badge>}
          onClose={() => setPlan(null)}
        />
        <DialogBody>
          <div className="grid gap-3 pb-4" data-screen="lote-plan">
            {plan ? (
              <>
                <p className="text-label text-text-secondary">
                  {plan.lot_code} · v{plan.version_no} · {formatCivil(plan.start_date)}
                </p>
                <StepList steps={plan.steps} />
              </>
            ) : null}
          </div>
        </DialogBody>
      </Dialog>
    </ReadingColumn>
  )
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function DesignFacts({ version, wines }: { version: RecipeVersion; wines: NamedRef[] }) {
  const record = version.design
  if (record.present !== true) return null
  const kind = textOf(record.destination_kind) ?? 'pending'
  const wine = wines.find((item) => item.id === record.wine_id)
  const destination = kind === 'new_collection' ? textOf(record.collection_name) ?? copy.lote.newCollection : kind === 'pending' ? copy.lote.pending : wine?.name ?? copy.lote.reference
  return (
    <FactCard title={copy.cellar.design}>
      <Fact label={copy.lote.destination} value={destination} />
      <Fact label={copy.lote.vinification} value={vinificationName(textOf(record.vinification) ?? '')} />
      <Fact label={copy.lote.aging} value={agingName(textOf(record.aging_method) ?? '')} />
    </FactCard>
  )
}

function shownField(row: Deviation): string | null {
  if (row.field) return row.field
  if (row.kind === 'missing_step' || row.kind === 'extra_operation' || row.kind === 'type_mismatch') return 'op_type'
  return null
}

function Deviations({
  lots,
  lotCode,
  report,
  error,
  loading,
  onLot,
  onCompare,
}: {
  lots: LotListItem[]
  lotCode: string
  report: DeviationReport | null
  error: string | null
  loading: boolean
  onLot: (code: string) => void
  onCompare: () => void
}) {
  const columns: TableColumn<Deviation & { id: string }>[] = [
    { id: 'kind', header: copy.lote.kind, cell: (row) => deviationKind(row.kind) },
    { id: 'op', header: copy.lote.paso, cell: (row) => (row.op_type ? opName(row.op_type) : '—'), hideOnMobile: true },
    { id: 'field', header: copy.lote.field, cell: (row) => fieldName(row.field) },
    { id: 'expected', header: copy.lote.expected, cell: (row) => valueLabel(shownField(row), row.expected) },
    { id: 'actual', header: copy.lote.actual, cell: (row) => valueLabel(shownField(row), row.actual), hideOnMobile: true },
  ]
  const rows = (report?.deviations ?? []).map((item, index) => ({ ...item, id: `${item.kind}-${item.position ?? 'x'}-${index}` }))

  return (
    <div className="grid gap-3" data-screen="lote-desviaciones">
      <div className="flex flex-wrap items-end gap-2">
        <Field id="comparar-lote" label={copy.lote.lot}>
          <Select {...fieldAria('comparar-lote')} value={lotCode} onChange={(event) => onLot(event.target.value)}>
            <option value="">{copy.lote.chooseLot}</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.code}>
                {lot.code}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="button" variant="secondary" size="sm" loading={loading} disabled={!lotCode} onClick={onCompare}>
          {copy.lote.compare}
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {report?.matched ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success">{copy.lote.matched}</Badge>
          <span className="text-caption text-text-tertiary">
            {report.expected_count} · {report.actual_count}
          </span>
        </div>
      ) : null}
      {report && !report.matched ? <Table columns={columns} rows={rows} rowKey={(row) => row.id} /> : null}
      {!report && !error ? <EmptyState size="sm" title={copy.lote.emptyDeviations} description={copy.lote.emptyDeviationsHint} /> : null}
    </div>
  )
}
