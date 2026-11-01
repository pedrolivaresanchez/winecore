import { z } from "zod";

import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite, patchOnto } from "../../rest";

const id = z.string().uuid();
const code = z.string().regex(/^[A-Z0-9-]{2,20}$/);
const parcelCode = code.describe("Código de la parcela, en mayúsculas (p. ej. P-07)");
const varietyCode = code.describe("Código de la variedad, en mayúsculas (p. ej. TEMPRANILLO)");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/);
const year = z.number().int().min(1990).max(2100);
const campaignYear = year.describe("Campaña (año de la vendimia)");
const notebookCampaign = z.string().regex(/^\d{4}(\/\d{4})?$/)
  .describe("AAAA para el año natural o AAAA/AAAA+1 para la campaña del 1 de agosto al 31 de julio");
const asOf = day.optional().describe("Fecha AAAA-MM-DD a la que se calculan avisos y plazos; por defecto, hoy");

const hectares = z.string().regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,4})?$/);
const kilos = z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,3})?$/);
const measure = z.string().regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/);
const sources = z.enum(["manual", "voice", "chat"]).optional().describe("Cómo se tomó el dato; chat si llega por conversación");

const PARCEL_KINDS = ["phytosanitary", "fertiliser", "other"] as const;
const DOSE_UNITS = ["kg/ha", "l/ha", "g/hl", "ml/hl"] as const;

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(record: unknown, key: string): string {
  const value = isRecord(record) ? record[key] : undefined;
  return value === undefined || value === null ? "" : String(value);
}

function ticketOf(current: unknown): Fields {
  return isRecord(current) && isRecord(current.ticket) ? current.ticket : {};
}

function bodyId(body: unknown): string {
  return field(body, "id");
}

const vineyard = "/vinedo";
const parcelLink = (input: { code: string }) => `/vinedo/${input.code}`;
const section = (name: string) => () => `/vinedo?seccion=${name}`;
const receptionLink = (receptionId: string) => `/vinedo?seccion=recepcion${receptionId ? `&ticket=${receptionId}` : ""}`;

const varietyFields = z.object({
  name: z.string().min(1).max(80),
  color: z.enum(["red", "white"]).describe("red tinta, white blanca"),
  is_active: z.boolean().optional(),
}).strict();

const parcelVariety = z.object({
  variety: varietyCode,
  area_ha: hectares.describe("Hectáreas de esa variedad, hasta 4 decimales"),
  planting_year: z.number().int().min(1900).max(2100).nullable().optional().describe("Año de plantación"),
  rootstock: z.string().max(40).nullable().optional().describe("Portainjerto"),
  color: z.enum(["red", "white"]).optional().describe("Si se indica, tiene que coincidir con el catálogo de variedades"),
}).strict();

const parcelFields = {
  name: z.string().min(1).max(120),
  ownership: z.enum(["own", "leased", "supplier"]).describe("own propia, leased arrendada, supplier de un viticultor proveedor"),
  supplier_contact_id: id.nullable().optional().describe("Contacto del viticultor; solo y obligatorio si ownership es supplier"),
  sigpac: z.string().regex(/^\d{1,6}(?::\d{1,6}){6}$/)
    .describe("Referencia SIGPAC provincia:municipio:agregado:zona:polígono:parcela:recinto (p. ej. 23:50:0:0:7:1:1)"),
  area_ha: hectares.describe("Superficie de la parcela en hectáreas, hasta 4 decimales"),
  organic_status: z.enum(["organic", "in_conversion", "conventional"]).optional()
    .describe("organic ecológica, in_conversion en conversión, conventional convencional; si no se indica, ecológica"),
  organic_since: day.nullable().optional().describe("Fecha AAAA-MM-DD desde la que es ecológica; obligatoria si es ecológica"),
  conversion_started_on: day.nullable().optional().describe("Fecha AAAA-MM-DD de inicio de la conversión; obligatoria si está en conversión"),
  vineyard_register_ref: z.string().max(40).nullable().optional().describe("Referencia del registro vitícola"),
  appellation: z.string().max(80).nullable().optional().describe("Denominación de origen"),
  altitude_m: z.number().int().min(0).max(4000).nullable().optional().describe("Altitud en metros"),
  soil: z.string().max(120).nullable().optional().describe("Tipo de suelo"),
  notes: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional().describe("false para dar de baja la parcela sin borrar su historial"),
  varieties: z.array(parcelVariety).min(1)
    .describe("Variedades plantadas; la suma de sus hectáreas no puede superar la de la parcela"),
};

const intakeFields = z.object({
  container: z.enum(["box", "bin", "tank_trailer", "bulk", "other"]).describe("box cajas, bin palots, tank_trailer remolque cisterna, bulk a granel"),
  container_count: z.number().int().min(1).max(100000).nullable().optional().describe("Número de envases; obligatorio con cajas"),
  container_nominal_kg: measure.nullable().optional().describe("Kilos nominales por envase, hasta 2 decimales"),
  weighing: z.enum(["weighed", "estimated"]).describe("weighed pesada en báscula, estimated estimada"),
  sanitary_state: z.enum(["healthy", "minor", "affected", "severe"]).describe("Estado sanitario de la uva al llegar"),
  botrytis_pct: measure.nullable().optional().describe("Porcentaje de botritis, de 0 a 100"),
  storm_damage: z.boolean().optional().describe("Daño por tormenta o granizo"),
  overripe: z.boolean().optional().describe("Sobremadura"),
  raisined: z.boolean().optional().describe("Pasificada"),
  microbial_notes: z.string().max(500).nullable().optional(),
  decision: z.enum(["accepted", "segregated", "rejected"]).optional()
    .describe("accepted aceptada, segregated se acepta en un lote aparte, rejected rechazada; por defecto aceptada"),
  grape_temperature_c: z.string().regex(/^-?(?:0|[1-9]\d{0,2})(?:\.\d)?$/).nullable().optional()
    .describe("Temperatura de la uva en grados, un decimal, de -5 a 50"),
}).strict();

