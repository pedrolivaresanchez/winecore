import {
  isPending,
  pendingKeys,
  statusLabel,
  type Basis,
  type CellarProcess,
  type ParameterView,
  type PracticeView,
  type ProductState,
  type RequiredAnalysisView,
  type SettingsView,
  type So2LimitView,
  type So2Scope,
  type SugarBand,
  type WineColor,
  type LossToleranceView,
} from './types';

/** Plantilla global (entity_key cero). La fila de cada entidad la tapa al confirmar. */
export const TEMPLATE_ENTITY = '00000000-0000-0000-0000-000000000000';

export const VALID_FROM = '2026-01-01';

/** FACT: pKa del SO2 molecular a 20 °C. */
export const SO2_PKA = '1.81';

/** FACT: el metabisulfito potásico aporta un 57,6 % de SO2 teórico. */
export const KMS_SO2_PERCENT = '57.6';

/** FACT: grado probable (% vol) = azúcares (g/L) / 16,83. */
export const EU_SUGAR_FACTOR = '16.83';

/** HECHO etiquetado.md: «contiene sulfitos» si el SO2 total supera 10 mg/L. */
export const ALLERGEN_TOTAL_SO2_MG_L = '10';

/** FACT: T (°C) = -(grado alcohólico / 2 + 1). Regla del enólogo. */
export const COLD_SOURCE =
  'FACT de la reunión de arranque: T (C) = -(grado alcohólico / 2 + 1).';

export const SOURCE = {
  molecular:
    'SUPUESTO de la reunión de arranque: objetivo de SO2 molecular por tipo de vino. Pendiente de confirmar.',
  density: 'SUPUESTO de la reunión de arranque: (densidad g/L - 1000) / 7,5. Pendiente de confirmar.',
  va: 'SUPUESTO de la reunión de arranque: alerta de acidez volátil a 0,6 g/L de acético. Pendiente de confirmar.',
  vaLegal: 'docs/04-regulatorio no recoge un máximo legal de acidez volátil. El valor queda vacío.',
  dryness:
    'SUPUESTO de la reunión de arranque: glucosa + fructosa <= 2 g/L indica fin de fermentación. Pendiente de confirmar.',
  malic:
    'SUPUESTO de la reunión de arranque: málico <= 0,3 g/L indica fin de la fermentación maloláctica. Pendiente de confirmar.',
  freshness:
    'SUPUESTO de la reunión de arranque: la analítica de preembotellado caduca a los 30 días. Pendiente de confirmar.',
  mode:
    'SUPUESTO de la reunión de arranque: sin analítica fresca el embotellado avisa; se puede configurar para bloquear. Pendiente de confirmar.',
  winter: 'FACT de la reunión de arranque: el primer trasiego es tras el frío del invierno, en febrero y marzo.',
  bottlingSeason:
    'SUPUESTO: el recordatorio de embotellar empieza en junio, después de la primavera meteorológica, y sigue hasta diciembre. Pendiente de confirmar.',
  loss: 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.',
  so2RedDry:
    'HECHO docs/04-regulatorio/ecologico.md: tinto 100 mg/L con azúcar residual menor de 2 g/L (2021/1165 anexo V D).',
  so2WhiteDry:
    'HECHO docs/04-regulatorio/ecologico.md: blanco y rosado 150 mg/L con azúcar residual menor de 2 g/L (2021/1165 anexo V D).',
  so2RedMid:
    'SUPUESTO aritmético docs/04-regulatorio/ecologico.md: ejemplo tinto de 2 a 5 g/L, 120 mg/L (límite general menos 30). Pendiente de confirmar.',
  so2WhiteMid:
    'SUPUESTO aritmético docs/04-regulatorio/ecologico.md: ejemplo blanco y rosado de 2 a 5 g/L, 170 mg/L (límite general menos 30). Pendiente de confirmar.',
  so2High:
    'PENDIENTE docs/04-regulatorio/ecologico.md: para el resto de azúcares el límite ecológico es el general menos 30 mg/L, y el documento no da la cifra de esta banda.',
  so2Legal:
    'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
  carbon: 'Regla de casa de la reunión de arranque: los carbones activos están prohibidos.',
} as const;

