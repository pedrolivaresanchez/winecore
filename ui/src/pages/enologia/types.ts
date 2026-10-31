export type Basis = 'hecho' | 'supuesto' | 'pendiente'

export type StatusLabel = 'hecho' | 'confirmado' | 'pendiente de confirmar' | string

export type WineColor = 'tinto' | 'blanco' | 'rosado'

export type SugarBand = 'lt_2' | 'from_2_to_5' | 'gte_5'

export type So2Scope = 'organic' | 'legal'

export type ProductState = 'grape' | 'must' | 'wine' | 'packaged_unlabeled' | 'packaged_labeled'

export type CellarProcess =
  | 'reception'
  | 'crushing_pressing'
  | 'fermentation'
  | 'racking'
  | 'filtration'
  | 'stabilisation'
  | 'aging_barrel'
  | 'bottling'

export type Warning = {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

export type ParameterView = {
  code: string
  value: string | null
  value_text: string | null
  unit: string | null
  basis: Basis
  status_label: StatusLabel
  source_ref: string
  valid_from: string
  pending: boolean
}

export type So2LimitView = {
  scope: So2Scope
  wine_color: WineColor
  sugar_band: SugarBand
  sugar_min_g_l: string
  sugar_max_g_l: string | null
  limit_mg_l: string | null
  basis: Basis
  status_label: StatusLabel
  source_ref: string
  note: string | null
  valid_from: string
  pending: boolean
}

export type LossToleranceView = {
  process: CellarProcess
  product_state: ProductState
  max_pct: string | null
  basis: Basis
  status_label: StatusLabel
  source_ref: string
  valid_from: string
  pending: boolean
}

export type PracticeView = {
  name_es: string
  name_key: string
  match_terms: string[]
  active: boolean
  basis: Basis
  status_label: StatusLabel
  source_ref: string
  pending: boolean
}

export type RequiredAnalysisView = {
  parameter_code: string
  name_es: string
  active: boolean
  sort_order: number
}

export type SettingsView = {
  legal_entity_id: string
  parameters: ParameterView[]
  so2_limits: So2LimitView[]
  loss_tolerances: LossToleranceView[]
  prohibited_practices: PracticeView[]
  required_analysis: RequiredAnalysisView[]
  pending_confirmation: string[]
}

export type So2Product =
  | { kind: 'potassium_metabisulfite' }
  | { kind: 'solution'; so2_percent: string }

export type So2Request = {
  legal_entity_id?: string
  ph: string
  free_so2_mg_l: string
  volume_l: string
  wine_type: WineColor
  product: So2Product
  molecular_target_mg_l?: string
  total_so2_mg_l?: string
  residual_sugar_g_l?: string
  no_added_sulfites?: boolean
}

export type So2Result = {
  formula: string
  pka: { value: string; basis: string; status_label: string; source_ref: string }
  molecular_target: {
    code: string
    value: string
    basis: string
    status_label: string
    source_ref: string
    overridden: boolean
  }
  free_so2_needed_mg_l: string
  free_so2_to_add_mg_l: string
  dose_withheld: boolean
  product: {
    kind: 'potassium_metabisulfite' | 'solution'
    so2_percent: string
    so2_percent_basis: string
    concentration: string
    quantity: string
    unit: 'g' | 'ml'
  }
  resulting_total_so2_mg_l: string | null
  limits: {
    wine_type: WineColor
    sugar_band: SugarBand | null
    sugar_label: string | null
    organic: LimitSide
    legal: LimitSide
  }
  warnings: Warning[]
}

export type LimitSide = {
  limit_mg_l: string | null
  basis: string | null
  status_label: string | null
  source_ref: string | null
  note: string | null
}

export type ColdRequest = { alcohol_pct: string }

export type ColdResult = {
  formula: string
  basis: string
  source_ref: string
  alcohol_pct: string
  temperature_c: string
}

export type AlcoholRequest = {
  legal_entity_id?: string
  sugars_g_l?: string
  density_g_l?: string
}

export type AlcoholResult = {
  from_sugars: {
    sugars_g_l: string
    factor: string
    factor_basis: string
    source_ref: string
    alcohol_pct: string
  } | null
  from_density: {
    density_g_l: string
    factor: string
    factor_basis: string
    factor_status_label: string
    source_ref: string
    alcohol_pct: string
  } | null
  warnings: Warning[]
}

export type BlendRequest = {
  target_volume_l: string
  components: {
    label?: string | null
    volume_ml: string
    vessel_id?: string | null
    lot_id?: string | null
  }[]
}

export type BlendComponentResult = {
  label: string | null
  vessel_id: string | null
  lot_id: string | null
  pipette_ml: string
  percent: string
  volume_ml: string
  volume_l: string
  available_ml: string | null
  sufficient: boolean | null
}

export type BlendResult = {
  target_volume_l: string
  target_volume_ml: string
  rounding: string
  components: BlendComponentResult[]
  warnings: Warning[]
}

export type CheckFinding = {
  code: string
  severity: 'info' | 'warning' | 'error'
  blocks: boolean
  requires_reason: boolean
  reason_satisfied: boolean
  message: string
}

export type CheckResult = {
  ok: boolean
  findings: CheckFinding[]
}

export type CheckRequest = {
  legal_entity_id: string
  as_of?: string
  operation: {
    op_type: string
    process?: string | null
    product_state: ProductState
    input_volume_ml: string
    loss_volume_ml: string
    reason?: string | null
    additions?: { name: string; purpose?: string | null; is_so2?: boolean | null }[]
    practices?: string[]
  }
  lot?: {
    id?: string
    kind?: string | null
    has_volume?: boolean
    racked_this_winter?: boolean
    malolactic_finished?: boolean | null
    malic_acid_g_l?: string | null
    volatile_acidity_g_l?: string | null
    analyses?: { sampled_on: string; parameters: string[] }[]
  }
}

export type SettingsPut = {
  legal_entity_id: string
  parameters?: ParameterPut[]
  so2_limits?: So2Put[]
  loss_tolerances?: LossPut[]
  prohibited_practices?: PracticePut[]
  required_analysis?: RequiredPut[]
}

export type ParameterPut = {
  code: string
  value?: string | null
  value_text?: string
  source_ref?: string
  confirm?: boolean
}

export type So2Put = {
  scope: So2Scope
  wine_color: WineColor
  sugar_band: SugarBand
  limit_mg_l?: string | null
  source_ref?: string
  confirm?: boolean
}

export type LossPut = {
  process: CellarProcess
  product_state: ProductState
  max_pct?: string | null
  source_ref?: string
  confirm?: boolean
}

export type PracticePut = {
  name_es: string
  active?: boolean
  confirm?: boolean
}

export type RequiredPut = {
  parameter_code: string
  active: boolean
}