const receptionFields = {
  legal_entity_id: id.describe("Sociedad que recibe la uva: la que controla la ubicación del depósito"),
  performed_by: z.string().min(1).max(120).describe("Quién pesó la uva"),
  occurred_at: instant.describe("Momento de la pesada, ISO-8601 con zona (p. ej. 2026-10-15T10:00:00+02:00); no puede ser futuro"),
  variety_code: varietyCode,
  gross_kg: kilos.describe("Peso bruto en kg, hasta 3 decimales"),
  tare_kg: kilos.describe("Tara en kg, hasta 3 decimales"),
  net_kg: kilos.describe("Peso neto en kg: bruto menos tara"),
  probable_abv: measure.describe("Grado probable en % vol, hasta 2 decimales"),
  sanitary_status: z.enum(["good", "fair", "poor"]).describe("Sanidad general: good buena, fair regular, poor mala"),
  is_organic: z.boolean().describe("Uva ecológica; tiene que coincidir con las parcelas"),
  organic_label_checked: z.boolean().describe("Se comprobó la etiqueta ecológica; obligatorio si es ecológica"),
  has_do: z.boolean().describe("Uva con denominación de origen"),
  appellation: z.string().max(80).nullable().optional().describe("Denominación de origen; solo y obligatoria si has_do"),
  accompanying_doc: z.string().max(80).nullable().optional().describe("Documento de acompañamiento"),
  destination_vessel_id: id.describe("Depósito de destino, en servicio y vacío al confirmar"),
  lot_code: z.string().regex(/^[A-Z0-9][A-Z0-9./-]{1,29}$/).describe("Código del lote de uva que se creará, en mayúsculas"),
  vintage: year.describe("Añada"),
  parcels: z.array(z.object({
    parcel_code: parcelCode,
    kg: kilos.describe("Kilos de esa parcela"),
  }).strict()).min(1).optional().describe("Parcelas de origen con sus kilos, que suman el neto; o esto o grower_contact_id"),
  grower_contact_id: id.optional().describe("Viticultor externo sin parcela registrada; o esto o parcels"),
  intake: intakeFields.describe("Envases, pesada y sanidad de la uva"),
};

const RECEPTION_KEYS = [
  "legal_entity_id", "performed_by", "occurred_at", "variety_code", "gross_kg", "tare_kg", "net_kg",
  "probable_abv", "sanitary_status", "is_organic", "organic_label_checked", "has_do", "appellation",
  "accompanying_doc", "destination_vessel_id", "lot_code", "vintage", "parcels", "grower_contact_id", "intake",
] as const;

/** The PATCH replaces the whole ticket: the stored one, flattened back to the body the route reads. */
function receptionRecord(current: unknown): Fields {
  const ticket = ticketOf(current);
  const source = isRecord(ticket.source) ? ticket.source : {};
  const record: Fields = {
    ...ticket,
    legal_entity_id: field(current, "legal_entity_id"),
    performed_by: field(current, "performed_by"),
    occurred_at: ticket.weighed_at,
  };
  if (source.kind === "parcels" && Array.isArray(source.lines)) {
    record.parcels = source.lines.filter(isRecord).map((line) => ({ parcel_code: line.parcel_code, kg: line.kg }));
  }
  if (source.kind === "grower") record.grower_contact_id = source.contact_id;
  return record;
}

function receptionLabel(current: unknown): string {
  const ticket = ticketOf(current);
  const name = field(current, "number") || field(ticket, "lot_code") || "en borrador";
  const net = field(ticket, "net_kg");
  const variety = field(ticket, "variety_code");
  return `${name}${net ? ` (${net} kg${variety ? ` de ${variety}` : ""})` : ""}`;
}

const CREW_KEYS = ["people", "notes"] as const;

function crewDay(current: unknown, date: string): unknown {
  const items = isRecord(current) && Array.isArray(current.items) ? current.items : [];
  return items.find((item) => isRecord(item) && item.day === date) ?? null;
}

const treatmentParcel = z.object({
  parcel_id: id,
  treated_area_ha: z.string().regex(/^\d{1,4}(\.\d{1,4})?$/).optional()
    .describe("Hectáreas tratadas en esa parcela; por defecto, toda la parcela"),
}).strict();

const productFields = {
  commercial_name: z.string().min(1).max(160).describe("Nombre comercial"),
  registration_number: z.string().max(80).nullable().optional().describe("Número de registro; obligatorio en fitosanitarios"),
  active_substances: z.string().min(1).max(500).describe("Materias activas"),
  is_organic_approved: z.boolean().describe("Autorizado en agricultura ecológica"),
  safety_interval_days: z.number().int().min(0).max(3650).describe("Plazo de seguridad en días antes de vendimiar"),
  max_dose: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/).describe("Dosis máxima autorizada, hasta 4 decimales"),
  max_dose_unit: z.enum(DOSE_UNITS).describe("Unidad de la dosis máxima; los tratamientos con este producto usan la misma"),
  nutrient_npk: z.string().max(40).nullable().optional().describe("Riqueza N-P-K en fertilizantes (p. ej. 2-1-2)"),
  notes: z.string().max(1000).nullable().optional(),
};