const NOTE_MID = 'Cifra de ejemplo, pendiente de confirmar.';
const NOTE_HIGH = 'Sin cifra en la documentación para esta banda de azúcar.';
const NOTE_LEGAL = 'Sin cifra legal en la documentación regulatoria del repositorio.';

interface ParameterSeed {
  code: string;
  value: string | null;
  value_text: string | null;
  unit: string | null;
  basis: Basis;
  source_ref: string;
}

/** SUPUESTO salvo la ventana de febrero-marzo, que es la regla del enólogo (FACT). */
export const PARAMETER_SEEDS: readonly ParameterSeed[] = [
  { code: 'molecular_so2_tinto_mg_l', value: '0.5', value_text: null, unit: 'mg/L', basis: 'supuesto', source_ref: SOURCE.molecular },
  { code: 'molecular_so2_blanco_mg_l', value: '0.8', value_text: null, unit: 'mg/L', basis: 'supuesto', source_ref: SOURCE.molecular },
  { code: 'molecular_so2_rosado_mg_l', value: '0.8', value_text: null, unit: 'mg/L', basis: 'supuesto', source_ref: SOURCE.molecular },
  { code: 'density_alcohol_factor', value: '7.5', value_text: null, unit: 'factor', basis: 'supuesto', source_ref: SOURCE.density },
  { code: 'volatile_acidity_alert_g_l', value: '0.6', value_text: null, unit: 'g/L', basis: 'supuesto', source_ref: SOURCE.va },
  { code: 'volatile_acidity_legal_max_g_l', value: null, value_text: null, unit: 'g/L', basis: 'pendiente', source_ref: SOURCE.vaLegal },
  { code: 'dryness_glucose_fructose_g_l', value: '2', value_text: null, unit: 'g/L', basis: 'supuesto', source_ref: SOURCE.dryness },
  { code: 'malolactic_malic_g_l', value: '0.3', value_text: null, unit: 'g/L', basis: 'supuesto', source_ref: SOURCE.malic },
  { code: 'pre_bottling_freshness_days', value: '30', value_text: null, unit: 'd', basis: 'supuesto', source_ref: SOURCE.freshness },
  { code: 'bottling_analysis_mode', value: null, value_text: 'warning', unit: null, basis: 'supuesto', source_ref: SOURCE.mode },
  { code: 'winter_racking_month_from', value: '2', value_text: null, unit: 'mes', basis: 'hecho', source_ref: SOURCE.winter },
  { code: 'winter_racking_month_to', value: '3', value_text: null, unit: 'mes', basis: 'hecho', source_ref: SOURCE.winter },
  { code: 'bottling_reminder_month_from', value: '6', value_text: null, unit: 'mes', basis: 'supuesto', source_ref: SOURCE.bottlingSeason },
  { code: 'bottling_reminder_month_to', value: '12', value_text: null, unit: 'mes', basis: 'supuesto', source_ref: SOURCE.bottlingSeason },
];

export const PARAMETER_CODES = PARAMETER_SEEDS.map((row) => row.code);

interface So2Seed {
  scope: So2Scope;
  wine_color: WineColor;
  sugar_band: SugarBand;
  sugar_min_g_l: string;
  sugar_max_g_l: string | null;
  limit_mg_l: string | null;
  basis: Basis;
  source_ref: string;
  note: string | null;
}

function so2(
  scope: So2Scope,
  wine_color: WineColor,
  sugar_band: SugarBand,
  sugar_min_g_l: string,
  sugar_max_g_l: string | null,
  limit_mg_l: string | null,
  basis: Basis,
  source_ref: string,
  note: string | null,
): So2Seed {
  return { scope, wine_color, sugar_band, sugar_min_g_l, sugar_max_g_l, limit_mg_l, basis, source_ref, note };
}

