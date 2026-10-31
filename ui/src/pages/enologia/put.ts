import { copy } from '@/i18n'
import { NULLABLE_CODES, TEXT_CODES } from '@/pages/enologia/labels'
import { canonicalQty, sameQty } from '@/pages/enologia/qty'
import type {
  Basis,
  CellarProcess,
  LossPut,
  LossToleranceView,
  ParameterPut,
  ParameterView,
  PracticeView,
  ProductState,
  RequiredAnalysisView,
  SettingsPut,
  SettingsView,
  So2LimitView,
  So2Put,
  So2Scope,
  SugarBand,
  WineColor,
} from '@/pages/enologia/types'

export type ParamDraft = {
  code: string
  value: string
  valueText: string | null
  source: string
  confirm: boolean
  basis: Basis
  unit: string | null
}

export type So2Draft = {
  scope: So2Scope
  wine_color: WineColor
  sugar_band: SugarBand
  limit: string
  source: string
  confirm: boolean
  basis: Basis
  note: string | null
}

export type LossDraft = {
  process: CellarProcess
  product_state: ProductState
  max: string
  source: string
  confirm: boolean
  basis: Basis
}

export type PracticeDraft = {
  name_es: string
  name_key: string
  active: boolean
  confirm: boolean
  basis: Basis
  source: string
  pending: boolean
}

export type RequiredDraft = {
  parameter_code: string
  name_es: string
  active: boolean
  sort_order: number
}

export type Draft = {
  parameters: ParamDraft[]
  so2: So2Draft[]
  loss: LossDraft[]
  practices: PracticeDraft[]
  required: RequiredDraft[]
  newPractice: string
}

export function draftFrom(view: SettingsView): Draft {
  return {
    parameters: view.parameters.map(paramDraft),
    so2: view.so2_limits.map(so2Draft),
    loss: view.loss_tolerances.map(lossDraft),
    practices: view.prohibited_practices.map(practiceDraft),
    required: view.required_analysis.map(requiredDraft),
    newPractice: '',
  }
}

export function paramDraft(row: ParameterView): ParamDraft {
  return {
    code: row.code,
    value: row.value == null ? '' : displayQty(row.value),
    valueText: row.value_text,
    source: row.source_ref,
    confirm: row.basis !== 'hecho' && !row.pending,
    basis: row.basis,
    unit: row.unit,
  }
}

export function so2Draft(row: So2LimitView): So2Draft {
  return {
    scope: row.scope,
    wine_color: row.wine_color,
    sugar_band: row.sugar_band,
    limit: row.limit_mg_l == null ? '' : displayQty(row.limit_mg_l),
    source: row.source_ref,
    confirm: row.basis !== 'hecho' && !row.pending,
    basis: row.basis,
    note: row.note,
  }
}

export function lossDraft(row: LossToleranceView): LossDraft {
  return {
    process: row.process,
    product_state: row.product_state,
    max: row.max_pct == null ? '' : displayQty(row.max_pct),
    source: row.source_ref,
    confirm: row.basis !== 'hecho' && !row.pending,
    basis: row.basis,
  }
}

function practiceDraft(row: PracticeView): PracticeDraft {
  return {
    name_es: row.name_es,
    name_key: row.name_key,
    active: row.active,
    confirm: row.basis !== 'hecho' && !row.pending,
    basis: row.basis,
    source: row.source_ref,
    pending: row.pending,
  }
}

function requiredDraft(row: RequiredAnalysisView): RequiredDraft {
  return { ...row }
}

function displayQty(value: string): string {
  return value.includes('.') ? value.replace('.', ',') : value
}

function sourceProblem(text: string): string | null {
  const length = text.trim().length
  if (length < 5 || length > 400) return copy.enology.sourceLength
  return null
}

function confirmedNow(basis: Basis, pending: boolean): boolean {
  return basis !== 'hecho' && !pending
}

