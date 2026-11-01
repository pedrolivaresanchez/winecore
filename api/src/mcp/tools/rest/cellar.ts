import { z } from "zod";

import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite } from "../../rest";

type Fields = Record<string, unknown>;

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Debe ser un UUID");
const code = z.string().regex(/^[A-Z0-9-]{2,20}$/, "Mayúsculas, números y guiones (2 a 20)");
const vesselCode = code.describe("Código del recipiente, p. ej. INOX-01 o BAR-001");
const zoneCode = code.describe("Código de la zona del plano, p. ej. NAVE-1");
const holderCode = code.describe("Código del nicho o jaulón, p. ej. JAU-001");
const limit = z.number().int().min(1).max(100).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const instant = z.string().max(40).regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
  "Instante ISO-8601 con zona horaria",
);
const lotCode = z.string().regex(/^[A-Z0-9][A-Z0-9./-]{1,29}$/, "Código de lote no válido");

const VESSEL_KINDS = ["tank_storage", "tank_fermenter", "barrel", "demijohn", "ibc", "other"] as const;
const VESSEL_MATERIALS = ["stainless_steel", "oak", "glass", "concrete", "plastic", "other"] as const;
const VESSEL_STATUSES = ["in_service", "out_of_service", "retired"] as const;
const ZONE_KINDS = ["elaboration", "barrel_room", "outdoor", "bottle_store", "other"] as const;
const HOLDER_KINDS = ["nicho", "jaulon"] as const;
const OAK_ORIGINS = ["frances", "americano", "centroeuropeo", "otro"] as const;
const TOAST_LEVELS = ["ligero", "medio", "medio_plus", "fuerte"] as const;
const BARREL_STATUSES = ["in_use", "resting", "to_retire", "retired"] as const;
const PRODUCT_STATES = ["grape", "must", "wine", "packaged_unlabeled", "packaged_labeled"] as const;
const OPERATION_STATUSES = ["draft", "confirmed", "rectified", "discarded"] as const;
const ENGINE_TYPES = [
  "racking", "blend", "addition", "bottling", "loss", "destruction", "cleaning",
  "crushing_pressing", "fermentation_end", "fermentation_start", "malolactic_start", "malolactic_end",
  "bleeding", "pressing_off", "delestage", "temperature_control", "sampling",
] as const;
const LISTED_TYPES = [
  "reception", "bulk_reception", "filtration", "stabilization", "labeling", ...ENGINE_TYPES,
] as const;

const OP_LABELS: Record<string, string> = {
  reception: "recepción de uva",
  bulk_reception: "recepción a granel",
  crushing_pressing: "estrujado y prensado",
  fermentation_end: "fin de fermentación",
  racking: "trasiego",
  blend: "coupage",
  filtration: "filtración",
  addition: "adición",
  stabilization: "estabilización",
  cleaning: "limpieza",
  sampling: "toma de muestras",
  bottling: "embotellado",
  labeling: "etiquetado",
  loss: "merma",
  destruction: "destrucción",
  fermentation_start: "inicio de fermentación",
  malolactic_start: "inicio de maloláctica",
  malolactic_end: "fin de maloláctica",
  bleeding: "sangrado",
  pressing_off: "descube",
  delestage: "délestage",
  temperature_control: "control de temperatura",
};

const ml = (what: string) => z.number().int().positive().describe(`${what} en mililitros (1 L = 1000 ml; 225 L = 225000)`);

const vesselCreateFields = z.object({
  code: vesselCode,
  name: z.string().min(1).max(120),
  kind: z.enum(VESSEL_KINDS).describe("tank_storage depósito, tank_fermenter fermentador (exige camisa de frío), barrel barrica, demijohn damajuana, ibc contenedor IBC, other otro"),
  capacity_ml: ml("Capacidad"),
  has_cooling_jacket: z.boolean().optional().describe("Camisa de frío; por defecto no"),
  material: z.enum(VESSEL_MATERIALS).describe("stainless_steel inox, oak roble, glass cristal, concrete hormigón, plastic plástico, other otro"),
  location_id: id.describe("Ubicación (bodega o nave) de la lista de ubicaciones"),
  zone: z.string().max(40).optional().describe("Zona en texto libre, p. ej. 'Nave 1'"),
  sisv_code: z.string().max(20).optional().describe("Código del recipiente en el registro SISV"),
  notes: z.string().max(2000).optional(),
}).strict();

const vesselChanges = z.object({
  name: z.string().min(1).max(120).optional(),
  kind: z.enum(VESSEL_KINDS).optional().describe("No se cambia si tiene vino"),
  capacity_ml: ml("Capacidad").optional(),
  has_cooling_jacket: z.boolean().optional(),
  material: z.enum(VESSEL_MATERIALS).optional().describe("No se cambia si tiene vino"),
  location_id: id.optional().describe("No se cambia si tiene vino: trasiega antes"),
  zone: z.string().max(40).nullable().optional().describe("null la quita"),
  sisv_code: z.string().max(20).nullable().optional().describe("null lo quita"),
  notes: z.string().max(2000).nullable().optional(),
}).strict();

const importRow = z.object({
  code: z.string().regex(/^[A-Za-z0-9-]{2,20}$/).describe("Código del recipiente; se pasa a mayúsculas"),
  name: z.string().min(1).max(120),
  kind: z.enum(VESSEL_KINDS),
  capacity_litres: z.number().positive().describe("Capacidad en litros"),
  material: z.enum(VESSEL_MATERIALS),
  cooling: z.boolean().optional().describe("Camisa de frío; obligatoria en fermentadores"),
  zone: z.string().max(40).optional().describe("Zona del plano por nombre; si no existe se crea y el recipiente se coloca en ella"),
  zone_kind: z.enum(ZONE_KINDS).optional().describe("Tipo de la zona si hay que crearla; por defecto elaboration"),
  status: z.enum(VESSEL_STATUSES).optional().describe("Solo para los nuevos; el estado de los que ya existen no cambia"),
}).strict();