export const vineyardRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "vineyard_grape_varieties_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Catálogo de variedades de uva",
    description: "Las variedades de uva del catálogo (código, nombre, tinta o blanca, activa). Los códigos son los que se usan en parcelas, vendimias y entradas de uva.",
    input: z.object({}).strict(),
    route: "GET /v1/grape-varieties",
  }),
  defineRestRead({
    name: "vineyard_grape_variety_get",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Variedad de uva",
    description: "Una variedad del catálogo por su código.",
    input: z.object({ code: varietyCode }).strict(),
    route: "GET /v1/grape-varieties/:code",
  }),
  defineRestWrite({
    name: "vineyard_grape_variety_create",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Alta de variedad de uva",
    description: "Añade una variedad al catálogo con su código, nombre y color (tinta o blanca), para poder plantarla en parcelas y recibirla en bodega.",
    input: z.object({ code: varietyCode, ...varietyFields.shape }).strict(),
    route: "POST /v1/grape-varieties",
    summary: (input) => `Se añade la variedad ${input.code} «${input.name}» (${input.color === "red" ? "tinta" : "blanca"}) al catálogo. ¿Confirmas?`,
  }),
  defineRestWrite({
    name: "vineyard_grape_variety_update",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Editar variedad de uva",
    description: "Cambia el nombre o el color de una variedad, o la desactiva (is_active false) para que no se pueda usar en altas nuevas. Solo hace falta mandar lo que cambia.",
    input: z.object({ code: varietyCode, changes: varietyFields.partial().strict() }).strict(),
    route: "PATCH /v1/grape-varieties/:code",
    current: { route: "GET /v1/grape-varieties/:code" },
    send: (input) => input.changes,
  }),
  defineRestRead({
    name: "vineyard_parcels_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Parcelas de viñedo",
    description: "Todas las parcelas con su código, SIGPAC, hectáreas, régimen (propia, arrendada o de proveedor), estado ecológico y variedades plantadas. El id de cada parcela es el que piden los tratamientos y el cuaderno de campo.",
    input: z.object({}).strict(),
    route: "GET /v1/parcels",
    web: () => vineyard,
  }),
  defineRestRead({
    name: "vineyard_parcels_summary_get",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Resumen del viñedo",
    description: "Hectáreas totales, número de parcelas y si la explotación cabe en el cuaderno de campo simplificado.",
    input: z.object({}).strict(),
    route: "GET /v1/parcels/summary",
    web: () => vineyard,
  }),
  defineRestRead({
    name: "vineyard_parcel_options_list",
    module: "vineyard",
    scope: "vineyard.read",
    extraScopes: ["cellar.read", "catalog.read"],
    title: "Selector de parcelas activas",
    description: "Lista corta de parcelas activas (id, código, nombre, hectáreas y estado ecológico), la que usan los selectores de catas, diseño de lote y cuaderno.",
    input: z.object({}).strict(),
    route: "GET /v1/parcels/options",
  }),
  defineRestRead({
    name: "vineyard_parcel_get",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Ficha de parcela",
    description: "La ficha de una parcela: SIGPAC, hectáreas, régimen, estado ecológico, variedades plantadas y su última analítica de uva.",
    input: z.object({ code: parcelCode }).strict(),
    route: "GET /v1/parcels/:code",
    web: parcelLink,
  }),
  defineRestWrite({
    name: "vineyard_parcel_create",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Alta de parcela",
    description: "Da de alta una parcela de viñedo con su código, nombre, referencia SIGPAC, hectáreas, régimen, estado ecológico y las variedades plantadas con sus hectáreas.",
    input: z.object({ code: parcelCode, ...parcelFields }).strict(),
    route: "POST /v1/parcels",
    summary: (input) => `Se da de alta la parcela ${input.code} «${input.name}» (${input.area_ha} ha, SIGPAC ${input.sigpac}) con ${input.varieties.map((item) => item.variety).join(", ")}. ¿Confirmas?`,
    web: parcelLink,
  }),
  defineRestWrite({
    name: "vineyard_parcel_update",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Editar parcela",
    description: "Cambia los datos de una parcela (nombre, SIGPAC, hectáreas, régimen, estado ecológico y fechas, altitud, suelo, notas) o la da de baja con is_active false. Solo hace falta mandar lo que cambia; null borra un dato opcional. Si mandas variedades, sustituyen a todas las de la parcela.",
    input: z.object({ code: parcelCode, changes: z.object(parcelFields).partial().strict() }).strict(),
    route: "PATCH /v1/parcels/:code",
    current: { route: "GET /v1/parcels/:code" },
    send: (input) => input.changes,
    web: parcelLink,
  }),
  defineRestRead({
    name: "vineyard_parcel_analyses_list",
    module: "vineyard",
    scope: "cellar.read",
    title: "Analíticas de uva de la parcela",
    description: "Las analíticas de uva de una parcela activa, de la más reciente a la más antigua, con laboratorio y resultados por parámetro.",
    input: z.object({ code: parcelCode }).strict(),
    route: "GET /v1/parcels/:code/analyses",
    web: parcelLink,
  }),
  defineRestWrite({
    name: "vineyard_parcel_analysis_create",
    module: "vineyard",
    scope: "cellar.operate",
    title: "Registrar analítica de uva de la parcela",
    description: "Anota una analítica de uva de una parcela activa: cuándo se tomó la muestra, el laboratorio y los resultados por parámetro con su unidad (p. ej. probable_abv en «% vol», total_acidity en «g/L», ph en «pH»).",
    input: z.object({
      code: parcelCode,
      at: instant.describe("Momento de la toma de muestra, ISO-8601 con zona"),
      result_at: instant.optional().describe("Momento del resultado, ISO-8601 con zona; no anterior a la muestra"),
      lab: z.string().min(1).max(120).describe("internal laboratorio propio, external externo, o directamente el nombre del laboratorio externo"),
      lab_name: z.string().max(120).optional().describe("Nombre del laboratorio cuando lab es internal o external"),
      lab_contact_id: id.optional().describe("Contacto del laboratorio"),
      report_attachment_id: id.optional().describe("Informe PDF ya subido como adjunto"),
      results: z.array(z.object({
        parameter: z.string().min(1).max(40).describe("Código del parámetro (p. ej. probable_abv, total_acidity, ph, malic_acid)"),
        unit: z.string().min(1).max(20).describe("Unidad del parámetro, la del catálogo de analíticas"),
        value: z.string().regex(/^-?\d{1,8}(\.\d{1,4})?$/).describe("Valor, hasta 4 decimales"),
      }).strict()).min(1),
    }).strict(),
    route: "POST /v1/parcels/:code/analyses",
    current: { route: "GET /v1/parcels/:code" },
    summary: (input) => `Se anota una analítica de uva de la parcela ${input.code} con ${input.results.length} resultado(s). ¿Confirmas?`,
    web: parcelLink,
  }),
  defineRestRead({
    name: "vineyard_field_tasks_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Labores de campo",
    description: "Las labores hechas en el viñedo (poda, laboreo, desbroce, poda en verde, vendimia, plantación…), de la más reciente a la más antigua; con parcel_code, solo las de esa parcela.",
    input: z.object({ parcel_code: parcelCode.optional() }).strict(),
    route: "GET /v1/field-tasks",
    web: (input) => (input.parcel_code ? `/vinedo/${input.parcel_code}` : vineyard),
  }),
  defineRestWrite({
    name: "vineyard_field_task_create",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Anotar labor de campo",
    description: "Anota una labor ya hecha en una parcela activa: tipo, fecha, quién la hizo (persona o cuadrilla), horas y notas.",
    input: z.object({
      parcel_code: parcelCode,
      done_on: day.describe("Fecha AAAA-MM-DD en que se hizo; no puede ser futura"),
      kind: z.enum(["pruning", "tillage", "mowing", "green_pruning", "harvest", "planting", "other"])
        .describe("pruning poda, tillage laboreo, mowing desbroce, green_pruning poda en verde, harvest vendimia, planting plantación, other otra"),
      source: sources,
      operator_name: z.string().max(120).optional().describe("Quién la hizo: persona o cuadrilla"),
      hours: measure.optional().describe("Horas de trabajo, hasta 2 decimales"),
      notes: z.string().max(2000).optional(),
    }).strict(),
    route: "POST /v1/field-tasks",
    summary: (input) => `Se anota la labor ${input.kind} del ${input.done_on} en la parcela ${input.parcel_code}. ¿Confirmas?`,
    web: (input) => `/vinedo/${input.parcel_code}`,
  }),
  defineRestRead({
    name: "vineyard_maturity_checks_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Controles de maduración",
    description: "Los controles de maduración (azúcar, grado probable, acidez, pH, sanidad, cata de baya y días estimados hasta vendimia), del más reciente al más antiguo; con parcel_code, solo los de esa parcela.",
    input: z.object({ parcel_code: parcelCode.optional() }).strict(),
    route: "GET /v1/maturity-checks",
    web: section("maduracion"),
  }),
  defineRestWrite({
    name: "vineyard_maturity_check_create",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Anotar control de maduración",
    description: "Anota un control de maduración en una parcela activa: azúcar, grado probable, acidez total y pH, y si se quiere sanidad, días estimados hasta vendimia, notas y la cata de baya (pepita, hollejo, pulpa). Los días estimados alimentan el planificador de vendimia.",
    input: z.object({
      parcel_code: parcelCode,
      checked_at: instant.describe("Momento del muestreo, ISO-8601 con zona; no puede ser futuro"),
      sugar_gl: measure.describe("Azúcar en g/L, de 0 a 400"),
      probable_abv: measure.describe("Grado probable en % vol, de 0 a 25"),
      total_acidity: measure.describe("Acidez total en g/L, de 0 a 30"),
      ph: measure.describe("pH, de 0 a 14"),
      sanitary_status: z.enum(["good", "fair", "poor"]).nullable().optional().describe("good buena, fair regular, poor mala"),
      estimated_days_to_harvest: z.number().int().min(0).max(90).nullable().optional().describe("Días estimados hasta vendimiar"),
      author: z.string().max(120).optional().describe("Quién muestreó; por defecto, la persona"),
      source: sources,
      sensory_notes: z.string().max(2000).optional().describe("Notas de cata"),
      weather_snapshot: z.record(z.string(), z.unknown()).nullable().optional().describe("Datos del tiempo en el momento del control"),
      seed_color: z.enum(["green", "mixed", "brown"]).nullable().optional().describe("Color de la pepita: green verde, mixed mezcla, brown marrón"),
      seed_crunch: z.boolean().nullable().optional().describe("La pepita cruje"),
      skin_astringency: z.number().int().min(1).max(5).nullable().optional().describe("Astringencia del hollejo, de 1 a 5"),
      skin_color_release: z.number().int().min(1).max(5).nullable().optional().describe("Cesión de color del hollejo, de 1 a 5"),
      pulp_sweetness: z.number().int().min(1).max(5).nullable().optional().describe("Dulzor de la pulpa, de 1 a 5"),
      pulp_acidity: z.number().int().min(1).max(5).nullable().optional().describe("Acidez de la pulpa, de 1 a 5"),
      phenolic_maturity: z.number().int().min(1).max(5).nullable().optional().describe("Madurez fenólica, de 1 a 5"),
      photo_attachment_id: id.nullable().optional().describe("Foto ya subida como adjunto de imagen"),
    }).strict(),
    route: "POST /v1/maturity-checks",
    summary: (input) => `Se anota un control de maduración en ${input.parcel_code}: ${input.sugar_gl} g/L de azúcar, ${input.probable_abv} % vol probable, acidez ${input.total_acidity} g/L, pH ${input.ph}. ¿Confirmas?`,
    web: section("maduracion"),
  }),
  defineRestRead({
    name: "vineyard_harvests_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Vendimias",
    description: "Las vendimias por parcela y variedad (fecha, kilos previstos, cuadrilla) y si ya están cerradas con su entrada de uva; con campaign, solo las de esa añada.",
    input: z.object({ campaign: campaignYear.optional() }).strict(),
    route: "GET /v1/harvests",
    web: section("vendimias"),
  }),
  defineRestRead({
    name: "vineyard_harvests_summary_get",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Kilos vendimiados de la campaña",
    description: "Kilos netos entrados por parcela (o viticultor) y variedad en una campaña, con rendimiento en kg/ha y el reparto ecológico/convencional, a partir de las entradas de uva confirmadas.",
    input: z.object({ campaign: campaignYear }).strict(),
    route: "GET /v1/harvests/summary",
    web: section("vendimias"),
  }),
  defineRestWrite({
    name: "vineyard_harvest_create",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Anotar vendimia de una parcela",
    description: "Anota la vendimia de una variedad en una parcela activa: añada, día de corte, kilos previstos y tamaño de la cuadrilla. Luego se cierra enlazándola con su entrada de uva.",
    input: z.object({
      parcel_code: parcelCode,
      vintage: year.describe("Añada"),
      harvested_on: day.describe("Día de vendimia AAAA-MM-DD"),
      variety: varietyCode.describe("Código de la variedad, plantada en esa parcela"),
      estimated_kg: z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d)?$/).optional().describe("Kilos previstos, un decimal como máximo"),
      crew_size: z.number().int().min(1).max(500).optional().describe("Personas de la cuadrilla"),
      notes: z.string().max(2000).optional(),
    }).strict(),
    route: "POST /v1/harvests",
    summary: (input) => `Se anota la vendimia de ${input.variety} en ${input.parcel_code} el ${input.harvested_on} (añada ${input.vintage}). ¿Confirmas?`,
    web: section("vendimias"),
  }),
  defineRestWrite({
    name: "vineyard_harvest_close",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Cerrar vendimia",
    description: "Cierra una vendimia enlazándola con la entrada de uva confirmada que trae esa parcela, añada y variedad. Una vendimia cerrada no se vuelve a abrir.",
    input: z.object({
      id: id.describe("Vendimia (sale en vineyard_harvests_list)"),
      reception_operation_id: id.describe("Entrada de uva confirmada (sale en vineyard_grape_receptions_list)"),
    }).strict(),
    route: "POST /v1/harvests/:id/close",
    summary: (input) => `Se cierra la vendimia y queda enlazada con la entrada de uva ${input.reception_operation_id}. No se puede deshacer. ¿Confirmas?`,
    web: section("vendimias"),
  }),
  defineRestRead({
    name: "vineyard_crew_availability_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Disponibilidad de cuadrillas",
    description: "Personas disponibles para vendimiar cada día, entre dos fechas si se indican. El planificador busca el primer día con gente suficiente.",
    input: z.object({
      from: day.optional().describe("Desde, AAAA-MM-DD"),
      to: day.optional().describe("Hasta, AAAA-MM-DD"),
    }).strict(),
    route: "GET /v1/crew-availability",
    web: section("planificador"),
  }),
  defineRestWrite({
    name: "vineyard_crew_availability_set",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Fijar cuadrilla de un día",
    description: "Fija cuántas personas hay disponibles para vendimiar un día, con una nota. Si el día ya tenía datos, solo hace falta mandar lo que cambia; si es nuevo, people es obligatorio.",
    input: z.object({
      day: day.describe("Día AAAA-MM-DD"),
      changes: z.object({
        people: z.number().int().min(0).max(500).optional().describe("Personas disponibles"),
        notes: z.string().max(500).nullable().optional(),
      }).strict(),
    }).strict(),
    route: "PUT /v1/crew-availability/:day",
    current: { route: "GET /v1/crew-availability" },
    send: (input, current) => patchOnto(crewDay(current, input.day), CREW_KEYS, input.changes),
    summary: (input, current) => {
      const people = input.changes.people ?? field(crewDay(current, input.day), "people");
      return `El ${input.day} quedan ${people === "" ? "sin indicar las" : people} personas disponibles para vendimiar. ¿Confirmas?`;
    },
    web: section("planificador"),
  }),
  defineRestWrite({
    name: "vineyard_crew_availability_delete",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Quitar cuadrilla de un día",
    description: "Borra la disponibilidad de cuadrilla de un día.",
    input: z.object({ day: day.describe("Día AAAA-MM-DD") }).strict(),
    route: "DELETE /v1/crew-availability/:day",
    summary: (input) => `Se borra la disponibilidad de cuadrilla del ${input.day}. ¿Confirmas?`,
    web: section("planificador"),
  }),
  defineRestRead({
    name: "vineyard_harvest_plans_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Planes de vendimia",
    description: "Los planes de vendimia por parcela (madurez prevista, riesgo meteorológico, personal necesario, ventana y fecha sugerida, estado); con campaign, solo los de esa añada.",
    input: z.object({ campaign: campaignYear.optional() }).strict(),
    route: "GET /v1/harvest-plans",
    web: section("planificador"),
  }),
  defineRestRead({
    name: "vineyard_harvest_plan_get",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Plan de vendimia",
    description: "Un plan de vendimia con su ventana, fecha sugerida y la explicación de por qué.",
    input: z.object({ id }).strict(),
    route: "GET /v1/harvest-plans/:id",
    web: section("planificador"),
  }),
  defineRestWrite({
    name: "vineyard_harvest_plan_create",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Nuevo plan de vendimia",
    description: "Crea el borrador del plan de vendimia de una parcela y añada: personal necesario, riesgo meteorológico y fecha de madurez (si no se indica, sale del último control de maduración con días estimados). Uno por parcela y añada.",
    input: z.object({
      parcel_code: parcelCode,
      vintage: year.describe("Añada"),
      crew_needed: z.number().int().min(1).max(500).describe("Personas necesarias para vendimiarla"),
      ripeness_ready_on: day.optional().describe("Fecha AAAA-MM-DD en que la uva estará madura"),
      weather_risk: z.enum(["none", "heat_wave", "rain", "storm", "hail"]).optional()
        .describe("Riesgo que adelanta la vendimia: none ninguno, heat_wave ola de calor, rain lluvia, storm tormenta, hail granizo"),
      weather_note: z.string().max(500).optional(),
    }).strict(),
    route: "POST /v1/harvest-plans",
    summary: (input) => `Se crea el plan de vendimia de ${input.parcel_code} para la añada ${input.vintage} con ${input.crew_needed} personas. ¿Confirmas?`,
    web: section("planificador"),
  }),
  defineRestWrite({
    name: "vineyard_harvest_plan_update",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Editar plan de vendimia",
    description: "Cambia un plan en borrador (madurez, riesgo meteorológico, personal necesario) o lo anula con status cancelled. Borra la fecha sugerida: hay que volver a calcularla. Un plan confirmado no se edita.",
    input: z.object({
      id,
      changes: z.object({
        ripeness_ready_on: day.optional().describe("Fecha AAAA-MM-DD de madurez"),
        weather_risk: z.enum(["none", "heat_wave", "rain", "storm", "hail"]).optional(),
        weather_note: z.string().max(500).nullable().optional(),
        crew_needed: z.number().int().min(1).max(500).optional(),
        status: z.enum(["draft", "cancelled"]).optional().describe("cancelled anula el plan; draft lo recupera"),
      }).strict(),
    }).strict(),
    route: "PATCH /v1/harvest-plans/:id",
    current: { route: "GET /v1/harvest-plans/:id" },
    send: (input) => input.changes,
    summary: (input, current) => {
      const plan = `el plan de vendimia de ${field(current, "parcel_code")} (${field(current, "vintage")})`;
      if (input.changes.status === "cancelled") return `Se anula ${plan}. ¿Confirmas?`;
      return `Se cambia ${plan}; la fecha sugerida se borra y hay que volver a calcularla. ¿Confirmas?`;
    },
    web: section("planificador"),
  }),
  defineRestWrite({
    name: "vineyard_harvest_plan_suggest",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Calcular fecha de vendimia",
    description: "Calcula y guarda en el plan en borrador la ventana de vendimia y el primer día con cuadrilla suficiente, adelantándolo si hay riesgo meteorológico, con la explicación.",
    input: z.object({ id }).strict(),
    route: "POST /v1/harvest-plans/:id/suggest",
    current: { route: "GET /v1/harvest-plans/:id" },
    summary: (_input, current) => `Se calcula y se guarda la fecha sugerida del plan de vendimia de ${field(current, "parcel_code")} (${field(current, "vintage")}). ¿Confirmas?`,
    web: section("planificador"),
  }),
  defineRestWrite({
    name: "vineyard_harvest_plan_confirm",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Confirmar fecha de vendimia",
    description: "Confirma la fecha sugerida de un plan en borrador. Un plan confirmado ya no se edita.",
    input: z.object({ id }).strict(),
    route: "POST /v1/harvest-plans/:id/confirm",
    current: { route: "GET /v1/harvest-plans/:id" },
    summary: (_input, current) => `Se confirma la vendimia de ${field(current, "parcel_code")} el ${field(current, "suggested_on") || "día sugerido"}. Después el plan ya no se edita. ¿Confirmas?`,
    web: section("planificador"),
  }),
  defineRestRead({
    name: "vineyard_grape_receptions_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Entradas de uva",
    description: "Las últimas 200 entradas de uva (tickets de báscula) con su estado (borrador, confirmada, rectificada), pesada, variedad, origen, lote y asiento SILICIE.",
    input: z.object({}).strict(),
    route: "GET /v1/grape-receptions",
    web: () => receptionLink(""),
  }),
  defineRestRead({
    name: "vineyard_grape_reception_get",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Entrada de uva",
    description: "Un ticket de báscula completo: pesada, sanidad, parcelas o viticultor, depósito, lote y asiento SILICIE.",
    input: z.object({ id }).strict(),
    route: "GET /v1/grape-receptions/:id",
    web: (input) => receptionLink(input.id),
  }),
  defineRestWrite({
    name: "vineyard_grape_reception_create",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Nueva entrada de uva (borrador)",
    description: "Anota el ticket de báscula de una entrada de uva como borrador: pesada (bruto, tara y neto en kg), variedad, grado probable, sanidad, parcelas con sus kilos o viticultor externo, depósito de destino y lote. No mueve stock ni SILICIE hasta confirmarla con vineyard_grape_reception_confirm.",
    input: z.object(receptionFields).strict(),
    route: "POST /v1/grape-receptions",
    summary: (input) => `Se anota en borrador la entrada de ${input.net_kg} kg netos de ${input.variety_code} (lote ${input.lot_code}). Aún no mueve stock. ¿Confirmas?`,
    web: (_input, body) => receptionLink(bodyId(body)),
  }),
  defineRestWrite({
    name: "vineyard_grape_reception_update",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Corregir entrada de uva en borrador",
    description: "Corrige un ticket de báscula que sigue en borrador. Solo hace falta mandar lo que cambia; en intake, solo los campos que cambian. Mandar parcels quita el viticultor externo y al revés. Una entrada confirmada no se modifica: se rectifica.",
    input: z.object({
      id,
      changes: z.object({ ...receptionFields, intake: intakeFields.partial().strict() }).partial().strict(),
    }).strict(),
    route: "PATCH /v1/grape-receptions/:id",
    current: { route: "GET /v1/grape-receptions/:id" },
    send: (input, current) => {
      const { intake, ...changes } = input.changes;
      const body = patchOnto(receptionRecord(current), RECEPTION_KEYS, changes);
      if (changes.parcels !== undefined) delete body.grower_contact_id;
      if (changes.grower_contact_id !== undefined) delete body.parcels;
      if (intake) body.intake = { ...(isRecord(body.intake) ? body.intake : {}), ...intake };
      return body;
    },
    summary: (_input, current) => `Se corrige el borrador de la entrada de uva ${receptionLabel(current)}. ¿Confirmas?`,
    web: (input) => receptionLink(input.id),
  }),
  defineRestRead({
    name: "vineyard_grape_reception_preview",
    module: "vineyard",
    scope: "vineyard.write",
    computeOnly: "Simula la confirmación de un borrador (movimiento de uva, lote nuevo y asiento SILICIE) sin numerar ni guardar nada.",
    title: "Vista previa de la entrada de uva",
    description: "Enseña lo que haría confirmar un borrador de entrada de uva: el movimiento de uva al depósito, el lote que se crearía y el asiento A02 de SILICIE, y avisa si algo lo impide (depósito ocupado, periodo cerrado…). No guarda nada.",
    input: z.object({ id }).strict(),
    route: "POST /v1/grape-receptions/:id/preview",
    web: (input) => receptionLink(input.id),
  }),
  defineRestWrite({
    name: "vineyard_grape_reception_confirm",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Confirmar entrada de uva",
    description: "Confirma un borrador de entrada de uva: le da número, mete la uva en el depósito, crea el lote y deja pendiente el asiento A02 de SILICIE (si se rechaza la uva, solo queda registrada). Después solo se corrige rectificándola.",
    input: z.object({ id }).strict(),
    route: "POST /v1/grape-receptions/:id/confirm",
    current: { route: "GET /v1/grape-receptions/:id" },
    summary: (_input, current) => `Se confirma la entrada de uva ${receptionLabel(current)}: entra la uva en el depósito, se crea el lote y queda el asiento SILICIE pendiente. Después solo se puede rectificar. ¿Confirmas?`,
    web: (input) => receptionLink(input.id),
  }),
  defineRestWrite({
    name: "vineyard_grape_reception_rectify",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Rectificar entrada de uva",
    description: "Rectifica una entrada de uva confirmada: crea una operación que revierte su movimiento de uva y anula su asiento SILICIE pendiente, con el motivo. Falla si la uva ya se ha usado.",
    input: z.object({ id, reason: z.string().min(1).max(500).describe("Motivo de la rectificación") }).strict(),
    route: "POST /v1/grape-receptions/:id/rectify",
    current: { route: "GET /v1/grape-receptions/:id" },
    summary: (input, current) => `Se rectifica la entrada de uva ${receptionLabel(current)}: se revierte su uva y se anula su asiento SILICIE pendiente. Motivo: ${input.reason}. ¿Confirmas?`,
    web: (_input, body) => receptionLink(bodyId(body)),
  }),
  defineRestRead({
    name: "vineyard_treatments_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Tratamientos del cuaderno de campo",
    description: "Los tratamientos fitosanitarios y abonados anotados (hasta 500), con producto, dosis, superficie, plazo de seguridad, avisos de vendimia dentro del plazo y estado de anotación en el CUE. Filtra por campaña, parcela o tipo.",
    input: z.object({
      campaign: notebookCampaign.optional(),
      parcel_id: id.optional().describe("Id de la parcela (sale en vineyard_parcels_list)"),
      kind: z.enum(PARCEL_KINDS).optional().describe("phytosanitary fitosanitario, fertiliser abonado, other otro"),
      as_of: asOf,
    }).strict(),
    route: "GET /v1/treatments",
    web: section("cuaderno"),
  }),
  defineRestRead({
    name: "vineyard_notebook_export_csv",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Exportar cuaderno de campo (CSV)",
    description: "El cuaderno de campo de una campaña en CSV, el que descarga la app para el agricultor: parcelas, tratamientos, labores, vendimias y avisos. Devuelve el texto del fichero.",
    input: z.object({ campaign: notebookCampaign, as_of: asOf }).strict(),
    route: "GET /v1/treatments/export",
    web: section("cuaderno"),
  }),
  defineRestRead({
    name: "vineyard_treatment_get",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Tratamiento",
    description: "Un tratamiento del cuaderno con su producto, dosis, plazo de seguridad, avisos y estado en el CUE.",
    input: z.object({ id, as_of: asOf }).strict(),
    route: "GET /v1/treatments/:id",
    web: section("cuaderno"),
  }),
  defineRestWrite({
    name: "vineyard_treatment_create",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Anotar tratamiento",
    description: "Anota en el cuaderno de campo un tratamiento fitosanitario o un abonado en una o varias parcelas: fecha, producto del cuaderno, dosis, plaga o motivo, aplicador con su ROPO, equipo ROMA y método. Comprueba dosis máxima, superficie y producto ecológico, y avisa si hay vendimia dentro del plazo de seguridad.",
    input: z.object({
      kind: z.enum(PARCEL_KINDS).optional().describe("phytosanitary fitosanitario (por defecto), fertiliser abonado, other otro; tiene que ser el del producto"),
      parcel_ids: z.array(id).min(1).max(50).optional().describe("Parcelas tratadas enteras o con la misma superficie; o esto o parcels"),
      treated_area_ha: z.string().regex(/^\d{1,4}(\.\d{1,4})?$/).optional().describe("Hectáreas tratadas en cada parcela de parcel_ids; por defecto, toda la parcela"),
      parcels: z.array(treatmentParcel).min(1).max(50).optional().describe("Parcelas con su superficie tratada; o esto o parcel_ids"),
      applied_on: day.describe("Fecha de aplicación AAAA-MM-DD"),
      product_id: id.describe("Producto del cuaderno (sale en vineyard_notebook_products_list)"),
      dose: z.string().regex(/^\d{1,7}(\.\d{1,3})?$/).describe("Dosis aplicada, hasta 3 decimales; no puede superar la máxima del producto"),
      dose_unit: z.enum(DOSE_UNITS).describe("Unidad de la dosis, la misma que la dosis máxima del producto"),
      total_quantity: z.string().regex(/^\d{1,10}(\.\d{1,4})?$/).optional().describe("Cantidad total gastada; obligatoria si la dosis no es por hectárea"),
      quantity_unit: z.string().min(1).max(16).optional().describe("Unidad de la cantidad total (kg, l, g o ml según la dosis); va junto a total_quantity"),
      target: z.string().max(200).optional().describe("Plaga, enfermedad o motivo; obligatorio en fitosanitarios"),
      operator_name: z.string().min(1).max(120).describe("Quién aplicó"),
      applicator_ropo: z.string().min(4).max(40).optional().describe("Carné ROPO del aplicador; obligatorio en fitosanitarios"),
      advisor_name: z.string().max(120).optional().describe("Asesor que lo recomendó"),
      equipment_roma: z.string().max(80).optional().describe("Equipo de aplicación inscrito en el ROMA; obligatorio en fitosanitarios desde 2027"),
      method: z.string().min(1).max(120).describe("Método de aplicación (p. ej. pulverización)"),
      weather_notes: z.string().max(500).optional().describe("Condiciones del tiempo"),
      crop: z.string().max(80).optional().describe("Cultivo; por defecto Vid"),
      variety: z.string().max(80).optional().describe("Código de la variedad tratada; obligatorio si la parcela tiene varias"),
      efficacy: z.string().max(500).optional().describe("Eficacia observada"),
      supplier_invoice_id: id.optional().describe("Factura de compra del producto"),
      notes: z.string().max(1000).optional(),
      nutrient_npk: z.string().max(40).optional().describe("Riqueza N-P-K; solo en abonados"),
      application_timing: z.enum(["fondo", "cobertera", "foliar", "fertirrigacion", "otro"]).optional().describe("Momento del abonado; solo en abonados"),
    }).strict(),
    route: "POST /v1/treatments",
    summary: (input) => {
      const count = input.parcel_ids?.length ?? input.parcels?.length ?? 0;
      const what = input.kind === "fertiliser" ? "un abonado" : input.kind === "other" ? "una aplicación" : "un tratamiento fitosanitario";
      return `Se anota en el cuaderno de campo ${what} del ${input.applied_on} en ${count} parcela(s), dosis ${input.dose} ${input.dose_unit}. El plazo de seguridad sale del producto. ¿Confirmas?`;
    },
    web: section("cuaderno"),
  }),
  defineRestWrite({
    name: "vineyard_treatment_update",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Completar tratamiento",
    description: "Completa un tratamiento ya anotado: eficacia, notas, tiempo, asesor o la fecha en que el agricultor lo anotó en el CUE. El resto del tratamiento no se cambia. null borra un texto.",
    input: z.object({
      id,
      changes: z.object({
        efficacy: z.string().max(500).nullable().optional().describe("Eficacia observada"),
        notes: z.string().max(1000).nullable().optional(),
        weather_notes: z.string().max(500).nullable().optional().describe("Condiciones del tiempo"),
        advisor_name: z.string().max(120).nullable().optional(),
        cue_recorded_at: z.string().min(1).max(40).optional().describe("Fecha AAAA-MM-DD (o instante ISO-8601) en que se anotó en el CUE; no anterior al tratamiento"),
      }).strict(),
    }).strict(),
    route: "PATCH /v1/treatments/:id",
    current: { route: "GET /v1/treatments/:id" },
    send: (input) => input.changes,
    summary: (input, current) => {
      const treatment = `el tratamiento del ${field(current, "applied_on")} en ${field(current, "parcel_code")}`;
      if (input.changes.cue_recorded_at) return `Se marca ${treatment} como anotado en el CUE el ${input.changes.cue_recorded_at}. ¿Confirmas?`;
      return `Se completa ${treatment}. ¿Confirmas?`;
    },
    web: section("cuaderno"),
  }),
  defineRestRead({
    name: "vineyard_notebook_products_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Productos del cuaderno de campo",
    description: "Los fitosanitarios y abonos del cuaderno con registro, materias activas, dosis máxima, plazo de seguridad y si están autorizados en ecológico. Por defecto solo los activos.",
    input: z.object({
      product_kind: z.enum(PARCEL_KINDS).optional().describe("phytosanitary fitosanitario, fertiliser abono, other otro"),
      include_inactive: z.boolean().optional().describe("true para ver también los dados de baja"),
    }).strict(),
    route: "GET /v1/vineyard-notebook/products",
    web: section("cuaderno"),
  }),
  defineRestRead({
    name: "vineyard_notebook_product_get",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Producto del cuaderno de campo",
    description: "Un fitosanitario o abono del cuaderno con su dosis máxima y plazo de seguridad.",
    input: z.object({ id }).strict(),
    route: "GET /v1/vineyard-notebook/products/:id",
    web: section("cuaderno"),
  }),
  defineRestWrite({
    name: "vineyard_notebook_product_create",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Alta de producto del cuaderno",
    description: "Da de alta un fitosanitario o abono para el cuaderno de campo: nombre comercial, registro, materias activas, dosis máxima con su unidad, plazo de seguridad en días y si está autorizado en ecológico.",
    input: z.object({
      ...productFields,
      product_kind: z.enum(PARCEL_KINDS).describe("phytosanitary fitosanitario, fertiliser abono, other otro"),
    }).strict(),
    route: "POST /v1/vineyard-notebook/products",
    summary: (input) => `Se da de alta «${input.commercial_name}» en el cuaderno: dosis máxima ${input.max_dose} ${input.max_dose_unit}, plazo de seguridad ${input.safety_interval_days} días, ${input.is_organic_approved ? "autorizado" : "no autorizado"} en ecológico. ¿Confirmas?`,
    web: section("cuaderno"),
  }),
  defineRestWrite({
    name: "vineyard_notebook_product_update",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Editar producto del cuaderno",
    description: "Cambia un producto del cuaderno (nombre, registro, materias activas, dosis máxima, plazo de seguridad, ecológico, notas) o lo da de baja con is_active false. El tipo no cambia. Solo hace falta mandar lo que cambia; los tratamientos ya anotados conservan sus datos.",
    input: z.object({
      id,
      changes: z.object({ ...productFields, is_active: z.boolean() }).partial().strict(),
    }).strict(),
    route: "PATCH /v1/vineyard-notebook/products/:id",
    current: { route: "GET /v1/vineyard-notebook/products/:id" },
    send: (input) => input.changes,
    summary: (input, current) => `${input.changes.is_active === false ? "Se da de baja" : "Se cambia"} el producto «${field(current, "commercial_name")}» del cuaderno. ¿Confirmas?`,
    web: section("cuaderno"),
  }),
  defineRestRead({
    name: "vineyard_notebook_operations_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Otras labores del cuaderno",
    description: "Las otras anotaciones del cuaderno de campo (limpieza de equipos, análisis de residuos, riego, cubierta vegetal…), hasta 500, por campaña o parcela.",
    input: z.object({
      campaign: notebookCampaign.optional(),
      parcel_id: id.optional().describe("Id de la parcela (sale en vineyard_parcels_list)"),
    }).strict(),
    route: "GET /v1/vineyard-notebook/operations",
    web: section("cuaderno"),
  }),
  defineRestWrite({
    name: "vineyard_notebook_operation_add",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Anotar labor en el cuaderno",
    description: "Anota en el cuaderno de campo una labor que no es un tratamiento: limpieza de equipos, análisis de residuos, riego, cubierta vegetal u otra, con producto y cantidad si los hubo.",
    input: z.object({
      parcel_id: id.describe("Id de la parcela activa (sale en vineyard_parcels_list)"),
      done_on: day.describe("Fecha AAAA-MM-DD"),
      kind: z.enum(["cleaning", "residue_analysis", "irrigation", "cover_crop", "other"])
        .describe("cleaning limpieza de equipos, residue_analysis análisis de residuos, irrigation riego, cover_crop cubierta vegetal, other otra"),
      operator_name: z.string().max(120).optional(),
      product_name: z.string().max(160).optional(),
      active_substance: z.string().max(200).optional(),
      quantity: z.string().regex(/^\d{1,10}(\.\d{1,4})?$/).optional().describe("Cantidad, hasta 4 decimales; va junto a quantity_unit"),
      quantity_unit: z.string().min(1).max(16).optional().describe("Unidad de la cantidad; va junto a quantity"),
      notes: z.string().max(1000).optional(),
    }).strict(),
    route: "POST /v1/vineyard-notebook/operations",
    summary: (input) => `Se anota en el cuaderno de campo la labor ${input.kind} del ${input.done_on}. ¿Confirmas?`,
    web: section("cuaderno"),
  }),
  defineRestRead({
    name: "vineyard_notebook_cue_pending_list",
    module: "vineyard",
    scope: "vineyard.read",
    title: "Tratamientos sin anotar en el CUE",
    description: "Los tratamientos fitosanitarios desde 2027 que aún no constan anotados en el CUE, con la fecha de aviso (20 días) y la fecha límite (un mes). WineCore no los envía: los anota el agricultor.",
    input: z.object({ as_of: asOf }).strict(),
    route: "GET /v1/vineyard-notebook/cue-pending",
    web: section("cuaderno"),
  }),
  defineRestWrite({
    name: "vineyard_notebook_cue_reminders_notify",
    module: "vineyard",
    scope: "vineyard.write",
    title: "Avisar de tratamientos sin anotar en el CUE",
    description: "Deja una notificación en la app a propietario, asesor, bodega y campo por cada tratamiento que lleva 20 días o más sin anotar en el CUE. No envía nada al CUE ni repite avisos ya dados.",
    input: z.object({}).strict(),
    route: "POST /v1/vineyard-notebook/cue-reminders",
    summary: () => "Se avisa en la app a propietario, asesor, bodega y campo de los tratamientos que llevan 20 días o más sin anotar en el CUE. ¿Confirmas?",
    web: section("cuaderno"),
  }),
];