const COLORS: readonly WineColor[] = ['tinto', 'blanco', 'rosado'];

export const SO2_SEEDS: readonly So2Seed[] = [
  so2('organic', 'tinto', 'lt_2', '0', '2', '100', 'hecho', SOURCE.so2RedDry, null),
  so2('organic', 'blanco', 'lt_2', '0', '2', '150', 'hecho', SOURCE.so2WhiteDry, null),
  so2('organic', 'rosado', 'lt_2', '0', '2', '150', 'hecho', SOURCE.so2WhiteDry, null),
  so2('organic', 'tinto', 'from_2_to_5', '2', '5', '120', 'supuesto', SOURCE.so2RedMid, NOTE_MID),
  so2('organic', 'blanco', 'from_2_to_5', '2', '5', '170', 'supuesto', SOURCE.so2WhiteMid, NOTE_MID),
  so2('organic', 'rosado', 'from_2_to_5', '2', '5', '170', 'supuesto', SOURCE.so2WhiteMid, NOTE_MID),
  ...COLORS.map((color) => so2('organic', color, 'gte_5', '5', null, null, 'pendiente', SOURCE.so2High, NOTE_HIGH)),
  ...COLORS.flatMap((color) => [
    so2('legal', color, 'lt_2', '0', '2', null, 'pendiente', SOURCE.so2Legal, NOTE_LEGAL),
    so2('legal', color, 'from_2_to_5', '2', '5', null, 'pendiente', SOURCE.so2Legal, NOTE_LEGAL),
    so2('legal', color, 'gte_5', '5', null, null, 'pendiente', SOURCE.so2Legal, NOTE_LEGAL),
  ]),
];

export const LOSS_SEEDS: readonly { process: CellarProcess; product_state: ProductState }[] = [
  { process: 'reception', product_state: 'grape' },
  { process: 'crushing_pressing', product_state: 'grape' },
  { process: 'crushing_pressing', product_state: 'must' },
  { process: 'fermentation', product_state: 'must' },
  { process: 'fermentation', product_state: 'wine' },
  { process: 'racking', product_state: 'must' },
  { process: 'racking', product_state: 'wine' },
  { process: 'filtration', product_state: 'wine' },
  { process: 'stabilisation', product_state: 'wine' },
  { process: 'aging_barrel', product_state: 'wine' },
  { process: 'bottling', product_state: 'wine' },
  { process: 'bottling', product_state: 'packaged_unlabeled' },
  { process: 'bottling', product_state: 'packaged_labeled' },
];

export const REQUIRED_SEEDS: readonly RequiredAnalysisView[] = [
  { parameter_code: 'abv', name_es: 'Grado alcohólico', active: true, sort_order: 1 },
  { parameter_code: 'total_acidity', name_es: 'Acidez total', active: true, sort_order: 2 },
  { parameter_code: 'volatile_acidity', name_es: 'Acidez volátil', active: true, sort_order: 3 },
  { parameter_code: 'ph', name_es: 'pH', active: true, sort_order: 4 },
  { parameter_code: 'free_so2', name_es: 'SO2 libre', active: true, sort_order: 5 },
  { parameter_code: 'total_so2', name_es: 'SO2 total', active: true, sort_order: 6 },
  { parameter_code: 'glucose_fructose', name_es: 'Azúcares (glucosa y fructosa)', active: true, sort_order: 7 },
];

export const PROCESSES: readonly CellarProcess[] = [
  'reception',
  'crushing_pressing',
  'fermentation',
  'racking',
  'filtration',
  'stabilisation',
  'aging_barrel',
  'bottling',
];

export const PRODUCT_STATES: readonly ProductState[] = [
  'grape',
  'must',
  'wine',
  'packaged_unlabeled',
  'packaged_labeled',
];

export const PROCESS_LABEL: Record<CellarProcess, string> = {
  reception: 'recepción',
  crushing_pressing: 'estrujado y prensado',
  fermentation: 'fermentación',
  racking: 'trasiego',
  filtration: 'filtración',
  stabilisation: 'estabilización',
  aging_barrel: 'crianza en barrica',
  bottling: 'embotellado',
};