const barrelCreateFields = z.object({
  oak_origin: z.enum(OAK_ORIGINS).describe("Origen del roble"),
  forest: z.string().max(120).optional().describe("Bosque, p. ej. Tronçais"),
  toast: z.enum(TOAST_LEVELS).describe("Tostado"),
  head_toast: z.boolean().optional().describe("Fondos tostados; por defecto no"),
  cooper: z.string().min(1).max(120).describe("Tonelería"),
  year_made: z.number().int().min(1950).max(2100).describe("Año de fabricación"),
  nominal_volume_ml: ml("Volumen nominal"),
  purchase_date: date.optional().describe("Fecha de compra YYYY-MM-DD"),
  purchase_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().describe("Precio de compra en euros, p. ej. '850.00'"),
  status: z.enum(BARREL_STATUSES).optional().describe("in_use en uso (por defecto), resting en reposo, to_retire para retirar, retired retirada (exige retired_on)"),
  retired_on: date.optional().describe("Fecha de retirada YYYY-MM-DD"),
}).strict();

const barrelChanges = z.object({
  oak_origin: z.enum(OAK_ORIGINS).optional(),
  forest: z.string().max(120).nullable().optional(),
  toast: z.enum(TOAST_LEVELS).optional(),
  head_toast: z.boolean().optional(),
  cooper: z.string().min(1).max(120).optional(),
  year_made: z.number().int().min(1950).max(2100).optional(),
  nominal_volume_ml: ml("Volumen nominal").optional(),
  purchase_date: date.nullable().optional(),
  purchase_price: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional().describe("Euros, p. ej. '850.00'"),
  status: z.enum(BARREL_STATUSES).optional().describe("retired exige retired_on"),
  retired_on: date.nullable().optional(),
}).strict();

const coordinate = (axis: string) => z.number().min(-1_000_000).max(1_000_000).describe(`${axis}, en unidades de plano (el lienzo mide 1000 × 640, origen arriba a la izquierda)`);
const span = (what: string) => z.number().positive().max(1_000_000).describe(`${what}, en unidades de plano`);
const rotation = z.number().min(-360).max(360).describe("Giro en grados, sentido horario");

const positionChanges = z.object({
  x: coordinate("x").optional(),
  y: coordinate("y").optional(),
  width: span("Ancho").optional(),
  height: span("Alto").optional(),
  rotation: rotation.optional(),
}).strict();

const holderChanges = z.object({
  name: z.string().min(1).max(120).optional(),
  zone_id: id.nullable().optional().describe("Zona del plano; null la quita"),
  number: z.number().int().positive().nullable().optional().describe("Número del jaulón"),
  capacity_bottles: z.number().int().positive().nullable().optional().describe("Capacidad en botellas"),
  nominal_volume_ml: z.number().int().positive().nullable().optional().describe("Volumen de la botella en ml (750)"),
  format: z.string().regex(/^[A-Z0-9]{2,10}$/).nullable().optional().describe("Código del formato, p. ej. B075"),
  notes: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional().describe("false lo archiva"),
}).strict();

const operationLine = z.object({
  role: z.enum(["input", "output", "loss"]).describe("input sale de un recipiente, output entra en un recipiente, loss merma"),
  loss_kind: z.enum(["authorized", "incident"]).optional().describe("Solo en mermas: authorized merma normal, incident merma por incidencia (pide aprobación)"),
  lot_id: id.optional(),
  vessel_id: id.optional(),
  location_id: id.optional().describe("Ubicación, para lo que no está en un recipiente (uva, botellas)"),
  product_id: id.optional().describe("Producto embotellado, en embotellado"),
  product_state: z.enum(PRODUCT_STATES).describe("grape uva, must mosto, wine vino, packaged_unlabeled embotellado sin etiquetar, packaged_labeled etiquetado"),
  volume_ml: z.number().int().min(0).optional().describe("Volumen en mililitros (1 L = 1000 ml). Obligatorio y mayor que cero salvo en estrujado, fin de fermentación, fin de maloláctica, sangrado y descube"),
  mass_g: z.number().int().min(0).optional().describe("Masa en gramos (uva, orujo); solo en estrujado, fin de fermentación, fin de maloláctica, sangrado y descube"),
  qty_units: z.number().int().min(0).optional().describe("Unidades (botellas)"),
  nominal_volume_ml: z.number().int().positive().optional().describe("Volumen de la botella en ml (750)"),
  excise_product_key: z.string().max(40).optional().describe("Clave de producto de impuestos especiales (SILICIE)"),
  nc_code: z.string().max(8).optional().describe("Código NC arancelario"),
  new_lot_code: lotCode.optional().describe("Lote que nace en esta línea (sangrado, descube…)"),
}).strict();

const quantityUnit = z.enum(["g", "kg", "ml", "l"]);

