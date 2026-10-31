export type Basis = 'hecho' | 'supuesto' | 'pendiente';

export type StatusLabel = 'hecho' | 'confirmado' | 'pendiente de confirmar';

export type WineColor = 'tinto' | 'blanco' | 'rosado';

export type SugarBand = 'lt_2' | 'from_2_to_5' | 'gte_5';

export type So2Scope = 'organic' | 'legal';

export type ProductState = 'grape' | 'must' | 'wine' | 'packaged_unlabeled' | 'packaged_labeled';

export type CellarProcess =
  | 'reception'
  | 'crushing_pressing'
  | 'fermentation'
  | 'racking'
  | 'filtration'
  | 'stabilisation'
  | 'aging_barrel'
  | 'bottling';

export interface ParameterView {
  code: string;
  value: string | null;
  value_text: string | null;
  unit: string | null;
  basis: Basis;
  status_label: StatusLabel;
  source_ref: string;
  valid_from: string;
  pending: boolean;
}

export interface So2LimitView {
  scope: So2Scope;
  wine_color: WineColor;
  sugar_band: SugarBand;
  sugar_min_g_l: string;
  sugar_max_g_l: string | null;
  limit_mg_l: string | null;
  basis: Basis;
  status_label: StatusLabel;
  source_ref: string;
  note: string | null;
  valid_from: string;
  pending: boolean;
}

export interface LossToleranceView {
  process: CellarProcess;
  product_state: ProductState;
  max_pct: string | null;
  basis: Basis;
  status_label: StatusLabel;
  source_ref: string;
  valid_from: string;
  pending: boolean;
}

export interface PracticeView {
  name_es: string;
  name_key: string;
  match_terms: string[];
  active: boolean;
  basis: Basis;
  status_label: StatusLabel;
  source_ref: string;
  pending: boolean;
}

export interface RequiredAnalysisView {
  parameter_code: string;
  name_es: string;
  active: boolean;
  sort_order: number;
}

export interface SettingsView {
  legal_entity_id: string;
  parameters: ParameterView[];
  so2_limits: So2LimitView[];
  loss_tolerances: LossToleranceView[];
  prohibited_practices: PracticeView[];
  required_analysis: RequiredAnalysisView[];
  pending_confirmation: string[];
}

export interface Warning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export function statusLabel(basis: Basis, confirmed: boolean): StatusLabel {
  if (basis === 'hecho') return 'hecho';
  if (confirmed) return 'confirmado';
  return 'pendiente de confirmar';
}

export function isPending(basis: Basis, confirmed: boolean): boolean {
  return basis !== 'hecho' && !confirmed;
}

export function pendingKeys(view: Omit<SettingsView, 'pending_confirmation'>): string[] {
  const keys: string[] = [];
  for (const row of view.parameters) {
    if (row.pending) keys.push(`parameter:${row.code}`);
  }
  for (const row of view.so2_limits) {
    if (row.pending) keys.push(`so2:${row.scope}:${row.wine_color}:${row.sugar_band}`);
  }
  for (const row of view.loss_tolerances) {
    if (row.pending) keys.push(`loss:${row.process}:${row.product_state}`);
  }
  for (const row of view.prohibited_practices) {
    if (row.pending) keys.push(`practice:${row.name_key}`);
  }
  return keys;
}