export const STATE_LABEL: Record<ProductState, string> = {
  grape: 'uva',
  must: 'mosto',
  wine: 'vino',
  packaged_unlabeled: 'envasado sin etiquetar',
  packaged_labeled: 'envasado etiquetado',
};

export const SUGAR_LABEL: Record<SugarBand, string> = {
  lt_2: 'azúcar residual menor de 2 g/L',
  from_2_to_5: 'azúcar residual de 2 a 5 g/L',
  gte_5: 'azúcar residual mayor de 5 g/L',
};

const OP_PROCESS: Record<string, CellarProcess> = {
  reception: 'reception',
  bulk_reception: 'reception',
  crushing_pressing: 'crushing_pressing',
  fermentation: 'fermentation',
  fermentation_end: 'fermentation',
  racking: 'racking',
  filtration: 'filtration',
  stabilization: 'stabilisation',
  stabilisation: 'stabilisation',
  aging_barrel: 'aging_barrel',
  bottling: 'bottling',
};

export function isProcess(value: string): value is CellarProcess {
  return (PROCESSES as readonly string[]).includes(value);
}

export function isProductState(value: string): value is ProductState {
  return (PRODUCT_STATES as readonly string[]).includes(value);
}

export function processOf(opType: string, explicit: string | null): CellarProcess | null {
  if (explicit && isProcess(explicit)) return explicit;
  return OP_PROCESS[opType] ?? null;
}

export function templateSettings(): SettingsView {
  const parameters: ParameterView[] = PARAMETER_SEEDS.map((row) => ({
    code: row.code,
    value: row.value,
    value_text: row.value_text,
    unit: row.unit,
    basis: row.basis,
    status_label: statusLabel(row.basis, false),
    source_ref: row.source_ref,
    valid_from: VALID_FROM,
    pending: isPending(row.basis, false),
  }));
  const so2Limits: So2LimitView[] = SO2_SEEDS.map((row) => ({
    ...row,
    status_label: statusLabel(row.basis, false),
    valid_from: VALID_FROM,
    pending: isPending(row.basis, false),
  }));
  const loss: LossToleranceView[] = LOSS_SEEDS.map((row) => ({
    process: row.process,
    product_state: row.product_state,
    max_pct: null,
    basis: 'pendiente',
    status_label: statusLabel('pendiente', false),
    source_ref: SOURCE.loss,
    valid_from: VALID_FROM,
    pending: true,
  }));
  const practices: PracticeView[] = [{
    name_es: 'carbones activos',
    name_key: 'carbones activos',
    match_terms: ['carbones activos', 'activated carbon', 'carbon activo'],
    active: true,
    basis: 'hecho',
    status_label: 'hecho',
    source_ref: SOURCE.carbon,
    pending: false,
  }];
  const required = REQUIRED_SEEDS.map((row) => ({ ...row }));
  const partial = {
    legal_entity_id: TEMPLATE_ENTITY,
    parameters,
    so2_limits: so2Limits,
    loss_tolerances: loss,
    prohibited_practices: practices,
    required_analysis: required,
  };
  return { ...partial, pending_confirmation: pendingKeys(partial) };
}

export function parameterOf(view: SettingsView, code: string): ParameterView {
  const found = view.parameters.find((row) => row.code === code);
  if (!found) throw new Error(`Falta el parámetro de enología ${code}`);
  return found;
}

export function so2LimitOf(
  view: SettingsView,
  scope: So2Scope,
  wine: WineColor,
  band: SugarBand,
): So2LimitView | null {
  return view.so2_limits.find((row) =>
    row.scope === scope && row.wine_color === wine && row.sugar_band === band) ?? null;
}

export function lossOf(
  view: SettingsView,
  process: CellarProcess,
  state: ProductState,
): LossToleranceView | null {
  return view.loss_tolerances.find((row) => row.process === process && row.product_state === state) ?? null;
}