const operationShape = {
  op_type: z.enum(ENGINE_TYPES).describe("racking trasiego, blend coupage, addition adición, bottling embotellado, loss merma, destruction destrucción, cleaning limpieza, crushing_pressing estrujado, fermentation_start/fermentation_end fermentación, malolactic_start/malolactic_end maloláctica, bleeding sangrado, pressing_off descube, delestage, temperature_control control de temperatura, sampling toma de muestras"),
  legal_entity_id: id.describe("Sociedad que hace la operación"),
  occurred_at: instant.describe("Cuándo se hizo, ISO-8601 con zona, p. ej. 2026-10-30T09:00:00+01:00; no puede ser futura"),
  fiscal_date: date.optional().describe("Fecha fiscal YYYY-MM-DD; por defecto el día de occurred_at"),
  performed_by: z.string().min(1).max(120).describe("Quién la hizo"),
  reason: z.string().max(500).optional().describe("Motivo; obligatorio en control de temperatura"),
  lines: z.array(operationLine).optional().describe("Entradas, salidas y mermas. Obligatorias en trasiego, coupage, embotellado, merma, destrucción, estrujado, fin de fermentación, fin de maloláctica, sangrado y descube; prohibidas en délestage, control de temperatura y toma de muestras"),
  new_lot: z.object({
    code: lotCode.describe("Código del lote nuevo"),
    wine_id: id.optional().describe("Vino del catálogo; solo en coupage"),
    excise_product_key: z.string().max(40).optional().describe("Clave SILICIE; solo en coupage"),
  }).strict().optional().describe("Lote nuevo: obligatorio en coupage, embotellado y sangrado"),
  vessel_id: id.optional().describe("Recipiente: obligatorio en adición, inicio de fermentación, inicio de maloláctica, délestage, control de temperatura y toma de muestras"),
  lot_id: id.optional().describe("Lote: obligatorio en los mismos casos que vessel_id"),
  addition: z.object({
    additive_product_id: id.describe("Producto enológico añadido"),
    quantity: z.string().min(1).max(20).describe("Cantidad total con punto decimal, p. ej. '2.5'"),
    quantity_unit: quantityUnit,
    dose: z.string().min(1).max(20).describe("Dosis con punto decimal"),
    dose_unit: z.enum(["g/hl", "mg/l", "g/l"]),
    purpose: z.enum(["acidification", "sulphiting", "cleaning", "other"]).describe("acidification acidificación, sulphiting sulfitado, cleaning limpieza, other otro"),
    supplier_invoice_id: id.optional().describe("Factura de compra del producto"),
    organic_approved: z.boolean().describe("Apto en ecológico"),
    additive_lot_code: z.string().regex(/^[A-Z0-9][A-Z0-9./-]{0,29}$/).optional().describe("Lote del proveedor del aditivo"),
    allergens: z.array(z.string().regex(/^[a-z0-9_]{1,32}$/)).max(8).optional().describe("Alérgenos, p. ej. sulphites"),
  }).strict().optional().describe("Obligatoria en adición"),
  cleaning: z.object({
    vessel_id: id.optional(),
    location_id: id.optional(),
    product_id: id.describe("Producto de limpieza"),
    active_substance: z.string().min(1).max(120).describe("Materia activa"),
    quantity: z.string().min(1).max(20).describe("Cantidad con punto decimal"),
    quantity_unit: quantityUnit,
    efficacy_check: z.string().min(1).max(200).describe("Cómo se comprobó que quedó limpio"),
    supplier_invoice_id: id.optional(),
  }).strict().optional().describe("Obligatoria en limpieza"),
  abv_pct: z.string().regex(/^(0|[1-9]\d?)(?:\.\d{1,2})?$/).optional().describe("Grado alcohólico, p. ej. '13.5'"),
  excise_product_key: z.string().max(40).optional().describe("Clave de producto SILICIE"),
  started_at: instant.optional(),
  ended_at: instant.optional(),
  notes: z.string().max(2000).optional(),
  previous_setpoint_c: z.number().min(-30).max(40).optional().describe("Consigna anterior en °C, con un decimal"),
  new_setpoint_c: z.number().min(-30).max(40).optional().describe("Consigna nueva en °C, con un decimal"),
  inoculation: z.enum(["spontaneous", "commercial"]).optional().describe("Fermentación espontánea o con levadura o bacteria comercial (esta exige inoculum_product_id)"),
  inoculum_product_id: id.optional(),
  end_evidence: z.enum(["sensory", "analysis", "both"]).optional().describe("Cómo se dio por acabada: cata, análisis o ambos"),
  end_analysis_id: id.optional(),
  observations: z.string().max(2000).optional(),
  sampled_at: instant.optional().describe("Toma de muestras: cuándo"),
  sample_code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9./-]{0,31}$/).optional().describe("Toma de muestras: código de la muestra"),
  destination: z.union([z.literal("internal"), id]).optional().describe("Toma de muestras: 'internal' o el id del contacto del laboratorio"),
};

const operationFields = z.object(operationShape).strict();
const operationChanges = z.object(operationShape).partial().strict();

const DRAFT_KEYS = [
  "abv_pct", "excise_product_key", "started_at", "ended_at", "notes", "previous_setpoint_c", "new_setpoint_c",
  "inoculation", "inoculum_product_id", "end_evidence", "end_analysis_id", "observations", "sampled_at", "sample_code",
] as const;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Fields {
  return isRecord(value) ? value : {};
}

function litres(volumeMl: unknown): string {
  const value = typeof volumeMl === "number" ? volumeMl : Number(volumeMl);
  if (!Number.isFinite(value)) return "? L";
  return `${(value / 1000).toLocaleString("es-ES", { maximumFractionDigits: 3 })} L`;
}

function day(value: unknown): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });
}

function opLabel(value: unknown): string {
  return typeof value === "string" ? OP_LABELS[value] ?? value : "operación";
}

