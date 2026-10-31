import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { useChromeTitle } from '@/app/shell/shell-context'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { type Vessel } from '@/lib/cellar'
import { formatLitres } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { calculateAlcohol, calculateBlend, calculateCold, calculateSo2 } from '@/pages/enologia/api'
import { entityShort } from '@/pages/enologia/labels'
import { esQty, toApiDecimal } from '@/pages/enologia/qty'
import type { AlcoholResult, BlendResult, ColdResult, So2Result, Warning, WineColor } from '@/pages/enologia/types'
import { RecordBar, SectionTabs } from '@/pages/bodega/chrome'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  GlassMenu,
  InfoTip,
  Input,
  MenuItem,
  SegmentedControl,
  Select,
  Skeleton,
  useMenuOpen,
} from '@/ui'
import { MoreVertical } from '@/ui/icons'

type Tool = 'so2' | 'cold' | 'alcohol' | 'blend'
type ProductKind = 'potassium_metabisulfite' | 'solution'

type BlendRow = { key: string; vesselId: string; pipette: string }

const TABS: { id: Tool; label: string }[] = [
  { id: 'so2', label: copy.enology.tabs.so2 },
  { id: 'cold', label: copy.enology.tabs.cold },
  { id: 'alcohol', label: copy.enology.tabs.alcohol },
  { id: 'blend', label: copy.enology.tabs.blend },
]

const SCREEN: Record<Tool, string> = {
  so2: 'enologia-so2',
  cold: 'enologia-frio',
  alcohol: 'enologia-grado',
  blend: 'enologia-corte',
}

function tabOf(value: string | null): Tool {
  if (value === 'cold' || value === 'alcohol' || value === 'blend' || value === 'so2') return value
  return 'so2'
}

function blankPart(): BlendRow {
  return { key: crypto.randomUUID(), vesselId: '', pipette: '' }
}