export function buildSettingsPut(
  entityId: string,
  server: SettingsView,
  draft: Draft,
): { body: SettingsPut | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const parameters = draft.parameters.flatMap((row) => {
    const current = server.parameters.find((item) => item.code === row.code)
    if (!current) return []
    const key = `parameter:${row.code}`
    const messages: string[] = []
    const textMode = TEXT_CODES.has(row.code)
    const nullable = NULLABLE_CODES.has(row.code)
    let valueChanged = false
    let nextValue: string | null = null
    let nextText: string | null = null
    if (textMode) {
      nextText = row.valueText
      if (nextText !== 'warning' && nextText !== 'block') messages.push(copy.enology.number)
      valueChanged = nextText !== current.value_text
    } else {
      const parsed = canonicalQty(row.value)
      if (parsed === undefined || (parsed === null && !nullable)) messages.push(copy.enology.number)
      else {
        nextValue = parsed
        valueChanged = !sameQty(row.value, current.value)
      }
    }
    const sourceChanged = row.source.trim() !== current.source_ref
    if (sourceChanged) {
      const problem = sourceProblem(row.source)
      if (problem) messages.push(problem)
    }
    const wasConfirmed = confirmedNow(current.basis, current.pending)
    const confirmChanged = row.basis !== 'hecho' && row.confirm !== wasConfirmed
    if (messages.length > 0) {
      errors[key] = messages.join(' ')
      return []
    }
    if (!valueChanged && !sourceChanged && !confirmChanged) return []
    const patch: ParameterPut = { code: row.code }
    if (textMode && valueChanged && nextText) patch.value_text = nextText
    if (!textMode && valueChanged) patch.value = nextValue
    if (sourceChanged) patch.source_ref = row.source.trim()
    if (row.confirm && (valueChanged || confirmChanged)) patch.confirm = true
    else if (!row.confirm && confirmChanged && !valueChanged) patch.confirm = false
    return [patch]
  })

  const so2 = draft.so2.flatMap((row) => {
    const current = server.so2_limits.find(
      (item) => item.scope === row.scope && item.wine_color === row.wine_color && item.sugar_band === row.sugar_band,
    )
    if (!current) return []
    const key = `so2:${row.scope}:${row.wine_color}:${row.sugar_band}`
    const messages: string[] = []
    const parsed = canonicalQty(row.limit)
    if (parsed === undefined) messages.push(copy.enology.number)
    const valueChanged = parsed !== undefined && !sameQty(row.limit, current.limit_mg_l)
    const sourceChanged = row.source.trim() !== current.source_ref
    if (sourceChanged) {
      const problem = sourceProblem(row.source)
      if (problem) messages.push(problem)
    }
    const wasConfirmed = confirmedNow(current.basis, current.pending)
    const confirmChanged = row.basis !== 'hecho' && row.confirm !== wasConfirmed
    if (messages.length > 0) {
      errors[key] = messages.join(' ')
      return []
    }
    if (!valueChanged && !sourceChanged && !confirmChanged) return []
    const patch: So2Put = {
      scope: row.scope,
      wine_color: row.wine_color,
      sugar_band: row.sugar_band,
    }
    if (valueChanged) patch.limit_mg_l = parsed ?? null
    if (sourceChanged) patch.source_ref = row.source.trim()
    if (row.confirm && parsed != null && (valueChanged || confirmChanged)) patch.confirm = true
    else if (!row.confirm && confirmChanged && !valueChanged) patch.confirm = false
    return [patch]
  })

  const loss = draft.loss.flatMap((row) => {
    const current = server.loss_tolerances.find(
      (item) => item.process === row.process && item.product_state === row.product_state,
    )
    if (!current) return []
    const key = `loss:${row.process}:${row.product_state}`
    const messages: string[] = []
    const parsed = canonicalQty(row.max)
    if (parsed === undefined) messages.push(copy.enology.number)
    const valueChanged = parsed !== undefined && !sameQty(row.max, current.max_pct)
    const sourceChanged = row.source.trim() !== current.source_ref
    if (parsed != null && current.max_pct == null && !sourceChanged) messages.push(copy.enology.sourceNeeded)
    if (sourceChanged || (parsed != null && current.max_pct == null)) {
      const problem = sourceProblem(row.source)
      if (problem) messages.push(problem)
    }
    const wasConfirmed = confirmedNow(current.basis, current.pending)
    const confirmChanged = row.basis !== 'hecho' && row.confirm !== wasConfirmed
    if (messages.length > 0) {
      errors[key] = messages.join(' ')
      return []
    }
    if (!valueChanged && !sourceChanged && !confirmChanged) return []
    const patch: LossPut = {
      process: row.process,
      product_state: row.product_state,
    }
    if (valueChanged) patch.max_pct = parsed ?? null
    if (sourceChanged) patch.source_ref = row.source.trim()
    if (row.confirm && parsed != null && (valueChanged || confirmChanged)) patch.confirm = true
    else if (!row.confirm && confirmChanged && !valueChanged) patch.confirm = false
    return [patch]
  })

  const practices = draft.practices.flatMap((row) => {
    const current = server.prohibited_practices.find((item) => item.name_key === row.name_key)
    if (!current) return []
    const wasConfirmed = confirmedNow(current.basis, current.pending)
    const confirmChanged = row.basis !== 'hecho' && row.confirm !== wasConfirmed
    const activeChanged = row.active !== current.active
    if (!activeChanged && !confirmChanged) return []
    const patch: NonNullable<SettingsPut['prohibited_practices']>[number] = {
      name_es: current.name_es,
      active: row.active,
    }
    if (row.confirm && confirmChanged) patch.confirm = true
    else if (!row.confirm && confirmChanged) patch.confirm = false
    return [patch]
  })

  const named = draft.newPractice.trim()
  if (named !== '') {
    if (named.length < 3 || named.length > 80) errors['practice:new'] = copy.enology.practiceName
    else practices.push({ name_es: named, active: true })
  }

  const required = draft.required.flatMap((row) => {
    const current = server.required_analysis.find((item) => item.parameter_code === row.parameter_code)
    if (!current || current.active === row.active) return []
    return [{ parameter_code: row.parameter_code, active: row.active }]
  })

  if (Object.keys(errors).length > 0) return { body: null, errors }
  const body: SettingsPut = { legal_entity_id: entityId }
  if (parameters.length > 0) body.parameters = parameters
  if (so2.length > 0) body.so2_limits = so2
  if (loss.length > 0) body.loss_tolerances = loss
  if (practices.length > 0) body.prohibited_practices = practices
  if (required.length > 0) body.required_analysis = required
  const changed = Object.keys(body).length > 1
  return { body: changed ? body : null, errors }
}
