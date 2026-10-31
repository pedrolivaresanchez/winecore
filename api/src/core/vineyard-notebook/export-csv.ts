/**
 * Cuaderno de explotación en CSV para que el agricultor lo presente.
 * WineCore no lo envía a ninguna administración ni al CUE.
 *
 * HECHO: columnas de fitosanitarios y fertilización que nombran ecologico.md R1–R2 y UI-26
 * (fecha, SIGPAC, cultivo, variedad, superficie, problema, aplicador, asesor, producto,
 * nº de registro en texto libre, dosis, cantidad, equipo ROMA, eficacia, factura, CUE).
 * SUPUESTO: el modelo v9 de la Junta no detalla columnas en la spec. Este CSV las reúne
 * en un solo fichero (punto decimal, separador «;», UTF-8 con BOM), no es el fichero oficial.
 * SUPUESTO: el carné ROPO, el plazo de seguridad y la meteorología viajan en columnas propias.
 */

export const CUE_COLUMNS = [
  'seccion',
  'orden',
  'fecha',
  'campana',
  'codigo_parcela',
  'sigpac',
  'cultivo',
  'variedad',
  'superficie_ha',
  'superficie_tratada_ha',
  'ecologica',
  'problema',
  'aplicador',
  'carne_ropo',
  'asesor',
  'producto',
  'numero_registro',
  'sustancias_activas',
  'apto_ecologico',
  'dosis',
  'unidad_dosis',
  'dosis_maxima',
  'unidad_dosis_maxima',
  'cantidad',
  'unidad_cantidad',
  'equipo_roma',
  'plazo_seguridad_dias',
  'eficacia',
  'meteorologia',
  'metodo',
  'tipo',
  'nutrientes',
  'momento_aplicacion',
  'estado_cue',
  'anotado_cue',
  'labor',
  'horas',
  'kg_cosecha',
  'aviso',
  'notas',
] as const;

export type CueColumn = (typeof CUE_COLUMNS)[number];
export type CueRow = Record<CueColumn, string>;

export const TITULAR_NOTE = 'P.O. El agricultor presenta este cuaderno. WineCore no lo envía a ninguna administración ni al CUE.';
export const CAMPAIGN_NOTE = 'Año natural. La forma AAAA/AAAA es la campaña vitivinícola del 1 de agosto al 31 de julio.';
export const FORMAT_NOTE = 'CSV con los campos del anexo III del RD 1311/2012 y de la fertilización citados en la especificación. No es el modelo oficial v9 ni un envío al CUE.';

const TASK_LABEL: Record<string, string> = {
  pruning: 'Poda',
  tillage: 'Laboreo',
  mowing: 'Siega',
  green_pruning: 'Poda en verde',
  harvest: 'Vendimia',
  planting: 'Plantación',
  other: 'Otra',
};

const OPERATION_LABEL: Record<string, string> = {
  cleaning: 'Limpieza',
  residue_analysis: 'Análisis de residuos',
  irrigation: 'Riego',
  cover_crop: 'Cubierta vegetal',
  other: 'Otra',
};

const CUE_LABEL: Record<string, string> = {
  not_required: 'no_aplica',
  pending: 'pendiente',
  warn: 'aviso',
  overdue: 'vencido',
  recorded: 'anotado',
};

export interface CueParcel {
  code: string;
  sigpac: string;
  areaHa: string;
  organic: boolean;
  organicSince: string | null;
  name: string;
  varieties: { variety: string; areaHa: string }[];
}

export interface CueProduct {
  name: string;
  registration: string | null;
  substances: string | null;
  organic: boolean;
  maxDose: string | null;
  maxDoseUnit: string | null;
  safetyDays: number | null;
  kind: string;
  nutrient: string | null;
}

export interface CueTreatment {
  appliedOn: string;
  parcelCode: string;
  sigpac: string;
  crop: string;
  variety: string | null;
  treatedAreaHa: string;
  organicParcel: boolean;
  target: string | null;
  operatorName: string;
  ropo: string | null;
  advisor: string | null;
  productName: string;
  registration: string | null;
  substances: string | null;
  organicProduct: boolean;
  dose: string;
  doseUnit: string;
  maxDose: string | null;
  maxDoseUnit: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  equipment: string | null;
  safetyDays: number | null;
  efficacy: string | null;
  weather: string | null;
  method: string;
  kind: string;
  nutrient: string | null;
  timing: string | null;
  cueStatus: string;
  cueRecordedOn: string | null;
  invoiceId: string | null;
  warnings: string[];
  notes: string | null;
}

export interface CueOperation {
  doneOn: string;
  parcelCode: string;
  sigpac: string;
  kind: string;
  operatorName: string | null;
  productName: string | null;
  substance: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  notes: string | null;
}

export interface CueTask {
  doneOn: string;
  parcelCode: string;
  sigpac: string;
  kind: string;
  operatorName: string | null;
  hours: string | null;
  notes: string | null;
}

