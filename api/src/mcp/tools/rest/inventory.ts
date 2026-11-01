import { z } from "zod";

import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite } from "../../rest";

const id = z.guid();
const code = z.string().regex(/^[A-Z0-9-]{2,20}$/);
const instant = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/)
  .describe("Instante con zona horaria, p. ej. 2026-10-31T18:00:00+01:00");
const dayOrInstant = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?$/)
  .describe("Día (AAAA-MM-DD) o instante con zona horaria");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("AAAA-MM-DD");
const entity = z.string().min(1).max(40).describe("Sociedad: PO, CVPO o su id");
const cursor = z.string().max(500).optional();

const STATES = ["grape", "must", "wine", "packaged_unlabeled", "packaged_labeled", "goods"] as const;
const COUNT_STATES = ["must", "wine", "packaged_unlabeled", "packaged_labeled", "goods"] as const;
const PACKAGED_STATES = ["packaged_unlabeled", "packaged_labeled"] as const;
const COUNT_METHODS = ["dipstick", "flowmeter", "level_gauge", "unit_count", "weight", "estimate"] as const;
const COUNT_KINDS = ["opening", "periodic", "inspection", "spot"] as const;
const LOCATION_KINDS = [
  "cellar", "cellar_shop", "own_warehouse", "third_party_warehouse", "forwarder", "in_transit", "customer_virtual",
] as const;
const MOVE_TYPES = [
  "opening", "cellar_in", "cellar_out", "loss", "delivery_out", "transfer_in", "return_in", "ownership_out",
  "ownership_in", "purchase_in", "count_adjust_in", "count_adjust_out", "reversal", "production", "bulk_receipt",
  "packaging_out_bulk", "packaging_in_packaged", "destruction", "exit_domestic", "exit_export", "exit_intra_eu",
  "exit_canary", "ledger_change_out", "ledger_change_in", "regularization_in", "regularization_out",
] as const;

const stateDescription = "grape uva, must mosto, wine vino a granel, packaged_unlabeled embotellado sin etiquetar, packaged_labeled embotellado y etiquetado, goods mercancía y materiales";

const countLine = z.object({
  id: id.optional().describe("Id de una línea ya guardada (sale en inventory_count_get)"),
  location_id: id,
  vessel_id: id.nullable().optional().describe("Depósito, si el granel está en uno"),
  owner_entity_id: entity,
  lot_id: id.nullable().optional(),
  product_id: id.nullable().optional(),
  product_state: z.enum(COUNT_STATES).describe(stateDescription),
  counted_qty_units: z.number().int().min(0).nullable().optional().describe("Unidades contadas; 0 en granel"),
  counted_volume_ml: z.number().int().min(0).nullable().optional().describe("Volumen contado en mililitros"),
  method: z.enum(COUNT_METHODS).nullable().optional().describe("Obligatorio si hay recuento: varilla, caudalímetro, nivel, conteo, peso o estimación"),
  difference_reason: z.string().max(500).nullable().optional().describe("Motivo si lo contado no coincide con el libro"),
  photo_attachment_id: id.nullable().optional(),
}).strict();

const locationSchema = {
  name: z.string().min(1).max(120),
  kind: z.enum(LOCATION_KINDS).describe("third_party_warehouse y forwarder exigen el contacto del operador; in_transit y customer_virtual son virtuales"),
  tax_warehouse_id: id.describe("Depósito fiscal (inventory_tax_warehouses_list)"),
  operator_contact_id: id.describe("Contacto del operador logístico"),
  controlling_entity_id: id.describe("Sociedad que controla la ubicación"),
  address: z.record(z.string(), z.unknown()).describe("Dirección: line1, postal_code, city, province, country_code…"),
  is_virtual: z.boolean(),
};

const countLink = (input: { id: string }) => `/stock/aforos/${input.id}`;