export function CalculadorasPage({ me }: { me: Me }) {
  useChromeTitle(copy.enology.title)
  const [params, setParams] = useSearchParams()
  const tab = tabOf(params.get('t'))
  const more = useMenuOpen()
  const { filter } = useEntity()
  const entities = me.entities
  const preset = entities.find((entity) => entity.code === filter)?.id
    ?? entities.find((entity) => entity.code === 'PO')?.id
    ?? entities[0]?.id
    ?? ''
  const [picked, setPicked] = useState(preset)
  const entityId = filter === 'all' ? picked || preset : preset
  const showEntity = filter === 'all' && entities.length > 1

  const [ph, setPh] = useState('')
  const [free, setFree] = useState('')
  const [volume, setVolume] = useState('')
  const [wine, setWine] = useState<WineColor>('tinto')
  const [product, setProduct] = useState<ProductKind>('potassium_metabisulfite')
  const [percent, setPercent] = useState('')
  const [sugar, setSugar] = useState('')
  const [total, setTotal] = useState('')
  const [target, setTarget] = useState('')
  const [noSulfites, setNoSulfites] = useState(false)
  const [alcohol, setAlcohol] = useState('')
  const [sugars, setSugars] = useState('')
  const [density, setDensity] = useState('')
  const [targetVolume, setTargetVolume] = useState('')
  const [parts, setParts] = useState<BlendRow[]>(() => [blankPart(), blankPart()])
  const [rowMenu, setRowMenu] = useState<string | null>(null)

  const [so2, setSo2] = useState<So2Result | null>(null)
  const [cold, setCold] = useState<ColdResult | null>(null)
  const [probable, setProbable] = useState<AlcoholResult | null>(null)
  const [blend, setBlend] = useState<BlendResult | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const resultRef = useRef<HTMLDivElement>(null)

  const vessels = useApi<{ items: Vessel[]; next_cursor: string | null }>(
    allows(me, 'cellar.read') && tab === 'blend' ? '/v1/vessels?limit=100' : null,
  )
  const vesselOptions = useMemo(
    () => [...(vessels.data?.items ?? [])].sort((a, b) => a.code.localeCompare(b.code, 'es')),
    [vessels.data],
  )

  if (!allows(me, 'cellar.read')) return <NoPermission />

  function choose(next: Tool) {
    const query = new URLSearchParams(params)
    query.set('t', next)
    setParams(query, { replace: true })
    setErrors({})
    setFormError(null)
  }

  function chooseEntity(id: string) {
    setPicked(id)
    setSo2(null)
    setProbable(null)
  }

  function clearTool() {
    setErrors({})
    setFormError(null)
    if (tab === 'so2') {
      setPh('')
      setFree('')
      setVolume('')
      setWine('tinto')
      setProduct('potassium_metabisulfite')
      setPercent('')
      setSugar('')
      setTotal('')
      setTarget('')
      setNoSulfites(false)
      setSo2(null)
    } else if (tab === 'cold') {
      setAlcohol('')
      setCold(null)
    } else if (tab === 'alcohol') {
      setSugars('')
      setDensity('')
      setProbable(null)
    } else {
      setTargetVolume('')
      setParts([blankPart(), blankPart()])
      setBlend(null)
    }
  }

  async function run() {
    const local = validate(tab, {
      ph, free, volume, percent, product, sugar, total, target, alcohol, sugars, density, targetVolume, parts,
    })
    setErrors(local)
    if (Object.keys(local).length > 0) {
      setFormError(null)
      return
    }
    const id = request.current + 1
    request.current = id
    setBusy(true)
    setFormError(null)
    try {
      if (tab === 'so2') {
        const body = {
          ph: toApiDecimal(ph) ?? '',
          free_so2_mg_l: toApiDecimal(free) ?? '',
          volume_l: toApiDecimal(volume) ?? '',
          wine_type: wine,
          product: product === 'solution'
            ? { kind: 'solution' as const, so2_percent: toApiDecimal(percent) ?? '' }
            : { kind: 'potassium_metabisulfite' as const },
          ...(entityId ? { legal_entity_id: entityId } : {}),
          ...(toApiDecimal(sugar) ? { residual_sugar_g_l: toApiDecimal(sugar) ?? undefined } : {}),
          ...(toApiDecimal(total) ? { total_so2_mg_l: toApiDecimal(total) ?? undefined } : {}),
          ...(toApiDecimal(target) ? { molecular_target_mg_l: toApiDecimal(target) ?? undefined } : {}),
          ...(noSulfites ? { no_added_sulfites: true } : {}),
        }
        const result = await calculateSo2(body)
        if (request.current !== id) return
        setSo2(result)
      } else if (tab === 'cold') {
        const result = await calculateCold({ alcohol_pct: toApiDecimal(alcohol) ?? '' })
        if (request.current !== id) return
        setCold(result)
      } else if (tab === 'alcohol') {
        const result = await calculateAlcohol({
          ...(entityId ? { legal_entity_id: entityId } : {}),
          ...(toApiDecimal(sugars) ? { sugars_g_l: toApiDecimal(sugars) ?? undefined } : {}),
          ...(toApiDecimal(density) ? { density_g_l: toApiDecimal(density) ?? undefined } : {}),
        })
        if (request.current !== id) return
        setProbable(result)
      } else {
        const result = await calculateBlend({
          target_volume_l: toApiDecimal(targetVolume) ?? '',
          components: parts.map((row) => {
            const vessel = vesselOptions.find((item) => item.id === row.vesselId)
            return {
              label: vessel?.code ?? null,
              volume_ml: toApiDecimal(row.pipette) ?? '',
              vessel_id: row.vesselId,
            }
          }),
        })
        if (request.current !== id) return
        setBlend(result)
      }
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'nearest' }))
    } catch (error: unknown) {
      if (request.current !== id) return
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      setFormError(error instanceof ApiError ? error.message : copy.enology.calcFail)
    } finally {
      if (request.current === id) setBusy(false)
    }
  }

  const activeResult = tab === 'so2' ? so2 : tab === 'cold' ? cold : tab === 'alcohol' ? probable : blend

  return (
    <div data-screen={SCREEN[tab]} data-result={activeResult ? 'si' : 'no'} className="flex min-h-0 flex-1 flex-col">
      <RecordBar backTo="/bodega/depositos" backLabel={copy.enology.back}>
        <Button type="submit" form="enologia-calc" variant="primary" size="sm" loading={busy}>
          {copy.enology.calculate}
        </Button>
        <GlassMenu
          open={more.open}
          onOpenChange={more.setOpen}
          placement="bottom-end"
          trigger={
            <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.enology.more} onClick={more.toggle}>
              <MoreVertical strokeWidth={iconStroke} />
            </Button>
          }
        >
          <MenuItem
            tone="danger"
            onClick={() => {
              more.close()
              clearTool()
            }}
          >
            {copy.enology.clear}
          </MenuItem>
        </GlassMenu>
      </RecordBar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-5 pb-8 sm:px-8">
          <header>
            <h1 className="text-body font-medium text-ink-900">{copy.enology.title}</h1>
          </header>
          <SectionTabs label={copy.enology.title} tabs={TABS} value={tab} onChange={choose} />
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <form
            id="enologia-calc"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void run()
            }}
          >
            {tab === 'so2' ? (
              <So2Fields
                showEntity={showEntity}
                entities={entities}
                entityId={entityId}
                onEntity={chooseEntity}
                ph={ph}
                free={free}
                volume={volume}
                wine={wine}
                product={product}
                percent={percent}
                sugar={sugar}
                total={total}
                target={target}
                noSulfites={noSulfites}
                errors={errors}
                onPh={setPh}
                onFree={setFree}
                onVolume={setVolume}
                onWine={setWine}
                onProduct={setProduct}
                onPercent={setPercent}
                onSugar={setSugar}
                onTotal={setTotal}
                onTarget={setTarget}
                onNoSulfites={setNoSulfites}
              />
            ) : null}
            {tab === 'cold' ? (
              <Field id="enologia-grado" label={copy.enology.fields.alcohol} error={errors.alcohol_pct}>
                <Input
                  id="enologia-grado"
                  inputMode="decimal"
                  autoComplete="off"
                  invalid={Boolean(errors.alcohol_pct)}
                  value={alcohol}
                  suffix={<Unit>{copy.enology.units.vol}</Unit>}
                  onChange={(event) => setAlcohol(event.target.value)}
                />
              </Field>
            ) : null}
            {tab === 'alcohol' ? (
              <>
                {showEntity ? (
                  <SegmentedControl
                    aria-label={copy.entity.label}
                    value={entityId}
                    onChange={chooseEntity}
                    options={entities.map((entity) => ({ value: entity.id, content: entityShort(entity.code) }))}
                  />
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="enologia-azucares" label={copy.enology.fields.sugars} error={errors.sugars_g_l}>
                    <Input
                      id="enologia-azucares"
                      inputMode="decimal"
                      autoComplete="off"
                      invalid={Boolean(errors.sugars_g_l)}
                      value={sugars}
                      suffix={<Unit>{copy.enology.units.gL}</Unit>}
                      onChange={(event) => setSugars(event.target.value)}
                    />
                  </Field>
                  <Field id="enologia-densidad" label={copy.enology.fields.density} error={errors.density_g_l}>
                    <Input
                      id="enologia-densidad"
                      inputMode="decimal"
                      autoComplete="off"
                      invalid={Boolean(errors.density_g_l)}
                      value={density}
                      suffix={<Unit>{copy.enology.units.gL}</Unit>}
                    onChange={(event) => setDensity(event.target.value)}
                  />
                </Field>
              </div>
              {errors.body ? <p className="text-caption text-danger-600">{errors.body}</p> : null}
            </>
          ) : null}
            {tab === 'blend' ? (
              <BlendFields
                targetVolume={targetVolume}
                parts={parts}
                options={vesselOptions}
                loading={vessels.loading}
                failed={Boolean(vessels.error)}
                onRetry={vessels.reload}
                errors={errors}
                rowMenu={rowMenu}
                onRowMenu={setRowMenu}
                onTarget={setTargetVolume}
                onParts={setParts}
              />
            ) : null}
          </form>

          <div ref={resultRef}>
            {tab === 'so2' && so2 ? <So2Readout result={so2} /> : null}
            {tab === 'cold' && cold ? <ColdReadout result={cold} /> : null}
            {tab === 'alcohol' && probable ? <AlcoholReadout result={probable} /> : null}
            {tab === 'blend' && blend ? <BlendReadout result={blend} /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function validate(
  tab: Tool,
  value: {
    ph: string
    free: string
    volume: string
    percent: string
    product: ProductKind
    sugar: string
    total: string
    target: string
    alcohol: string
    sugars: string
    density: string
    targetVolume: string
    parts: BlendRow[]
  },
): Record<string, string> {
  const errors: Record<string, string> = {}
  const need = (text: string, key: string) => {
    if (toApiDecimal(text) == null) errors[key] = copy.enology.number
  }
  const optional = (text: string, key: string) => {
    if (text.trim() !== '' && toApiDecimal(text) == null) errors[key] = copy.enology.number
  }
  if (tab === 'so2') {
    need(value.ph, 'ph')
    need(value.free, 'free_so2_mg_l')
    need(value.volume, 'volume_l')
    if (value.product === 'solution') need(value.percent, 'product.so2_percent')
    optional(value.sugar, 'residual_sugar_g_l')
    optional(value.total, 'total_so2_mg_l')
    optional(value.target, 'molecular_target_mg_l')
  } else if (tab === 'cold') {
    need(value.alcohol, 'alcohol_pct')
  } else if (tab === 'alcohol') {
    if (value.sugars.trim() === '' && value.density.trim() === '') errors.body = copy.enology.either
    optional(value.sugars, 'sugars_g_l')
    optional(value.density, 'density_g_l')
  } else {
    need(value.targetVolume, 'target_volume_l')
    value.parts.forEach((row, index) => {
      if (!row.vesselId) errors[`components.${index}.vessel_id`] = copy.enology.fields.vessel
      if (toApiDecimal(row.pipette) == null) errors[`components.${index}.volume_ml`] = copy.enology.number
    })
  }
  return errors
}

function So2Fields(props: {
  showEntity: boolean
  entities: Me['entities']
  entityId: string
  onEntity: (id: string) => void
  ph: string
  free: string
  volume: string
  wine: WineColor
  product: ProductKind
  percent: string
  sugar: string
  total: string
  target: string
  noSulfites: boolean
  errors: Record<string, string>
  onPh: (value: string) => void
  onFree: (value: string) => void
  onVolume: (value: string) => void
  onWine: (value: WineColor) => void
  onProduct: (value: ProductKind) => void
  onPercent: (value: string) => void
  onSugar: (value: string) => void
  onTotal: (value: string) => void
  onTarget: (value: string) => void
  onNoSulfites: (value: boolean) => void
}) {
  return (
    <>
      {props.showEntity ? (
        <SegmentedControl
          aria-label={copy.entity.label}
          value={props.entityId}
          onChange={props.onEntity}
          options={props.entities.map((entity) => ({ value: entity.id, content: entityShort(entity.code) }))}
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="enology-ph" label={copy.enology.fields.ph} error={props.errors.ph}>
          <Input
            id="enology-ph"
            inputMode="decimal"
            autoComplete="off"
            invalid={Boolean(props.errors.ph)}
            value={props.ph}
            onChange={(event) => props.onPh(event.target.value)}
          />
        </Field>
        <Field id="enology-libre" label={copy.enology.fields.free} error={props.errors.free_so2_mg_l}>
          <Input
            id="enology-libre"
            inputMode="decimal"
            autoComplete="off"
            invalid={Boolean(props.errors.free_so2_mg_l)}
            value={props.free}
            suffix={<Unit>{copy.enology.units.mgL}</Unit>}
            onChange={(event) => props.onFree(event.target.value)}
          />
        </Field>
      </div>
      <Field id="enology-volumen" label={copy.enology.fields.volume} error={props.errors.volume_l}>
        <Input
          id="enology-volumen"
          inputMode="decimal"
          autoComplete="off"
          invalid={Boolean(props.errors.volume_l)}
          value={props.volume}
          suffix={<Unit>{copy.enology.units.litre}</Unit>}
          onChange={(event) => props.onVolume(event.target.value)}
        />
      </Field>
      <Choice label={copy.enology.fields.type}>
        <SegmentedControl
          aria-label={copy.enology.fields.type}
          value={props.wine}
          onChange={props.onWine}
          options={[
            { value: 'tinto', content: copy.enology.wine.tinto },
            { value: 'blanco', content: copy.enology.wine.blanco },
            { value: 'rosado', content: copy.enology.wine.rosado },
          ]}
        />
      </Choice>
      <Choice label={copy.enology.fields.product}>
        <SegmentedControl
          aria-label={copy.enology.fields.product}
          value={props.product}
          onChange={props.onProduct}
          options={[
            { value: 'potassium_metabisulfite', content: copy.enology.product.meta },
            { value: 'solution', content: copy.enology.product.solution },
          ]}
        />
      </Choice>
      {props.product === 'solution' ? (
        <Field id="enology-porcentaje" label={copy.enology.fields.percent} error={props.errors['product.so2_percent']}>
          <Input
            id="enology-porcentaje"
            inputMode="decimal"
            autoComplete="off"
            invalid={Boolean(props.errors['product.so2_percent'])}
            value={props.percent}
            suffix={<Unit>%</Unit>}
            onChange={(event) => props.onPercent(event.target.value)}
          />
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="enology-azucar" label={copy.enology.fields.sugar} error={props.errors.residual_sugar_g_l}>
          <Input
            id="enology-azucar"
            inputMode="decimal"
            autoComplete="off"
            invalid={Boolean(props.errors.residual_sugar_g_l)}
            value={props.sugar}
            suffix={<Unit>{copy.enology.units.gL}</Unit>}
            onChange={(event) => props.onSugar(event.target.value)}
          />
        </Field>
        <Field id="enology-total" label={copy.enology.fields.total} error={props.errors.total_so2_mg_l}>
          <Input
            id="enology-total"
            inputMode="decimal"
            autoComplete="off"
            invalid={Boolean(props.errors.total_so2_mg_l)}
            value={props.total}
            suffix={<Unit>{copy.enology.units.mgL}</Unit>}
            onChange={(event) => props.onTotal(event.target.value)}
          />
        </Field>
      </div>
      <Field id="enology-objetivo" label={copy.enology.fields.target} error={props.errors.molecular_target_mg_l}>
        <Input
          id="enology-objetivo"
          inputMode="decimal"
          autoComplete="off"
          invalid={Boolean(props.errors.molecular_target_mg_l)}
          value={props.target}
          suffix={<Unit>{copy.enology.units.mgL}</Unit>}
          onChange={(event) => props.onTarget(event.target.value)}
        />
      </Field>
      <Checkbox checked={props.noSulfites} label={copy.enology.fields.noSulfites} onChange={props.onNoSulfites} />
      {props.errors.body ? <p className="text-caption text-danger-600">{props.errors.body}</p> : null}
    </>
  )
}

function BlendFields(props: {
  targetVolume: string
  parts: BlendRow[]
  options: Vessel[]
  loading: boolean
  failed: boolean
  onRetry: () => void
  errors: Record<string, string>
  rowMenu: string | null
  onRowMenu: (key: string | null) => void
  onTarget: (value: string) => void
  onParts: (value: BlendRow[]) => void
}) {
  if (props.loading && props.options.length === 0) {
    return (
      <div aria-busy="true" className="grid gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (props.failed) {
    return (
      <div className="grid gap-3">
        <Alert tone="danger">{copy.error.load}</Alert>
        <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={props.onRetry}>
          {copy.error.retry}
        </Button>
      </div>
    )
  }
  if (props.options.length === 0) {
    return <EmptyState title={copy.enology.noVessels} description={copy.enology.noVesselsHint} />
  }
  return (
    <>
      <Field id="enologia-corte-volumen" label={copy.enology.fields.targetVolume} error={props.errors.target_volume_l}>
        <Input
          id="enologia-corte-volumen"
          inputMode="decimal"
          autoComplete="off"
          invalid={Boolean(props.errors.target_volume_l)}
          value={props.targetVolume}
          suffix={<Unit>{copy.enology.units.litre}</Unit>}
          onChange={(event) => props.onTarget(event.target.value)}
        />
      </Field>
      <ul className="grid gap-3">
        {props.parts.map((row, index) => (
          <li key={row.key} className="grid gap-3 rounded-2xl border border-border-subtle px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label font-medium text-ink-900">{fill(copy.enology.part, { n: String(index + 1) })}</span>
              <GlassMenu
                open={props.rowMenu === row.key}
                onOpenChange={(open) => props.onRowMenu(open ? row.key : null)}
                placement="bottom-end"
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={copy.enology.more}
                    onClick={() => props.onRowMenu(props.rowMenu === row.key ? null : row.key)}
                  >
                    <MoreVertical strokeWidth={iconStroke} />
                  </Button>
                }
              >
                <MenuItem
                  tone="danger"
                  disabled={props.parts.length <= 2}
                  onClick={() => {
                    props.onRowMenu(null)
                    props.onParts(props.parts.filter((item) => item.key !== row.key))
                  }}
                >
                  {copy.enology.remove}
                </MenuItem>
              </GlassMenu>
            </div>
            <Field id={`enologia-deposito-${index}`} label={copy.enology.fields.vessel} error={props.errors[`components.${index}.vessel_id`]}>
              <Select
                id={`enologia-deposito-${index}`}
                className="w-full"
                value={row.vesselId}
                onChange={(event) =>
                  props.onParts(props.parts.map((item) => (item.key === row.key ? { ...item, vesselId: event.target.value } : item)))
                }
              >
                <option value="">{copy.enology.fields.vessel}</option>
                {props.options.map((vessel) => (
                  <option key={vessel.id} value={vessel.id}>
                    {vessel.code} · {formatLitres(vessel.volume_ml / 1000)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id={`enologia-pipeta-${index}`} label={copy.enology.fields.pipette} error={props.errors[`components.${index}.volume_ml`]}>
              <Input
                id={`enologia-pipeta-${index}`}
                inputMode="decimal"
                autoComplete="off"
                invalid={Boolean(props.errors[`components.${index}.volume_ml`])}
                value={row.pipette}
                suffix={<Unit>{copy.enology.units.ml}</Unit>}
                onChange={(event) =>
                  props.onParts(props.parts.map((item) => (item.key === row.key ? { ...item, pipette: event.target.value } : item)))
                }
              />
            </Field>
          </li>
        ))}
      </ul>
      {props.parts.length < 12 ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-fit"
          onClick={() => props.onParts([...props.parts, blankPart()])}
        >
          {copy.enology.addPart}
        </Button>
      ) : null}
    </>
  )
}

function So2Readout({ result }: { result: So2Result }) {
  const unit = result.product.unit === 'g' ? copy.enology.units.gram : copy.enology.units.ml
  return (
    <div className="grid gap-4" aria-live="polite">
      <Warnings items={result.warnings} />
      <div className="grid grid-cols-2 gap-2">
        <Metric label={copy.enology.result.needed} value={`${esQty(result.free_so2_needed_mg_l)} ${copy.enology.units.mgL}`} />
        <Metric label={copy.enology.result.add} value={`${esQty(result.free_so2_to_add_mg_l)} ${copy.enology.units.mgL}`} />
        <Metric label={copy.enology.result.dose} value={`${esQty(result.product.quantity)} ${unit}`} />
        <Metric
          label={copy.enology.result.resulting}
          value={result.resulting_total_so2_mg_l ? `${esQty(result.resulting_total_so2_mg_l)} ${copy.enology.units.mgL}` : copy.enology.noFigure}
        />
      </div>
      <div className="rounded-2xl border border-border-subtle px-4">
        <DefaultLine
          label={copy.enology.result.molecular}
          value={`${esQty(result.molecular_target.value)} ${copy.enology.units.mgL}`}
          status={result.molecular_target.status_label}
          source={result.molecular_target.source_ref}
        />
        <DefaultLine
          label={copy.enology.result.organic}
          value={limitText(result.limits.organic.limit_mg_l)}
          status={result.limits.organic.status_label}
          source={result.limits.organic.source_ref}
        />
        <DefaultLine
          label={copy.enology.result.legal}
          value={limitText(result.limits.legal.limit_mg_l)}
          status={result.limits.legal.status_label}
          source={result.limits.legal.source_ref}
        />
      </div>
      <Formula lines={[result.formula, copy.enology.qtyFormula]} source={result.pka.source_ref} />
    </div>
  )
}

function ColdReadout({ result }: { result: ColdResult }) {
  return (
    <div className="grid gap-4" aria-live="polite">
      <div className="grid grid-cols-2 gap-2">
        <Metric label={copy.enology.fields.alcohol} value={`${esQty(result.alcohol_pct)} ${copy.enology.units.vol}`} />
        <Metric label={copy.enology.result.temperature} value={`${esQty(result.temperature_c)} ${copy.enology.units.temp}`} />
      </div>
      <Formula lines={[result.formula]} source={result.source_ref} />
    </div>
  )
}

function AlcoholReadout({ result }: { result: AlcoholResult }) {
  const lines = [
    result.from_sugars ? `grado = azúcares / ${esQty(result.from_sugars.factor)}` : null,
    result.from_density ? `grado = (densidad − 1000) / ${esQty(result.from_density.factor)}` : null,
  ].filter((line): line is string => line != null)
  return (
    <div className="grid gap-4" aria-live="polite">
      <Warnings items={result.warnings} />
      <div className="grid grid-cols-2 gap-2">
        {result.from_sugars ? (
          <Metric label={copy.enology.result.fromSugars} value={`${esQty(result.from_sugars.alcohol_pct)} ${copy.enology.units.vol}`} />
        ) : null}
        {result.from_density ? (
          <Metric label={copy.enology.result.fromDensity} value={`${esQty(result.from_density.alcohol_pct)} ${copy.enology.units.vol}`} />
        ) : null}
      </div>
      {result.from_density ? (
        <div className="rounded-2xl border border-border-subtle px-4">
          <DefaultLine
            label={copy.enology.result.factor}
            value={esQty(result.from_density.factor)}
            status={result.from_density.factor_status_label}
            source={result.from_density.source_ref}
          />
        </div>
      ) : null}
      <Formula lines={lines} source={result.from_sugars?.source_ref} />
    </div>
  )
}

function BlendReadout({ result }: { result: BlendResult }) {
  return (
    <div className="grid gap-4" aria-live="polite">
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
        {result.components.map((row, index) => (
          <li key={`${row.vessel_id ?? 'x'}-${index}`} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-label font-medium text-ink-900">{row.label || fill(copy.enology.part, { n: String(index + 1) })}</p>
              <p className="text-caption tabular-nums text-text-secondary">
                {esQty(row.percent)} % · {esQty(row.volume_l)} {copy.enology.units.litre}
              </p>
              {row.available_ml != null ? (
                <p className="text-caption tabular-nums text-text-tertiary">
                  {copy.enology.result.stock} {esQty(row.available_ml)} {copy.enology.units.ml}
                </p>
              ) : null}
            </div>
            {row.sufficient === false ? <Badge tone="warning">{copy.enology.result.short}</Badge> : null}
            {row.sufficient === true ? <Badge tone="success">{copy.enology.result.ok}</Badge> : null}
          </li>
        ))}
      </ul>
      <Warnings items={result.warnings} />
      <Formula lines={[copy.enology.blendFormula]} note={result.rounding} />
    </div>
  )
}

function limitText(value: string | null): string {
  if (!value) return copy.enology.noFigure
  return `${esQty(value)} ${copy.enology.units.mgL}`
}

function Warnings({ items }: { items: Warning[] }) {
  if (items.length === 0) return null
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <Alert key={item.code} tone={item.severity === 'warning' ? 'warning' : item.severity === 'error' ? 'danger' : 'info'}>
          {item.message}
        </Alert>
      ))}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border-subtle px-3 py-2">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="text-label font-medium break-words text-ink-900 tabular-nums">{value}</p>
    </div>
  )
}

function DefaultLine({
  label,
  value,
  status,
  source,
}: {
  label: string
  value: string
  status?: string | null
  source?: string | null
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-caption text-text-tertiary">
          {label}
          {source ? <InfoTip label={label}>{source}</InfoTip> : null}
        </p>
        <p className="text-label text-ink-900 tabular-nums">{value}</p>
      </div>
      {status === 'pendiente de confirmar' ? (
        <Badge tone="warning" className="shrink-0">
          {copy.enology.pending}
        </Badge>
      ) : null}
    </div>
  )
}

function Formula({ lines, source, note }: { lines: string[]; source?: string | null; note?: string | null }) {
  return (
    <div className="grid gap-1">
      <p className="flex items-center gap-1.5 text-caption text-text-tertiary">
        {copy.enology.formula}
        {source ? <InfoTip label={copy.enology.source}>{source}</InfoTip> : null}
      </p>
      {lines.map((line) => (
        <p key={line} className="font-mono text-caption break-words text-text-secondary">
          {line}
        </p>
      ))}
      {note ? <p className="text-caption text-text-tertiary">{note}</p> : null}
    </div>
  )
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="grid min-w-0 gap-1.5 text-label font-medium text-ink-900">
      {label}
      {children}
      {error ? <span className="text-caption font-normal text-danger-600">{error}</span> : null}
    </label>
  )
}

function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-label font-medium text-ink-900">{label}</span>
      <div className="max-w-full overflow-x-auto">{children}</div>
    </div>
  )
}

function Unit({ children }: { children: string }) {
  return <span className="text-caption text-text-tertiary">{children}</span>
}