export interface CueHarvest {
  harvestedOn: string;
  parcelCode: string;
  sigpac: string;
  variety: string;
  estimatedKg: string | null;
  notes: string | null;
}

export interface CueWarning {
  parcelCode: string;
  sigpac: string;
  eventOn: string;
  code: string;
  message: string;
}

export interface CueWorkbook {
  campaignLabel: string;
  windowStart: string;
  windowEnd: string;
  generatedOn: string;
  parcels: CueParcel[];
  products: CueProduct[];
  treatments: CueTreatment[];
  operations: CueOperation[];
  tasks: CueTask[];
  harvests: CueHarvest[];
  warnings: CueWarning[];
}

export function cueFilename(label: string): string {
  return `cuaderno-explotacion-${label.replace('/', '-')}.csv`;
}

export function renderCueCsv(book: CueWorkbook): string {
  const lines = [CUE_COLUMNS.join(';')];
  for (const row of workbookRows(book)) {
    lines.push(CUE_COLUMNS.map((column) => csvCell(row[column])).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function workbookRows(book: CueWorkbook): CueRow[] {
  const rows: CueRow[] = [];
  const metas: { tipo: string; extra: Partial<CueRow> }[] = [
    { tipo: 'campana', extra: { notas: CAMPAIGN_NOTE } },
    { tipo: 'ventana', extra: { fecha: book.windowStart, notas: `${book.windowStart} a ${book.windowEnd}` } },
    { tipo: 'titular', extra: { notas: TITULAR_NOTE } },
    { tipo: 'formato', extra: { notas: FORMAT_NOTE } },
    { tipo: 'generado', extra: { fecha: book.generatedOn, notas: 'Generado para revisión del agricultor.' } },
  ];
  metas.forEach((item, index) => {
    const row = meta(book, item.tipo, item.extra);
    row.orden = String(index + 1);
    rows.push(row);
  });

  const parcels = [...book.parcels].sort((a, b) => a.code.localeCompare(b.code));
  let parcelOrder = 0;
  for (const parcel of parcels) {
    const varieties = parcel.varieties.length > 0 ? parcel.varieties : [{ variety: '', areaHa: parcel.areaHa }];
    for (const variety of varieties) {
      parcelOrder += 1;
      const row = blank();
      row.seccion = 'parcelas';
      row.orden = String(parcelOrder);
      row.campana = book.campaignLabel;
      row.codigo_parcela = parcel.code;
      row.sigpac = parcel.sigpac;
      row.cultivo = 'Vid';
      row.variedad = variety.variety;
      row.superficie_ha = parcel.areaHa;
      row.superficie_tratada_ha = variety.areaHa;
      row.ecologica = yesNo(parcel.organic);
      row.notas = parcelNote(parcel);
      rows.push(row);
    }
  }

  const products = [...book.products].sort((a, b) => a.name.localeCompare(b.name) || (a.registration ?? '').localeCompare(b.registration ?? ''));
  products.forEach((product, index) => {
    const row = blank();
    row.seccion = 'productos';
    row.orden = String(index + 1);
    row.campana = book.campaignLabel;
    row.producto = product.name;
    row.numero_registro = product.registration ?? '';
    row.sustancias_activas = product.substances ?? '';
    row.apto_ecologico = yesNo(product.organic);
    row.dosis_maxima = product.maxDose ?? '';
    row.unidad_dosis_maxima = product.maxDoseUnit ?? '';
    row.plazo_seguridad_dias = product.safetyDays == null ? '' : String(product.safetyDays);
    row.tipo = product.kind;
    row.nutrientes = product.nutrient ?? '';
    rows.push(row);
  });

  pushTreatments(rows, book, 'fitosanitarios', 'phytosanitary');
  pushTreatments(rows, book, 'fertilizacion', 'fertiliser');
  pushTreatments(rows, book, 'otros', 'other');

  const operations = [...book.operations].sort(byDateCode);
  operations.forEach((operation, index) => {
    const row = blank();
    row.seccion = 'operaciones';
    row.orden = String(index + 1);
    row.fecha = operation.doneOn;
    row.campana = book.campaignLabel;
    row.codigo_parcela = operation.parcelCode;
    row.sigpac = operation.sigpac;
    row.tipo = operation.kind;
    row.labor = OPERATION_LABEL[operation.kind] ?? operation.kind;
    row.aplicador = operation.operatorName ?? '';
    row.producto = operation.productName ?? '';
    row.sustancias_activas = operation.substance ?? '';
    row.cantidad = operation.quantity ?? '';
    row.unidad_cantidad = operation.quantityUnit ?? '';
    row.notas = operation.notes ?? '';
    rows.push(row);
  });

  const tasks = [...book.tasks].sort(byDateCode);
  tasks.forEach((task, index) => {
    const row = blank();
    row.seccion = 'labores';
    row.orden = String(index + 1);
    row.fecha = task.doneOn;
    row.campana = book.campaignLabel;
    row.codigo_parcela = task.parcelCode;
    row.sigpac = task.sigpac;
    row.tipo = task.kind;
    row.labor = TASK_LABEL[task.kind] ?? task.kind;
    row.aplicador = task.operatorName ?? '';
    row.horas = task.hours ?? '';
    row.notas = task.notes ?? '';
    rows.push(row);
  });

  const harvests = [...book.harvests].sort((a, b) => a.harvestedOn.localeCompare(b.harvestedOn) || a.parcelCode.localeCompare(b.parcelCode));
  harvests.forEach((harvest, index) => {
    const row = blank();
    row.seccion = 'cosecha';
    row.orden = String(index + 1);
    row.fecha = harvest.harvestedOn;
    row.campana = book.campaignLabel;
    row.codigo_parcela = harvest.parcelCode;
    row.sigpac = harvest.sigpac;
    row.variedad = harvest.variety;
    row.kg_cosecha = harvest.estimatedKg ?? '';
    row.notas = harvest.notes ?? '';
    rows.push(row);
  });

  const warnings = [...book.warnings].sort((a, b) => a.eventOn.localeCompare(b.eventOn) || a.parcelCode.localeCompare(b.parcelCode) || a.code.localeCompare(b.code));
  warnings.forEach((warning, index) => {
    const row = blank();
    row.seccion = 'avisos';
    row.orden = String(index + 1);
    row.fecha = warning.eventOn;
    row.campana = book.campaignLabel;
    row.codigo_parcela = warning.parcelCode;
    row.sigpac = warning.sigpac;
    row.tipo = warning.code;
    row.aviso = warning.message;
    rows.push(row);
  });
  return rows;
}

function pushTreatments(rows: CueRow[], book: CueWorkbook, section: string, kind: string): void {
  const items = book.treatments
    .filter((item) => item.kind === kind)
    .sort((a, b) => a.appliedOn.localeCompare(b.appliedOn) || a.parcelCode.localeCompare(b.parcelCode) || a.productName.localeCompare(b.productName));
  items.forEach((item, index) => {
    const row = blank();
    row.seccion = section;
    row.orden = String(index + 1);
    row.fecha = item.appliedOn;
    row.campana = book.campaignLabel;
    row.codigo_parcela = item.parcelCode;
    row.sigpac = item.sigpac;
    row.cultivo = item.crop;
    row.variedad = item.variety ?? '';
    row.superficie_tratada_ha = item.treatedAreaHa;
    row.ecologica = yesNo(item.organicParcel);
    row.problema = item.target ?? '';
    row.aplicador = item.operatorName;
    row.carne_ropo = item.ropo ?? '';
    row.asesor = item.advisor ?? '';
    row.producto = item.productName;
    row.numero_registro = item.registration ?? '';
    row.sustancias_activas = item.substances ?? '';
    row.apto_ecologico = yesNo(item.organicProduct);
    row.dosis = item.dose;
    row.unidad_dosis = item.doseUnit;
    row.dosis_maxima = item.maxDose ?? '';
    row.unidad_dosis_maxima = item.maxDoseUnit ?? '';
    row.cantidad = item.quantity ?? '';
    row.unidad_cantidad = item.quantityUnit ?? '';
    row.equipo_roma = item.equipment ?? '';
    row.plazo_seguridad_dias = item.safetyDays == null ? '' : String(item.safetyDays);
    row.eficacia = item.efficacy ?? '';
    row.meteorologia = item.weather ?? '';
    row.metodo = item.method;
    row.tipo = item.kind;
    row.nutrientes = item.nutrient ?? '';
    row.momento_aplicacion = item.timing ?? '';
    row.estado_cue = CUE_LABEL[item.cueStatus] ?? item.cueStatus;
    row.anotado_cue = item.cueRecordedOn ?? '';
    row.notas = [item.invoiceId ? `factura ${item.invoiceId}` : '', item.notes ?? ''].filter(Boolean).join(' | ');
    row.aviso = item.warnings.join(' | ');
    rows.push(row);
  });
}

function meta(book: CueWorkbook, tipo: string, extra: Partial<CueRow>): CueRow {
  const row = blank();
  row.seccion = 'metadatos';
  row.campana = book.campaignLabel;
  row.tipo = tipo;
  for (const [key, value] of Object.entries(extra)) row[key as CueColumn] = value ?? '';
  return row;
}

function parcelNote(parcel: CueParcel): string {
  if (parcel.organic && parcel.organicSince) return `${parcel.name}. Ecológica desde ${parcel.organicSince}.`;
  return parcel.name;
}

function byDateCode(left: { doneOn: string; parcelCode: string }, right: { doneOn: string; parcelCode: string }): number {
  return left.doneOn.localeCompare(right.doneOn) || left.parcelCode.localeCompare(right.parcelCode);
}

function yesNo(value: boolean): string {
  return value ? 'Sí' : 'No';
}

function blank(): CueRow {
  const row = {} as CueRow;
  for (const column of CUE_COLUMNS) row[column] = '';
  return row;
}

function csvCell(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