function countLabel(current: unknown): string {
  if (typeof current !== "object" || current === null) return "";
  const number = (current as { number?: unknown }).number;
  return typeof number === "string" && number !== "" ? ` ${number}` : "";
}

export const inventoryRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "inventory_stock_balances_list",
    module: "inventory",
    scope: "inventory.read",
    title: "Existencias físicas",
    description: "Saldos del libro físico a una fecha por ubicación, depósito, propietario, lote, producto y estado, como la pantalla de Stock. Paginada con next_cursor.",
    input: z.object({
      at: dayOrInstant.optional().describe("Día o instante; por defecto, ahora"),
      location_id: id.optional(),
      vessel_id: id.optional(),
      owner: entity.optional(),
      product_id: id.optional(),
      lot_id: id.optional(),
      state: z.enum(STATES).optional().describe(stateDescription),
      limit: z.number().int().min(1).max(1000).optional(),
      cursor,
    }).strict(),
    route: "GET /v1/stock/balances",
    web: () => "/stock",
  }),
  defineRestRead({
    name: "inventory_fiscal_balances_list",
    module: "inventory",
    scope: "inventory.read",
    title: "Existencias fiscales",
    description: "Saldos del libro fiscal (SILICIE) a una fecha por depósito fiscal, clase de producto y clave. Paginada con next_cursor.",
    input: z.object({
      at: dayOrInstant.optional().describe("Día o instante; por defecto, ahora"),
      tax_warehouse_id: id.optional(),
      product_id: id.optional(),
      lot_id: id.optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      cursor,
    }).strict(),
    route: "GET /v1/stock/fiscal-balances",
    web: () => "/stock",
  }),
  defineRestRead({
    name: "inventory_inspection_report_get",
    module: "inventory",
    scope: "inventory.read",
    title: "Informe de existencias para inspección",
    description: "El informe de existencias a una fecha que se enseña a un inspector, con totales de granel, embotellado y mercancía y su huella. En JSON, o el CSV o la página imprimible como texto.",
    input: z.object({
      at: dayOrInstant.optional().describe("Día o instante; por defecto, ahora"),
      location_id: id.optional(),
      owner: entity.optional(),
      product_id: id.optional(),
      lot_id: id.optional(),
      state: z.enum(STATES).optional().describe(stateDescription),
      format: z.enum(["json", "csv", "html"]).optional(),
    }).strict(),
    route: "GET /v1/stock/inspection-report",
    web: () => "/stock/informe",
  }),
  defineRestRead({
    name: "inventory_stock_moves_list",
    module: "inventory",
    scope: "inventory.read",
    title: "Movimientos de stock",
    description: "Los movimientos del libro físico o del fiscal con los filtros de la pantalla Movimientos; format csv devuelve el fichero (acota el periodo). Ubicación, depósito y propietario solo filtran el físico.",
    input: z.object({
      book: z.enum(["physical", "fiscal"]),
      from: day.optional(),
      to: day.optional(),
      move_type: z.enum(MOVE_TYPES).optional().describe("Cada libro admite sus propios tipos"),
      lot_id: id.optional(),
      product_id: id.optional(),
      location_id: id.optional(),
      vessel_id: id.optional(),
      owner: entity.optional(),
      source: z.string().max(80).optional().describe("Id del documento de origen o su tabla, p. ej. sales.delivery_note"),
      silicie_entry_id: id.optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor,
      format: z.enum(["json", "csv"]).optional(),
    }).strict(),
    route: "GET /v1/stock/moves",
    web: (input) => (input.book === "fiscal" ? "/stock/movimientos?book=fiscal" : "/stock/movimientos"),
  }),
  defineRestRead({
    name: "inventory_counts_list",
    module: "inventory",
    scope: "inventory.read",
    title: "Aforos",
    description: "Los aforos (recuentos de existencias), del más reciente al más antiguo, con su estado y cuántas líneas tienen diferencias.",
    input: z.object({
      legal_entity_id: id.optional().describe("Solo los de esa sociedad"),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: id.optional().describe("next_cursor de la página anterior"),
    }).strict(),
    route: "GET /v1/inventory-counts",
    web: () => "/stock/aforos",
  }),
  defineRestRead({
    name: "inventory_count_get",
    module: "inventory",
    scope: "inventory.read",
    title: "Ficha del aforo",
    description: "El aforo con todas sus líneas: lo que dice el libro, lo contado, el método y el motivo de cada diferencia, con el id de cada línea.",
    input: z.object({ id }).strict(),
    route: "GET /v1/inventory-counts/:id",
    web: countLink,
  }),
  defineRestWrite({
    name: "inventory_count_create",
    module: "inventory",
    scope: "inventory.count",
    title: "Abrir aforo",
    description: "Abre un aforo en las ubicaciones indicadas: crea una línea por cada existencia que dice el libro a esa fecha, para ir anotando lo contado.",
    input: z.object({
      legal_entity_id: entity,
      counted_at: instant.describe("Momento del recuento, con zona horaria"),
      kind: z.enum(COUNT_KINDS).describe("opening apertura, periodic periódico, inspection inspección, spot puntual"),
      location_ids: z.array(id).min(1).describe("Ubicaciones que se cuentan (inventory_locations_list)"),
      notes: z.string().max(2000).nullable().optional(),
    }).strict(),
    route: "POST /v1/inventory-counts",
    summary: (input) => `Abrir un aforo (${input.kind}) a ${input.counted_at} en ${input.location_ids.length} ubicación(es). ¿Confirmas?`,
    web: (_input, body) => {
      const created = typeof body === "object" && body !== null ? (body as { id?: unknown }).id : null;
      return typeof created === "string" ? `/stock/aforos/${created}` : "/stock/aforos";
    },
  }),
  defineRestWrite({
    name: "inventory_count_lines_save",
    module: "inventory",
    scope: "inventory.count",
    title: "Anotar lo contado en el aforo",
    description: "Guarda lo contado en líneas del aforo (cada una se reconoce por su id o por ubicación, depósito, propietario, lote, producto y estado; si no existe se añade). Las líneas que no mandes se quedan como están.",
    input: z.object({ id, lines: z.array(countLine).min(1).max(500) }).strict(),
    route: "PUT /v1/inventory-counts/:id/lines",
    current: { route: "GET /v1/inventory-counts/:id" },
    summary: (input, current) => `Guardar ${input.lines.length} línea(s) en el aforo${countLabel(current)}. ¿Confirmas?`,
    web: countLink,
  }),
  defineRestWrite({
    name: "inventory_count_holder_line_add",
    module: "inventory",
    scope: "cellar.operate",
    title: "Contar un nicho o jaulón en el aforo",
    description: "Añade al aforo las botellas contadas en un nicho o jaulón (indica holder_code o holder_id, no los dos); el volumen se calcula con el formato.",
    input: z.object({
      id,
      holder_code: code.optional().describe("Código del nicho o jaulón"),
      holder_id: id.optional(),
      owner_entity_id: id.describe("Id de la sociedad propietaria"),
      lot_id: id,
      product_id: id,
      product_state: z.enum(PACKAGED_STATES).describe("El jaulón solo guarda embotellado sin etiquetar"),
      counted_qty_units: z.number().int().min(0).describe("Botellas contadas"),
    }).strict(),
    route: "POST /v1/inventory-counts/:id/holder-lines",
    current: { route: "GET /v1/inventory-counts/:id" },
    summary: (input, current) => `Anotar ${input.counted_qty_units} botellas de ${input.holder_code ?? "el soporte"} en el aforo${countLabel(current)}. ¿Confirmas?`,
    web: countLink,
  }),
  defineRestWrite({
    name: "inventory_count_close",
    module: "inventory",
    scope: "inventory.count",
    title: "Cerrar el recuento del aforo",
    description: "Cierra el recuento: todas las líneas deben estar contadas y cada diferencia con su motivo. Pasa a revisión con las diferencias calculadas y ya no admite cambios.",
    input: z.object({ id }).strict(),
    route: "POST /v1/inventory-counts/:id/close",
    current: { route: "GET /v1/inventory-counts/:id" },
    summary: (_input, current) => `Cerrar el recuento del aforo${countLabel(current)}: ya no se podrán cambiar las líneas y pasará a revisión con sus diferencias. ¿Confirmas?`,
    web: countLink,
  }),
  defineRestWrite({
    name: "inventory_count_posting_request",
    module: "inventory",
    scope: "inventory.count",
    title: "Pedir la contabilización del aforo",
    description: "Pide la aprobación para contabilizar un aforo en revisión. Al aprobarse se regularizan las existencias físicas y fiscales con las diferencias; hasta entonces no cambia nada.",
    input: z.object({ id }).strict(),
    route: "POST /v1/inventory-counts/:id/post-request",
    current: { route: "GET /v1/inventory-counts/:id" },
    summary: (_input, current) => `Pedir la aprobación para contabilizar el aforo${countLabel(current)}: al aprobarse se ajustan las existencias físicas y fiscales con sus diferencias. ¿Confirmas?`,
    web: countLink,
  }),
  defineRestRead({
    name: "inventory_holder_stock_list",
    module: "inventory",
    scope: "cellar.read",
    title: "Botellas en nichos y jaulones",
    description: "Las botellas guardadas en cada nicho o jaulón, por lote, producto y estado.",
    input: z.object({
      location_id: id.optional(),
      holder_id: id.optional(),
      holder: code.optional().describe("Código del nicho o jaulón"),
      state: z.enum(PACKAGED_STATES).optional(),
      kind: z.enum(["nicho", "jaulon"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }).strict(),
    route: "GET /v1/holder-stock",
    web: () => "/bodega/contenedores",
  }),
  defineRestRead({
    name: "inventory_locations_list",
    module: "inventory",
    scope: "cellar.read",
    title: "Ubicaciones",
    description: "Las ubicaciones donde hay existencias (bodega, tienda, almacenes propios o de terceros, tránsito…), con su depósito fiscal y la sociedad que las controla.",
    input: z.object({
      kind: z.enum(LOCATION_KINDS).optional(),
      is_active: z.boolean().optional().describe("true solo las activas, false solo las archivadas; sin indicarlo salen todas"),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: code.optional().describe("next_cursor de la página anterior"),
    }).strict(),
    route: "GET /v1/locations",
  }),
  defineRestRead({
    name: "inventory_location_get",
    module: "inventory",
    scope: "cellar.read",
    title: "Ficha de la ubicación",
    description: "Una ubicación por su código, con su id, tipo, depósito fiscal, operador, sociedad y dirección.",
    input: z.object({ code }).strict(),
    route: "GET /v1/locations/:code",
  }),
  defineRestWrite({
    name: "inventory_location_create",
    module: "inventory",
    scope: "cellar.manage",
    title: "Crear ubicación",
    description: "Da de alta una ubicación de existencias. Un almacén de un operador logístico necesita el contacto del operador.",
    input: z.object({
      code: code.describe("Código en mayúsculas, dígitos o guion; no se cambia después"),
      name: locationSchema.name,
      kind: locationSchema.kind,
      controlling_entity_id: locationSchema.controlling_entity_id,
      tax_warehouse_id: locationSchema.tax_warehouse_id.nullable().optional(),
      operator_contact_id: locationSchema.operator_contact_id.nullable().optional(),
      address: locationSchema.address.nullable().optional(),
      is_virtual: locationSchema.is_virtual.optional(),
    }).strict(),
    route: "POST /v1/locations",
    summary: (input) => `Crear la ubicación ${input.code} · ${input.name}. ¿Confirmas?`,
  }),
  defineRestWrite({
    name: "inventory_location_update",
    module: "inventory",
    scope: "cellar.manage",
    title: "Editar ubicación",
    description: "Cambia datos de la ubicación; solo hace falta mandar lo que cambia (null quita el depósito fiscal, el operador o la dirección). El código no se cambia.",
    input: z.object({
      code,
      changes: z.object({
        name: locationSchema.name.optional(),
        kind: locationSchema.kind.optional(),
        controlling_entity_id: locationSchema.controlling_entity_id.optional(),
        tax_warehouse_id: locationSchema.tax_warehouse_id.nullable().optional(),
        operator_contact_id: locationSchema.operator_contact_id.nullable().optional(),
        address: locationSchema.address.nullable().optional(),
        is_virtual: locationSchema.is_virtual.optional(),
        is_active: z.boolean().optional().describe("false la archiva (sin recipientes ni existencias)"),
      }).strict(),
    }).strict(),
    route: "PATCH /v1/locations/:code",
    current: { route: "GET /v1/locations/:code" },
    send: (input) => input.changes,
    summary: (input) => input.changes.is_active === false
      ? `Archivar la ubicación ${input.code}: deja de salir en los selectores; su historial se conserva. ¿Confirmas?`
      : `Editar ubicación: ${input.code}. ¿Confirmas?`,
  }),
  defineRestWrite({
    name: "inventory_location_archive",
    module: "inventory",
    scope: "cellar.manage",
    title: "Archivar ubicación",
    description: "Archiva una ubicación que ya no tiene recipientes en servicio ni existencias; deja de salir en los selectores y su historial se conserva.",
    input: z.object({ code, reason: z.string().max(500).optional().describe("Motivo, queda en la auditoría") }).strict(),
    route: "POST /v1/locations/:code/archive",
    current: { route: "GET /v1/locations/:code" },
    summary: (input) => `Archivar la ubicación ${input.code}: deja de salir en los selectores; su historial se conserva. ¿Confirmas?`,
  }),
  defineRestRead({
    name: "inventory_tax_warehouses_list",
    module: "inventory",
    scope: "regulatory.read",
    title: "Depósitos fiscales",
    description: "Los depósitos fiscales (almacenes de impuestos especiales) de las sociedades que la persona puede ver; el CAE completo solo lo ve el propietario.",
    input: z.object({ entity: id.optional().describe("Solo los de esa sociedad (id)") }).strict(),
    route: "GET /v1/tax-warehouses",
  }),
  defineRestRead({
    name: "inventory_materials_stock_list",
    module: "inventory",
    scope: "cellar.read",
    title: "Existencias de materiales de envasado",
    description: "Cuántas unidades de cada material de envasado (corchos, cápsulas, etiquetas, cajas…) hay en cada ubicación a una fecha.",
    input: z.object({
      at: dayOrInstant,
      product_id: id.optional(),
      location_id: id.optional(),
      owner: entity.optional(),
    }).strict(),
    route: "GET /v1/materials/stock",
    web: () => "/stock",
  }),
  defineRestWrite({
    name: "inventory_material_receipt_create",
    module: "inventory",
    scope: "cellar.operate",
    title: "Registrar entrada de material",
    description: "Anota la llegada de unidades de un material de envasado a una ubicación (sube su stock). La fecha no puede ser futura ni de un periodo cerrado.",
    input: z.object({
      product_id: id.describe("Producto de tipo packaging_material"),
      location_id: id,
      owner_entity_id: id.nullable().optional().describe("Sociedad propietaria; por defecto la que controla la ubicación"),
      qty_units: z.number().int().min(1).max(1_000_000_000),
      occurred_at: instant,
    }).strict(),
    route: "POST /v1/materials/receipts",
    summary: (input) => `Registrar la entrada de ${input.qty_units} unidades de material con fecha ${input.occurred_at}. ¿Confirmas?`,
    web: () => "/stock",
  }),
];