function volumes(lines: unknown): string {
  const total = { input: 0, output: 0, loss: 0 };
  for (const line of Array.isArray(lines) ? lines : []) {
    const row = asRecord(line);
    const role = row.role;
    if ((role === "input" || role === "output" || role === "loss") && typeof row.volume_ml === "number") total[role] += row.volume_ml;
  }
  const parts = [
    total.input > 0 ? `salen ${litres(total.input)}` : null,
    total.output > 0 ? `entran ${litres(total.output)}` : null,
    total.loss > 0 ? `merma de ${litres(total.loss)}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** The draft as `POST /v1/cellar-operations` takes it: the PATCH replaces the whole draft. */
function draftBody(current: unknown, changes: Fields): Fields {
  const operation = asRecord(current);
  const details = asRecord(operation.details);
  const addition = isRecord(details.addition) ? details.addition : null;
  const base: Fields = {
    op_type: operation.op_type,
    legal_entity_id: operation.legal_entity_id,
    occurred_at: operation.occurred_at,
    fiscal_date: details.fiscal_date,
    performed_by: operation.performed_by,
    reason: operation.reason,
    lines: details.lines,
    new_lot: details.new_lot,
    addition: addition ? Object.fromEntries(Object.entries(addition).filter(([key]) => key !== "vessel_id" && key !== "lot_id")) : null,
    cleaning: details.cleaning,
    vessel_id: details.focus_vessel_id ?? addition?.vessel_id,
    lot_id: details.focus_lot_id ?? addition?.lot_id,
    destination: details.sample_destination === "lab" ? details.lab_contact_id : details.sample_destination,
  };
  for (const key of DRAFT_KEYS) base[key] = details[key];
  if (changes.occurred_at !== undefined && changes.fiscal_date === undefined) delete base.fiscal_date;
  const out: Fields = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && value !== null) out[key] = value;
  for (const [key, value] of Object.entries(changes)) if (value !== undefined) out[key] = value;
  return out;
}

function needsApproval(input: { op_type?: string; lines?: { loss_kind?: string }[] }): boolean {
  return input.op_type === "destruction" || (input.lines ?? []).some((line) => line.loss_kind === "incident");
}

const vesselLink = (input: { code: string }) => `/bodega/depositos/${encodeURIComponent(input.code)}`;
const operationLink = (input: { id: string }) => `/bodega/operaciones/${input.id}`;
const createdOperationLink = (_input: unknown, body: unknown) => {
  const found = asRecord(body).id;
  return typeof found === "string" ? `/bodega/operaciones/${found}` : null;
};
const holderLink = (input: { code: string }) => `/bodega/contenedores/${encodeURIComponent(input.code)}`;
const planLink = () => "/bodega/depositos?vista=plano";

export const cellarRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "cellar_vessels_browse",
    module: "cellar",
    scope: "cellar.read",
    title: "Recipientes (lista completa)",
    description: "La lista de depósitos, barricas, damajuanas e IBC tal como la carga la app, con su contenido (lote, ml, % de llenado) y filtros por zona, tipo, estado y ubicación, paginada con next_cursor. Para un resumen rápido en litros usa cellar_vessels_list.",
    input: z.object({
      zone: z.string().max(40).optional().describe("Zona en texto, tal como figura en el recipiente"),
      kind: z.enum(VESSEL_KINDS).optional(),
      status: z.enum(VESSEL_STATUSES).optional().describe("in_service en servicio, out_of_service fuera de servicio, retired de baja"),
      location_id: id.optional(),
      limit,
      cursor: code.optional().describe("next_cursor de la página anterior"),
    }).strict(),
    route: "GET /v1/vessels",
    web: () => "/bodega/depositos",
  }),
  defineRestRead({
    name: "cellar_vessel_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Ficha del recipiente",
    description: "Un depósito o barrica con su capacidad, ubicación, zona, estado y lo que contiene ahora (lote, vino, añada y volumen en ml). Incluye su id, que piden las operaciones de bodega.",
    input: z.object({ code: vesselCode }).strict(),
    route: "GET /v1/vessels/:code",
    web: vesselLink,
  }),
  defineRestRead({
    name: "cellar_vessel_history_list",
    module: "cellar",
    scope: "cellar.read",
    title: "Historial del recipiente",
    description: "Las operaciones que han pasado por el depósito (trasiegos, coupages, adiciones, limpiezas, mermas…), de la más reciente a la más antigua, con sus líneas. Paginado con next_cursor.",
    input: z.object({ code: vesselCode, limit, cursor: z.string().max(200).optional() }).strict(),
    route: "GET /v1/vessels/:code/history",
    web: vesselLink,
  }),
  defineRestRead({
    name: "cellar_vessel_plan_card_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Tarjeta del recipiente en el plano",
    description: "Lo que enseña la tarjeta del plano al tocar un depósito: contenido en litros, llenado, últimas operaciones y últimos análisis del lote.",
    input: z.object({ code: vesselCode }).strict(),
    route: "GET /v1/vessels/:code/plan-card",
    web: vesselLink,
  }),
  defineRestRead({
    name: "cellar_vessel_qr_get",
    module: "cellar",
    scope: "cellar.read",
    title: "QR del recipiente",
    description: "El token y el enlace del QR que se imprime y se pega en el depósito.",
    input: z.object({ code: vesselCode }).strict(),
    route: "GET /v1/vessels/:code/qr",
    web: vesselLink,
  }),
  defineRestRead({
    name: "cellar_vessel_by_qr_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Recipiente por su QR",
    description: "Encuentra el depósito al que pertenece un QR escaneado y devuelve su ficha.",
    input: z.object({
      token: z.string().regex(/^wcqr_[A-Za-z0-9_-]{11,59}$/).describe("Token del QR, empieza por wcqr_ (es el final del enlace escaneado)"),
    }).strict(),
    route: "GET /v1/vessels/qr/:token",
    web: (_input, body) => {
      const found = asRecord(body).code;
      return typeof found === "string" ? vesselLink({ code: found }) : null;
    },
  }),
  defineRestRead({
    name: "cellar_vessels_import_template_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Plantilla de importación de recipientes",
    description: "El CSV de ejemplo con las columnas que acepta la importación de recipientes (código, nombre, tipo, litros, material, frío, zona, estado).",
    input: z.object({}).strict(),
    route: "GET /v1/vessels/import-template",
  }),
  defineRestWrite({
    name: "cellar_vessel_create",
    module: "cellar",
    scope: "cellar.manage",
    title: "Alta de recipiente",
    description: "Da de alta un depósito, fermentador, barrica, damajuana o IBC vacío en una ubicación, con su capacidad en ml y su QR. Un fermentador exige camisa de frío.",
    input: vesselCreateFields,
    route: "POST /v1/vessels",
    summary: (input) => `Dar de alta el recipiente ${input.code} (${input.name}), de ${litres(input.capacity_ml)}. Entra vacío y en servicio. ¿Confirmas?`,
    web: vesselLink,
  }),
  defineRestWrite({
    name: "cellar_vessel_update",
    module: "cellar",
    scope: "cellar.manage",
    title: "Editar recipiente",
    description: "Cambia nombre, capacidad, camisa de frío, zona, código SISV o notas del recipiente. Con vino dentro no se cambian tipo, material ni ubicación, y la capacidad no puede quedar por debajo del volumen. Solo hace falta mandar lo que cambia.",
    input: z.object({ code: vesselCode, changes: vesselChanges }).strict(),
    route: "PATCH /v1/vessels/:code",
    current: { route: "GET /v1/vessels/:code" },
    send: (input) => input.changes,
    web: vesselLink,
  }),
  defineRestWrite({
    name: "cellar_vessel_retire",
    module: "cellar",
    scope: "cellar.manage",
    title: "Dar de baja un recipiente",
    description: "Retira para siempre un depósito o barrica vacío (sin vino ni borradores pendientes). La baja no se deshace desde la app.",
    input: z.object({ code: vesselCode, reason: z.string().min(1).max(500).describe("Motivo de la baja") }).strict(),
    route: "POST /v1/vessels/:code/retire",
    current: { route: "GET /v1/vessels/:code" },
    summary: (input, current) => {
      const name = asRecord(current).name;
      return `Dar de baja el recipiente ${input.code}${typeof name === "string" ? ` (${name})` : ""} por: ${input.reason}. Tiene que estar vacío; la baja es definitiva y no mueve vino. ¿Confirmas?`;
    },
    web: vesselLink,
  }),
  defineRestWrite({
    name: "cellar_vessels_import",
    module: "cellar",
    scope: "cellar.operate",
    title: "Importar recipientes",
    description: "Da de alta o actualiza de una vez hasta 500 recipientes de una ubicación (las filas de la plantilla o de una hoja que pase la persona). Los códigos nuevos se crean; en los que ya existen cambian nombre, capacidad y zona, nunca tipo, material, frío ni estado. Devuelve el informe con creados, actualizados y errores por fila.",
    input: z.object({
      location_id: id.describe("Ubicación donde están los recipientes"),
      rows: z.array(importRow).min(1).max(500),
    }).strict(),
    route: "POST /v1/vessels/import",
    summary: (input) => `Importar ${input.rows.length} ${input.rows.length === 1 ? "recipiente" : "recipientes"}: se crean los códigos nuevos y se actualizan nombre, capacidad y zona de los que ya existen. No mueve vino. ¿Confirmas?`,
    web: () => "/bodega/depositos",
  }),
  defineRestRead({
    name: "cellar_vessel_capacity_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Capacidad y aforos del recipiente",
    description: "La capacidad actual en ml del depósito y el historial de cambios de capacidad (aforos) con su motivo.",
    input: z.object({ code: vesselCode }).strict(),
    route: "GET /v1/vessels/:code/capacity",
    web: vesselLink,
  }),
  defineRestWrite({
    name: "cellar_vessel_capacity_record",
    module: "cellar",
    scope: "cellar.operate",
    title: "Registrar nueva capacidad (aforo)",
    description: "Anota un aforo del depósito: cambia su capacidad y deja constancia en el historial. No puede quedar por debajo del vino que tiene.",
    input: z.object({
      code: vesselCode,
      capacity_ml: ml("Capacidad nueva"),
      reason: z.string().max(500).optional().describe("Motivo, p. ej. 'Aforo oficial 2026'"),
    }).strict(),
    route: "POST /v1/vessels/:code/capacity",
    current: { route: "GET /v1/vessels/:code" },
    summary: (input, current) => `Cambiar la capacidad de ${input.code} de ${litres(asRecord(current).capacity_ml)} a ${litres(input.capacity_ml)}; queda en el historial de aforos. ¿Confirmas?`,
    web: vesselLink,
  }),
  defineRestRead({
    name: "cellar_barrel_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Ficha de la barrica",
    description: "Roble, bosque, tostado, tonelería, año, volumen nominal, compra, número de usos y estado (en uso, en reposo, para retirar, retirada) de una barrica.",
    input: z.object({ code: vesselCode }).strict(),
    route: "GET /v1/vessels/:code/barrel",
    web: vesselLink,
  }),
  defineRestWrite({
    name: "cellar_barrel_create",
    module: "cellar",
    scope: "cellar.operate",
    title: "Crear ficha de barrica",
    description: "Completa la ficha de una barrica ya dada de alta como recipiente: origen del roble, tostado, tonelería, año y compra. El número de usos lo calcula la app con los llenados.",
    input: z.object({ code: vesselCode, barrel: barrelCreateFields }).strict(),
    route: "POST /v1/vessels/:code/barrel",
    current: { route: "GET /v1/vessels/:code" },
    send: (input) => input.barrel,
    summary: (input) => `Crear la ficha de la barrica ${input.code}: roble ${input.barrel.oak_origin}, tostado ${input.barrel.toast}, ${input.barrel.cooper} ${input.barrel.year_made}. ¿Confirmas?`,
    web: vesselLink,
  }),
  defineRestWrite({
    name: "cellar_barrel_update",
    module: "cellar",
    scope: "cellar.operate",
    title: "Editar ficha de barrica",
    description: "Cambia datos de la ficha de una barrica o su estado (en uso, en reposo, para retirar, retirada con fecha). Solo hace falta mandar lo que cambia.",
    input: z.object({ code: vesselCode, changes: barrelChanges }).strict(),
    route: "PATCH /v1/vessels/:code/barrel",
    current: { route: "GET /v1/vessels/:code/barrel" },
    send: (input) => input.changes,
    summary: (input) => input.changes.status === "retired"
      ? `Marcar la barrica ${input.code} como retirada${input.changes.retired_on ? ` el ${input.changes.retired_on}` : ""}. ¿Confirmas?`
      : `Editar la ficha de la barrica ${input.code}. ¿Confirmas?`,
    web: vesselLink,
  }),
  defineRestRead({
    name: "cellar_vessel_demijohn_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Damajuana: crianza a la intemperie",
    description: "Si una damajuana está en crianza a la intemperie.",
    input: z.object({ code: vesselCode }).strict(),
    route: "GET /v1/vessels/:code/demijohn",
    web: vesselLink,
  }),
  defineRestWrite({
    name: "cellar_vessel_demijohn_set",
    module: "cellar",
    scope: "cellar.operate",
    title: "Marcar crianza a la intemperie",
    description: "Pone o quita la crianza a la intemperie de una damajuana (solo las de cristal).",
    input: z.object({ code: vesselCode, outdoor_aging: z.boolean() }).strict(),
    route: "PUT /v1/vessels/:code/demijohn",
    current: { route: "GET /v1/vessels/:code/demijohn" },
    summary: (input) => `${input.outdoor_aging ? "Poner" : "Quitar"} la crianza a la intemperie de la damajuana ${input.code}. ¿Confirmas?`,
    web: vesselLink,
  }),
  defineRestWrite({
    name: "cellar_barrels_use_count_recalculate",
    module: "cellar",
    scope: "settings.manage",
    title: "Recalcular usos de las barricas",
    description: "Pone el número de usos de todas las barricas igual a sus llenados, completando los que falten a partir del libro de existencias. Repetirlo no cambia el resultado. Solo el propietario.",
    input: z.object({}).strict(),
    route: "POST /v1/barrels/use-count-backfill",
    summary: () => "Recalcular el número de usos de todas las barricas a partir de los llenados del libro. No mueve vino y se puede repetir sin cambiar el resultado. ¿Confirmas?",
  }),

  defineRestRead({
    name: "cellar_operations_browse",
    module: "cellar",
    scope: "cellar.read",
    title: "Operaciones de bodega (lista completa)",
    description: "Las operaciones de bodega como las lista la app (trasiegos, coupages, embotellados, mermas, adiciones, limpiezas, elaboración…), con cabecera completa y filtros por tipo, estado y sociedad, de la más reciente a la más antigua y paginadas con next_cursor.",
    input: z.object({
      op_type: z.enum(LISTED_TYPES).optional(),
      status: z.enum(OPERATION_STATUSES).optional().describe("draft borrador, confirmed confirmada, rectified rectificada, discarded descartada"),
      legal_entity_id: id.optional(),
      limit,
      cursor: z.string().max(200).optional(),
    }).strict(),
    route: "GET /v1/cellar-operations",
  }),
  defineRestRead({
    name: "cellar_operation_detail_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Operación de bodega completa",
    description: "La operación tal como la ve la app: cabecera, datos del borrador, líneas, movimientos de existencias y fiscales, lotes nuevos, adición y limpieza.",
    input: z.object({ id }).strict(),
    route: "GET /v1/cellar-operations/:id",
    web: operationLink,
  }),
  defineRestWrite({
    name: "cellar_operation_create",
    module: "cellar",
    scope: "cellar.operate",
    title: "Nueva operación de bodega (borrador)",
    description: "Crea en borrador cualquier operación de bodega con el formulario de la app (ids de recipientes y lotes, volúmenes en ml): trasiego, coupage, embotellado, merma, adición, limpieza, estrujado, fermentación, sangrado, descube, toma de muestras… No mueve vino hasta confirmarla con cellar_operation_confirm.",
    input: operationFields,
    route: "POST /v1/cellar-operations",
    summary: (input) => `Crear un borrador de ${opLabel(input.op_type)}${volumes(input.lines)}. Todavía no mueve vino: queda en borrador hasta confirmarlo.${needsApproval(input) ? " Lleva merma por incidencia o es una destrucción: se pedirá aprobación antes de poder confirmarla." : ""} ¿Confirmas?`,
    web: createdOperationLink,
  }),
  defineRestWrite({
    name: "cellar_operation_update",
    module: "cellar",
    scope: "cellar.operate",
    title: "Editar borrador de operación",
    description: "Cambia un borrador de operación de bodega (fecha, quién la hizo, líneas, volúmenes, lote nuevo…). Solo hace falta mandar lo que cambia; si mandas lines sustituyen a todas, y si cambias occurred_at sin fiscal_date la fecha fiscal pasa a ser ese día. Una operación confirmada no se edita: se rectifica.",
    input: z.object({ id, changes: operationChanges }).strict(),
    route: "PATCH /v1/cellar-operations/:id",
    current: { route: "GET /v1/cellar-operations/:id" },
    send: (input, current) => draftBody(current, input.changes),
    summary: (input, current) => {
      const operation = asRecord(current);
      return `Cambiar el borrador de ${opLabel(input.changes.op_type ?? operation.op_type)} del ${day(operation.occurred_at)}. Sigue en borrador y no mueve vino. ¿Confirmas?`;
    },
    web: operationLink,
  }),
  defineRestRead({
    name: "cellar_operation_preview",
    module: "cellar",
    scope: "cellar.operate",
    title: "Vista previa de confirmar una operación",
    description: "Calcula lo que haría confirmar el borrador sin guardar nada: movimientos de existencias y fiscales, lotes nuevos, cómo quedan los depósitos, materiales de embotellado y avisos enológicos.",
    input: z.object({ id }).strict(),
    route: "POST /v1/cellar-operations/:id/preview",
    computeOnly: "Simula la confirmación del borrador y devuelve sus efectos; no escribe en ningún libro.",
    web: operationLink,
  }),
  defineRestWrite({
    name: "cellar_operation_confirm",
    module: "cellar",
    scope: "cellar.operate",
    title: "Confirmar operación de bodega",
    description: "Confirma un borrador: mueve el vino entre recipientes, escribe los libros de existencias y fiscal (SILICIE), crea los lotes nuevos y le da número. Si lleva merma por incidencia o es una destrucción, antes tiene que estar aprobada.",
    input: z.object({ id }).strict(),
    route: "POST /v1/cellar-operations/:id/confirm",
    current: { route: "GET /v1/cellar-operations/:id" },
    summary: (_input, current) => {
      const operation = asRecord(current);
      return `Confirmar la operación de ${opLabel(operation.op_type)} del ${day(operation.occurred_at)}${volumes(operation.lines)}. Mueve el vino en los recipientes y en los libros de existencias y fiscal, y le da número. No se deshace: solo se corrige con una rectificación. ¿Confirmas?`;
    },
    web: operationLink,
  }),
  defineRestWrite({
    name: "cellar_operation_rectify",
    module: "cellar",
    scope: "cellar.operate",
    title: "Rectificar operación confirmada",
    description: "Corrige una operación ya confirmada creando otra que deshace sus movimientos de vino y del libro fiscal; la original queda como rectificada. Después se puede registrar la operación buena.",
    input: z.object({ id, reason: z.string().min(1).max(500).describe("Motivo de la rectificación") }).strict(),
    route: "POST /v1/cellar-operations/:id/rectify",
    current: { route: "GET /v1/cellar-operations/:id" },
    summary: (input, current) => {
      const operation = asRecord(current);
      const number = typeof operation.number === "string" ? ` ${operation.number}` : "";
      return `Rectificar la operación${number} de ${opLabel(operation.op_type)} del ${day(operation.occurred_at)} por: ${input.reason}. Se crea una operación nueva que devuelve el vino y deshace sus movimientos fiscales; la original queda rectificada. No se puede deshacer. ¿Confirmas?`;
    },
    web: createdOperationLink,
  }),

  defineRestRead({
    name: "cellar_map_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Plano de la bodega",
    description: "El plano de una ubicación: sus zonas con los depósitos, barricas, nichos y jaulones colocados (posición, contenido y llenado) y los recipientes sin colocar.",
    input: z.object({
      location_id: id.optional(),
      location: code.optional().describe("Código de la ubicación, p. ej. BOD; o location_id"),
    }).strict(),
    route: "GET /v1/cellar-map",
    web: planLink,
  }),
  defineRestRead({
    name: "cellar_zones_list",
    module: "cellar",
    scope: "cellar.read",
    title: "Zonas del plano",
    description: "Las zonas de la bodega (nave de elaboración, sala de barricas, exterior, almacén de botellas) con lo que hay colocado en cada una.",
    input: z.object({
      location_id: id.optional(),
      kind: z.enum(ZONE_KINDS).optional(),
      limit,
    }).strict(),
    route: "GET /v1/cellar-zones",
    web: planLink,
  }),
  defineRestRead({
    name: "cellar_zone_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Zona del plano",
    description: "Una zona con sus posiciones en el plano (el id de cada una hace falta para moverla o quitarla).",
    input: z.object({ code: zoneCode }).strict(),
    route: "GET /v1/cellar-zones/:code",
    web: planLink,
  }),
  defineRestWrite({
    name: "cellar_zone_create",
    module: "cellar",
    scope: "cellar.operate",
    title: "Nueva zona del plano",
    description: "Crea una zona en una ubicación: nave de elaboración, sala de barricas, exterior, almacén de botellas u otra.",
    input: z.object({
      location_id: id,
      code: zoneCode,
      name: z.string().min(1).max(120),
      kind: z.enum(ZONE_KINDS).describe("elaboration nave de elaboración, barrel_room sala de barricas, outdoor exterior, bottle_store almacén de botellas, other otra"),
      plan_attachment_id: id.optional().describe("Adjunto con el dibujo del plano"),
      notes: z.string().max(2000).optional(),
    }).strict(),
    route: "POST /v1/cellar-zones",
    web: planLink,
  }),
  defineRestWrite({
    name: "cellar_zone_update",
    module: "cellar",
    scope: "cellar.operate",
    title: "Editar zona del plano",
    description: "Cambia nombre, tipo, plano adjunto o notas de una zona, o la archiva (is_active false). Solo hace falta mandar lo que cambia.",
    input: z.object({
      code: zoneCode,
      changes: z.object({
        name: z.string().min(1).max(120).optional(),
        kind: z.enum(ZONE_KINDS).optional(),
        plan_attachment_id: id.nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        is_active: z.boolean().optional().describe("false archiva la zona"),
      }).strict(),
    }).strict(),
    route: "PATCH /v1/cellar-zones/:code",
    current: { route: "GET /v1/cellar-zones/:code" },
    send: (input) => input.changes,
    summary: (input) => input.changes.is_active === false
      ? `Archivar la zona ${input.code}: deja de admitir recipientes nuevos en el plano. Los recipientes y su vino no cambian. ¿Confirmas?`
      : `Editar la zona ${input.code}. ¿Confirmas?`,
    web: planLink,
  }),
  defineRestWrite({
    name: "cellar_zone_position_add",
    module: "cellar",
    scope: "cellar.operate",
    title: "Colocar en el plano",
    description: "Coloca un recipiente o un nicho/jaulón de la misma ubicación en una zona del plano, con su posición y tamaño. Indica el recipiente o el soporte, no los dos.",
    input: z.object({
      code: zoneCode,
      vessel_code: code.optional().describe("Recipiente a colocar"),
      vessel_id: id.optional(),
      holder_code: code.optional().describe("Nicho o jaulón a colocar"),
      holder_id: id.optional(),
      x: coordinate("x"),
      y: coordinate("y"),
      width: span("Ancho"),
      height: span("Alto"),
      rotation,
    }).strict(),
    route: "POST /v1/cellar-zones/:code/positions",
    current: { route: "GET /v1/cellar-zones/:code" },
    summary: (input) => `Colocar ${input.vessel_code ?? input.holder_code ?? "el elemento"} en el plano de la zona ${input.code}. ¿Confirmas?`,
    web: planLink,
  }),
  defineRestWrite({
    name: "cellar_zone_position_update",
    module: "cellar",
    scope: "cellar.operate",
    title: "Mover en el plano",
    description: "Mueve, redimensiona o gira una posición del plano (el id sale en cellar_zone_get). Solo hace falta mandar lo que cambia.",
    input: z.object({ code: zoneCode, position_id: id, changes: positionChanges }).strict(),
    route: "PATCH /v1/cellar-zones/:code/positions/:positionId",
    params: { positionId: "position_id" },
    current: { route: "GET /v1/cellar-zones/:code" },
    send: (input) => input.changes,
    web: planLink,
  }),
  defineRestWrite({
    name: "cellar_zone_position_remove",
    module: "cellar",
    scope: "cellar.operate",
    title: "Quitar del plano",
    description: "Quita una posición del plano de una zona. El recipiente o soporte sigue existiendo con su contenido; solo deja de dibujarse.",
    input: z.object({ code: zoneCode, position_id: id }).strict(),
    route: "DELETE /v1/cellar-zones/:code/positions/:positionId",
    params: { positionId: "position_id" },
    current: { route: "GET /v1/cellar-zones/:code" },
    summary: (input, current) => {
      const positions = asRecord(current).positions;
      const found = Array.isArray(positions) ? positions.map(asRecord).find((item) => item.id === input.position_id) : undefined;
      const what = found?.vessel_code ?? found?.holder_code;
      return `Quitar ${typeof what === "string" ? what : "esa posición"} del plano de la zona ${input.code}. No mueve vino ni da de baja nada. ¿Confirmas?`;
    },
    web: planLink,
  }),

  defineRestRead({
    name: "cellar_holders_list",
    module: "cellar",
    scope: "cellar.read",
    title: "Nichos y jaulones",
    description: "Los nichos y jaulones de botellas con cuántas tienen, de qué lote y su llenado.",
    input: z.object({
      location_id: id.optional(),
      kind: z.enum(HOLDER_KINDS).optional(),
      limit,
    }).strict(),
    route: "GET /v1/holders",
    web: () => "/bodega/contenedores",
  }),
  defineRestRead({
    name: "cellar_holder_get",
    module: "cellar",
    scope: "cellar.read",
    title: "Nicho o jaulón",
    description: "Un nicho o jaulón con su capacidad en botellas, formato y saldo por lote, producto y estado.",
    input: z.object({ code: holderCode }).strict(),
    route: "GET /v1/holders/:code",
    web: holderLink,
  }),
  defineRestRead({
    name: "cellar_holder_moves_list",
    module: "cellar",
    scope: "cellar.read",
    title: "Movimientos del nicho o jaulón",
    description: "Las entradas y salidas de botellas de un nicho o jaulón, de la más reciente a la más antigua, paginadas con next_cursor.",
    input: z.object({
      code: z.string().min(2).max(36).describe("Código del nicho o jaulón (o su id)"),
      limit,
      cursor: z.string().max(200).optional(),
    }).strict(),
    route: "GET /v1/holders/:code/moves",
    web: holderLink,
  }),
  defineRestWrite({
    name: "cellar_holder_create",
    module: "cellar",
    scope: "cellar.operate",
    title: "Nuevo nicho o jaulón",
    description: "Da de alta un nicho o un jaulón de botellas en una ubicación. El jaulón exige número, capacidad en botellas y volumen de botella.",
    input: z.object({
      code: holderCode,
      name: z.string().min(1).max(120),
      kind: z.enum(HOLDER_KINDS).describe("nicho o jaulon"),
      location_id: id,
      zone_id: id.optional().describe("Zona del plano"),
      number: z.number().int().positive().optional().describe("Número del jaulón; único entre los jaulones activos de la ubicación"),
      capacity_bottles: z.number().int().positive().optional().describe("Capacidad en botellas"),
      nominal_volume_ml: z.number().int().positive().optional().describe("Volumen de la botella en ml (750)"),
      format: z.string().regex(/^[A-Z0-9]{2,10}$/).optional().describe("Código del formato, p. ej. B075"),
      notes: z.string().max(2000).optional(),
    }).strict(),
    route: "POST /v1/holders",
    web: holderLink,
  }),
  defineRestWrite({
    name: "cellar_holder_update",
    module: "cellar",
    scope: "cellar.operate",
    title: "Editar nicho o jaulón",
    description: "Cambia nombre, zona, número, capacidad, formato o notas de un nicho o jaulón, o lo archiva. La capacidad no puede quedar por debajo de las botellas que tiene. Solo hace falta mandar lo que cambia.",
    input: z.object({ code: holderCode, changes: holderChanges }).strict(),
    route: "PATCH /v1/holders/:code",
    current: { route: "GET /v1/holders/:code" },
    send: (input) => input.changes,
    web: holderLink,
  }),
  defineRestWrite({
    name: "cellar_holder_move_record",
    module: "cellar",
    scope: "cellar.operate",
    title: "Meter o sacar botellas",
    description: "Anota botellas que entran (cantidad positiva) o salen (negativa) de un nicho o jaulón. Un soporte guarda un solo lote; el jaulón solo vino embotellado sin etiquetar.",
    input: z.object({
      code: holderCode,
      occurred_at: instant.describe("Cuándo, ISO-8601 con zona"),
      owner_entity_id: id.describe("Sociedad dueña de las botellas"),
      lot_id: id,
      product_id: id.describe("Producto embotellado"),
      product_state: z.enum(["packaged_unlabeled", "packaged_labeled"]).describe("Sin etiquetar o etiquetado"),
      qty_units: z.number().int().refine((value) => value !== 0, "Distinto de cero").describe("Botellas: positivo entran, negativo salen"),
    }).strict(),
    route: "POST /v1/holders/:code/moves",
    current: { route: "GET /v1/holders/:code" },
    summary: (input, current) => {
      const kind = asRecord(current).kind_label;
      const where = `${typeof kind === "string" ? kind : "soporte"} ${input.code}`;
      const bottles = Math.abs(input.qty_units);
      return input.qty_units > 0
        ? `Meter ${bottles} botellas en el ${where}. ¿Confirmas?`
        : `Sacar ${bottles} botellas del ${where}. ¿Confirmas?`;
    },
    web: holderLink,
  }),
];
