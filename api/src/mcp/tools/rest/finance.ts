import { z } from "zod";

import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite } from "../../rest";

const id = z.guid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("Mes AAAA-MM");
const amount = z.string().regex(/^\d+([.,]\d{1,2})?$/).describe("Euros, mayor que cero y con hasta 2 decimales, p. ej. \"121.00\"");
const entity = z.string().min(2).max(36).describe("Sociedad: su código (PO, CVPO) o su id");
const limit = z.number().int().min(1).max(100).optional();
const targetTable = z.enum(["billing.invoice", "purchasing.supplier_invoice", "legacy.open_item"])
  .describe("billing.invoice = factura emitida; purchasing.supplier_invoice = factura de proveedor; legacy.open_item = pendiente importado de Holded");
const discount = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).describe("Descuento sobre la tarifa base en %, de 0 a 99.99, p. ej. \"60\"");

function fieldOf(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" || typeof found === "number" ? String(found) : null;
}

const remittanceLink = (input: { id: string }) => `/cobros/remesas/${input.id}`;
const statementLink = (input: { id: string }) => `/cobros?vista=conciliacion&extracto=${input.id}`;
const tariffLink = (input: { id: string }) => `/intercompania/tarifas/${input.id}`;
const settlementLink = (_input: unknown, body: unknown) => {
  const period = fieldOf(body, "period");
  return period ? `/intercompania/${period}` : "/intercompania";
};

function paymentLabel(current: unknown): string {
  const what = fieldOf(current, "direction") === "out" ? "pago" : "cobro";
  const who = fieldOf(current, "counterparty_name");
  return `el ${what} de ${fieldOf(current, "amount") ?? "?"} €${who ? ` de ${who}` : ""} (fecha valor ${fieldOf(current, "value_date") ?? "?"})`;
}

function remittanceLabel(current: unknown): string {
  const kind = fieldOf(current, "kind") === "credit_transfer" ? "de transferencias" : "de adeudos";
  return `la remesa ${kind} de ${fieldOf(current, "total") ?? "?"} € con fecha ${fieldOf(current, "execution_date") ?? "?"}`;
}

function tariffLabel(current: unknown): string {
  const to = fieldOf(current, "valid_to");
  return `la tarifa intercompañía del ${fieldOf(current, "discount_pct") ?? "?"} % (desde ${fieldOf(current, "valid_from") ?? "?"}${to ? ` hasta ${to}` : ""})`;
}

const allocation = z.object({
  target_table: targetTable,
  target_id: id.describe("Id del documento (target_id en finance_receivables_list)"),
  amount,
}).strict();

const remittanceItem = z.object({
  target_table: targetTable,
  target_id: id.describe("Id del documento (target_id en finance_receivables_list)"),
  amount: amount.optional().describe("Por defecto, todo lo pendiente del documento"),
}).strict();

const statementAllocation = z.object({
  target_table: targetTable,
  target_id: id.describe("Id del documento (sale en las sugerencias del movimiento o en finance_receivables_list)"),
  amount: amount.optional().describe("Por defecto, el importe entero del movimiento"),
}).strict();

const tariffFields = {
  base_price_list_id: id.describe("Tarifa de venta de la que parte el precio intercompañía"),
  discount_pct: discount,
  valid_from: date.describe("Primer día de vigencia (AAAA-MM-DD)"),
  advisor_validation: z.string().min(5).describe("Referencia de la validación del asesor fiscal (precio de mercado); obligatoria"),
};

export const financeRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "finance_receivables_list",
    module: "finance",
    scope: "finance.read",
    title: "Pendiente de cobro y de pago",
    description: "Lo que queda por cobrar (o por pagar, con direction=payable) agrupado por cliente y por antigüedad (0-30, 31-60, 61-90, >90 días), con total, vencido, lo que vence en 30 días y lo cobrado este mes. Cada documento trae target_table y target_id, que son los que piden los cobros, las remesas y la conciliación.",
    input: z.object({
      entity: entity.optional(),
      contact_id: id.optional().describe("Solo los documentos de este contacto"),
      aging: z.enum(["0-30", "31-60", "61-90", ">90"]).optional().describe("Solo un tramo de antigüedad, en días"),
      direction: z.enum(["receivable", "payable"]).optional().describe("receivable (por defecto) = por cobrar; payable = por pagar"),
    }).strict(),
    route: "GET /v1/receivables",
    web: () => "/cobros",
  }),
  defineRestRead({
    name: "finance_payments_list",
    module: "finance",
    scope: "finance.read",
    title: "Cobros y pagos registrados",
    description: "Los cobros y pagos registrados, del más reciente al más antiguo, con los documentos a los que se imputaron. Filtra por sociedad, sentido, contacto y fechas; paginado con next_cursor.",
    input: z.object({
      entity: entity.optional(),
      direction: z.enum(["in", "out"]).optional().describe("in = cobros; out = pagos"),
      counterparty_id: id.optional().describe("Solo los de este contacto"),
      from: date.optional().describe("Fecha valor desde (AAAA-MM-DD)"),
      to: date.optional().describe("Fecha valor hasta (AAAA-MM-DD)"),
      limit,
      cursor: z.string().max(200).optional(),
    }).strict(),
    route: "GET /v1/payments",
    web: () => "/cobros?vista=pagos",
  }),
  defineRestRead({
    name: "finance_payment_get",
    module: "finance",
    scope: "finance.read",
    title: "Detalle de un cobro o pago",
    description: "Un cobro o pago con su contacto, cuenta, estado (registered o reversed) y lo imputado a cada documento.",
    input: z.object({ id }).strict(),
    route: "GET /v1/payments/:id",
    web: () => "/cobros?vista=pagos",
  }),
  defineRestWrite({
    name: "finance_payment_record",
    module: "finance",
    scope: "finance.write",
    title: "Registrar cobro o pago",
    description: "Apunta un cobro de un cliente o un pago a un proveedor y lo imputa a sus facturas, que quedan pagadas o parcialmente pagadas. La fecha valor no puede ser futura; lo imputado no puede pasar del importe ni de lo pendiente de cada factura.",
    input: z.object({
      direction: z.enum(["in", "out"]).describe("in = cobro de un cliente; out = pago a un proveedor"),
      method: z.enum(["transfer", "direct_debit", "card", "cash", "stripe", "compensation", "other"]),
      amount,
      value_date: date.describe("Fecha valor AAAA-MM-DD; no puede ser futura"),
      counterparty_id: id.describe("Contacto que paga o al que se paga; tiene que ser el de las facturas"),
      legal_entity_id: entity.optional().describe("Sociedad (código o id); si se omite, la de las facturas imputadas"),
      bank_account_id: id.optional().describe("Cuenta bancaria de la sociedad (finance_bank_accounts_list)"),
      reference: z.string().max(140).optional(),
      allocations: z.array(allocation).describe("Facturas que salda y cuánto a cada una; vacío deja el importe sin imputar"),
    }).strict(),
    route: "POST /v1/payments",
    summary: (input) => {
      const what = input.direction === "in" ? "cobro" : "pago";
      const docs = input.allocations.length === 0 ? "sin imputarlo a ninguna factura" : `imputado a ${input.allocations.length} factura(s)`;
      return `Registrará un ${what} de ${input.amount} € con fecha valor ${input.value_date}, ${docs}. ¿Confirmas?`;
    },
    web: () => "/cobros?vista=pagos",
  }),
  defineRestWrite({
    name: "finance_payment_reverse",
    module: "finance",
    scope: "finance.manage",
    title: "Anular cobro o pago",
    description: "Anula un cobro o pago registrado indicando el motivo: sus facturas vuelven a quedar pendientes. Solo se anulan los que están en estado registered.",
    input: z.object({
      id,
      reason: z.string().min(3).max(500).describe("Motivo de la anulación"),
    }).strict(),
    route: "POST /v1/payments/:id/reverse",
    current: { route: "GET /v1/payments/:id" },
    summary: (input, current) => `Anulará ${paymentLabel(current)} por «${input.reason}». Las facturas que saldaba vuelven a quedar pendientes. No se puede deshacer.`,
    web: () => "/cobros?vista=pagos",
  }),
  defineRestRead({
    name: "finance_bank_accounts_list",
    module: "finance",
    scope: "finance.read",
    title: "Cuentas bancarias",
    description: "Las cuentas bancarias activas de las sociedades (banco, últimos 4 dígitos del IBAN, BIC, identificador de acreedor SEPA y cuál es la de por defecto). Sus id se usan en cobros, extractos y remesas.",
    input: z.object({ entity: entity.optional() }).strict(),
    route: "GET /v1/bank-accounts",
  }),
  defineRestWrite({
    name: "finance_bank_account_create",
    module: "finance",
    scope: "finance.manage",
    title: "Dar de alta cuenta bancaria",
    description: "Añade una cuenta bancaria a una sociedad. El IBAN se guarda cifrado; el identificador de acreedor SEPA, si no se indica, se calcula con el NIF de la sociedad. Marcarla por defecto quita la marca a la anterior.",
    input: z.object({
      legal_entity_id: entity,
      bank_name: z.string().min(2).max(80),
      iban: z.string().min(15).max(42).describe("IBAN de la cuenta"),
      bic: z.string().max(11).optional(),
      sepa_creditor_id: z.string().max(35).optional().describe("Identificador de acreedor SEPA (para adeudos)"),
      is_default: z.boolean().optional().describe("Cuenta por defecto de la sociedad"),
    }).strict(),
    route: "POST /v1/bank-accounts",
    summary: (input) => `Dará de alta la cuenta de ${input.bank_name} terminada en ${input.iban.replace(/\s+/g, "").slice(-4)}${input.is_default ? " como cuenta por defecto" : ""}. ¿Confirmas?`,
  }),
  defineRestRead({
    name: "finance_bank_statements_list",
    module: "finance",
    scope: "finance.read",
    title: "Extractos bancarios importados",
    description: "Los extractos importados, con su periodo, formato y cuántos movimientos están conciliados, sugeridos o ignorados.",
    input: z.object({ entity: entity.optional() }).strict(),
    route: "GET /v1/bank-statements",
    web: () => "/cobros?vista=conciliacion",
  }),
  defineRestWrite({
    name: "finance_bank_statement_import",
    module: "finance",
    scope: "finance.write",
    title: "Importar extracto bancario",
    description: "Importa un extracto Norma 43 o camt.053 de una cuenta. Los movimientos que casan sin duda con una factura se registran solos como cobro o pago; el resto queda con sugerencias para conciliar. Un fichero ya importado se rechaza.",
    input: z.object({
      bank_account_id: id.describe("Cuenta del extracto (finance_bank_accounts_list)"),
      format: z.enum(["n43", "camt053"]).describe("n43 = Norma 43 (texto); camt053 = XML ISO 20022"),
      filename: z.string().max(80).optional(),
      content_base64: z.string().max(2_666_668).optional().describe("El fichero en base64; manda esto o content, no los dos"),
      content: z.string().max(2_000_000).optional().describe("El fichero como texto; manda esto o content_base64, no los dos"),
    }).strict(),
    route: "POST /v1/bank-statements",
    summary: (input) => `Importará el extracto ${input.filename ?? input.format}. Los movimientos que casen con una sola factura quedarán registrados como cobro o pago. ¿Confirmas?`,
    web: (_input, body) => {
      const imported = fieldOf(body, "id");
      return imported ? `/cobros?vista=conciliacion&extracto=${imported}` : "/cobros?vista=conciliacion";
    },
  }),
  defineRestRead({
    name: "finance_bank_statement_suggestions_list",
    module: "finance",
    scope: "finance.read",
    title: "Movimientos de un extracto con sugerencias",
    description: "Los movimientos de un extracto importado con su estado (matched, suggested, unmatched, ignored) y las facturas sugeridas para conciliarlos. El id de cada movimiento es el line_id para confirmar o ignorar.",
    input: z.object({ id: id.describe("Id del extracto importado") }).strict(),
    route: "GET /v1/bank-statements/:id/suggestions",
    web: statementLink,
  }),
  defineRestWrite({
    name: "finance_bank_statement_line_confirm",
    module: "finance",
    scope: "finance.write",
    title: "Conciliar movimiento del extracto",
    description: "Concilia un movimiento del extracto con una o varias facturas del mismo contacto: registra el cobro o pago por transferencia con la fecha del banco y deja el movimiento conciliado.",
    input: z.object({
      id: id.describe("Id del extracto importado"),
      line_id: id.describe("Id del movimiento (finance_bank_statement_suggestions_list)"),
      allocations: z.array(statementAllocation).min(1),
    }).strict(),
    route: "POST /v1/bank-statements/:id/lines/:lineId/confirm",
    params: { lineId: "line_id" },
    summary: (input) => `Conciliará el movimiento con ${input.allocations.length} factura(s) y registrará el cobro o pago correspondiente. ¿Confirmas?`,
    web: statementLink,
  }),
  defineRestWrite({
    name: "finance_bank_statement_line_ignore",
    module: "finance",
    scope: "finance.write",
    title: "Ignorar movimiento del extracto",
    description: "Marca un movimiento del extracto como ignorado (comisiones, traspasos internos…) con el motivo; deja de salir como pendiente de conciliar.",
    input: z.object({
      id: id.describe("Id del extracto importado"),
      line_id: id.describe("Id del movimiento (finance_bank_statement_suggestions_list)"),
      reason: z.string().min(3).max(300),
    }).strict(),
    route: "POST /v1/bank-statements/:id/lines/:lineId/ignore",
    params: { lineId: "line_id" },
    web: statementLink,
  }),
  defineRestRead({
    name: "finance_remittances_list",
    module: "finance",
    scope: "finance.read",
    title: "Remesas SEPA",
    description: "Las remesas de adeudos a clientes y de transferencias a proveedores, con su estado, fecha y total; paginado con next_cursor.",
    input: z.object({
      entity: entity.optional(),
      status: z.enum(["draft", "pending_approval", "approved", "file_generated", "uploaded_by_user", "settled", "partially_rejected", "cancelled"]).optional(),
      kind: z.enum(["direct_debit", "credit_transfer"]).optional().describe("direct_debit = adeudos a clientes; credit_transfer = transferencias a proveedores"),
      limit,
      cursor: z.string().regex(/^\d{1,7}$/).optional(),
    }).strict(),
    route: "GET /v1/remittances",
    web: () => "/cobros?vista=remesas",
  }),
  defineRestRead({
    name: "finance_remittance_get",
    module: "finance",
    scope: "finance.read",
    title: "Detalle de una remesa",
    description: "Una remesa SEPA con su estado, cuenta, fecha, total y cada factura incluida con su contacto e importe.",
    input: z.object({ id }).strict(),
    route: "GET /v1/remittances/:id",
    web: remittanceLink,
  }),
  defineRestRead({
    name: "finance_remittance_file_get",
    module: "finance",
    scope: "finance.manage",
    title: "Descargar fichero SEPA de la remesa",
    description: "El XML SEPA (pain.008 de adeudos o pain.001 de transferencias) ya generado, para subirlo al banco. Solo existe después de generarlo.",
    input: z.object({ id }).strict(),
    route: "GET /v1/remittances/:id/file",
    web: remittanceLink,
  }),
  defineRestWrite({
    name: "finance_remittance_create",
    module: "finance",
    scope: "finance.manage",
    title: "Crear remesa SEPA",
    description: "Crea en borrador una remesa de adeudos (facturas emitidas a clientes con mandato SEPA) o de transferencias (facturas de proveedor aprobadas). Todos los contactos necesitan IBAN; una factura no puede estar en dos remesas.",
    input: z.object({
      legal_entity_id: entity,
      kind: z.enum(["direct_debit", "credit_transfer"]).describe("direct_debit = adeudos a clientes; credit_transfer = transferencias a proveedores"),
      bank_account_id: id.describe("Cuenta de la sociedad que cobra o paga (finance_bank_accounts_list)"),
      execution_date: date.describe("Fecha de cargo o de ejecución (AAAA-MM-DD); no puede ser anterior a hoy"),
      items: z.array(remittanceItem).min(1).max(500),
    }).strict(),
    route: "POST /v1/remittances",
    summary: (input) => `Creará en borrador una remesa de ${input.kind === "direct_debit" ? "adeudos" : "transferencias"} con ${input.items.length} factura(s) y fecha ${input.execution_date}. ¿Confirmas?`,
    web: (_input, body) => {
      const created = fieldOf(body, "id");
      return created ? `/cobros/remesas/${created}` : "/cobros?vista=remesas";
    },
  }),
  defineRestWrite({
    name: "finance_remittance_request_approval",
    module: "finance",
    scope: "finance.manage",
    title: "Pedir aprobación de la remesa",
    description: "Manda a aprobación una remesa en borrador. Hasta que alguien la apruebe no se puede generar el fichero SEPA.",
    input: z.object({ id }).strict(),
    route: "POST /v1/remittances/:id/request-approval",
    current: { route: "GET /v1/remittances/:id" },
    summary: (_input, current) => `Pedirá la aprobación de ${remittanceLabel(current)}. Mientras esté pendiente no se puede cambiar. ¿Confirmas?`,
    web: remittanceLink,
  }),
  defineRestWrite({
    name: "finance_remittance_file_generate",
    module: "finance",
    scope: "finance.manage",
    title: "Generar fichero SEPA de la remesa",
    description: "Genera el XML SEPA de una remesa ya aprobada y consume la aprobación. Si la remesa cambió desde que se aprobó, se rechaza.",
    input: z.object({ id }).strict(),
    route: "POST /v1/remittances/:id/generate",
    current: { route: "GET /v1/remittances/:id" },
    summary: (_input, current) => `Generará el fichero SEPA de ${remittanceLabel(current)} y consumirá su aprobación. Después hay que subirlo al banco. ¿Confirmas?`,
    web: remittanceLink,
  }),
  defineRestWrite({
    name: "finance_remittance_mark_submitted",
    module: "finance",
    scope: "finance.manage",
    title: "Marcar remesa subida al banco",
    description: "Deja constancia de que el fichero SEPA generado ya se ha subido a la banca online.",
    input: z.object({ id }).strict(),
    route: "POST /v1/remittances/:id/submitted",
    current: { route: "GET /v1/remittances/:id" },
    summary: (_input, current) => `Marcará ${remittanceLabel(current)} como subida al banco. No se puede deshacer. ¿Confirmas?`,
    web: remittanceLink,
  }),
  defineRestRead({
    name: "finance_intercompany_tariffs_list",
    module: "finance",
    scope: "billing.read",
    title: "Tarifas intercompañía",
    description: "Las tarifas de precios entre PO y CVPO (tarifa base, descuento, vigencia, estado draft/active/retired y validación del asesor).",
    input: z.object({}).strict(),
    route: "GET /v1/intercompany/tariffs",
    web: () => "/intercompania/tarifas",
  }),
  defineRestRead({
    name: "finance_intercompany_tariff_get",
    module: "finance",
    scope: "billing.read",
    title: "Detalle de una tarifa intercompañía",
    description: "Una tarifa intercompañía con su tarifa base, descuento, vigencia, estado y validación del asesor.",
    input: z.object({ id }).strict(),
    route: "GET /v1/intercompany/tariffs/:id",
    web: tariffLink,
  }),
  defineRestWrite({
    name: "finance_intercompany_tariff_create",
    module: "finance",
    scope: "settings.manage",
    title: "Crear tarifa intercompañía",
    description: "Crea en borrador una tarifa de precios de PO a CVPO: una tarifa base con un descuento y una vigencia, validada por el asesor fiscal. Solo el propietario; no se aplica hasta activarla.",
    input: z.object({
      ...tariffFields,
      valid_to: date.optional().describe("Fin de vigencia, exclusivo (AAAA-MM-DD); sin él, indefinida"),
      seller_entity_id: id.optional().describe("Sociedad que vende; con buyer_entity_id, o ninguna de las dos (PO a CVPO)"),
      buyer_entity_id: id.optional().describe("Sociedad que compra; con seller_entity_id, o ninguna de las dos (PO a CVPO)"),
    }).strict(),
    route: "POST /v1/intercompany/tariffs",
    web: (_input, body) => {
      const created = fieldOf(body, "id");
      return created ? `/intercompania/tarifas/${created}` : "/intercompania/tarifas";
    },
  }),
  defineRestWrite({
    name: "finance_intercompany_tariff_update",
    module: "finance",
    scope: "settings.manage",
    title: "Editar tarifa intercompañía",
    description: "Cambia una tarifa intercompañía en borrador (tarifa base, descuento, vigencia o validación del asesor). Solo el propietario; una tarifa activa o retirada no se edita. Solo hace falta mandar lo que cambia.",
    input: z.object({
      id,
      changes: z.object({
        base_price_list_id: tariffFields.base_price_list_id.optional(),
        discount_pct: discount.optional(),
        valid_from: tariffFields.valid_from.optional(),
        valid_to: date.nullable().optional().describe("Fin de vigencia, exclusivo; null la deja indefinida"),
        advisor_validation: tariffFields.advisor_validation.optional(),
      }).strict(),
    }).strict(),
    route: "PATCH /v1/intercompany/tariffs/:id",
    current: { route: "GET /v1/intercompany/tariffs/:id" },
    send: (input) => input.changes,
    web: tariffLink,
  }),
  defineRestWrite({
    name: "finance_intercompany_tariff_activate",
    module: "finance",
    scope: "settings.manage",
    title: "Activar tarifa intercompañía",
    description: "Activa una tarifa en borrador: desde entonces fija los precios de los traspasos de su vigencia. Se rechaza si se solapa con otra activa. Solo el propietario.",
    input: z.object({ id }).strict(),
    route: "POST /v1/intercompany/tariffs/:id/activate",
    current: { route: "GET /v1/intercompany/tariffs/:id" },
    summary: (_input, current) => `Activará ${tariffLabel(current)}. Desde ese momento fija los precios entre sociedades y ya no se puede editar. ¿Confirmas?`,
    web: tariffLink,
  }),
  defineRestWrite({
    name: "finance_intercompany_tariff_retire",
    module: "finance",
    scope: "settings.manage",
    title: "Retirar tarifa intercompañía",
    description: "Retira una tarifa activa: deja de aplicarse a los traspasos. Solo el propietario.",
    input: z.object({ id }).strict(),
    route: "POST /v1/intercompany/tariffs/:id/retire",
    current: { route: "GET /v1/intercompany/tariffs/:id" },
    summary: (_input, current) => `Retirará ${tariffLabel(current)}: deja de aplicarse. No se puede volver a activar. ¿Confirmas?`,
    web: tariffLink,
  }),
  defineRestRead({
    name: "finance_intercompany_settlements_list",
    module: "finance",
    scope: "billing.read",
    title: "Liquidaciones intercompañía",
    description: "Sin period: las liquidaciones mensuales de PO a CVPO con estado, totales y plazo. Con period (AAAA-MM): la liquidación de ese mes con sus líneas, precios, bloqueos y borrador de factura, aunque todavía no esté abierta.",
    input: z.object({ period: month.optional() }).strict(),
    route: "GET /v1/intercompany/settlements",
    web: (input) => (input.period ? `/intercompania/${input.period}` : "/intercompania"),
  }),
  defineRestWrite({
    name: "finance_intercompany_settlement_open",
    module: "finance",
    scope: "billing.write",
    title: "Abrir liquidación intercompañía del mes",
    description: "Abre la liquidación del mes si no existe y devuelve su vista previa (traspasos de PO a CVPO, precios y bloqueos). Si ya está abierta o cerrada, la devuelve tal cual.",
    input: z.object({ period: month }).strict(),
    route: "POST /v1/intercompany/settlements",
    web: (input) => `/intercompania/${input.period}`,
  }),
  defineRestWrite({
    name: "finance_intercompany_period_close",
    module: "finance",
    scope: "billing.write",
    title: "Cerrar mes intercompañía",
    description: "Cierra la liquidación intercompañía de un mes: congela los traspasos y sus precios y prepara el borrador de la factura de PO a CVPO. Si hay ventas por debajo de coste, hay que reconocerlo con below_cost_acknowledged.",
    input: z.object({
      period: month,
      below_cost_acknowledged: z.boolean().optional().describe("true para cerrar aunque haya líneas por debajo de coste"),
    }).strict(),
    route: "POST /v1/intercompany/settlements/close",
    summary: (input) => `Cerrará la liquidación intercompañía de ${input.period}: congela los traspasos y prepara el borrador de factura. No se puede reabrir. ¿Confirmas?`,
    web: (input) => `/intercompania/${input.period}`,
  }),
  defineRestWrite({
    name: "finance_intercompany_settlement_close",
    module: "finance",
    scope: "billing.write",
    title: "Cerrar liquidación intercompañía",
    description: "Cierra una liquidación intercompañía abierta por su id (el de finance_intercompany_settlements_list): congela los traspasos y prepara el borrador de factura. Si hay ventas por debajo de coste, hay que reconocerlo con below_cost_acknowledged.",
    input: z.object({
      id,
      below_cost_acknowledged: z.boolean().optional().describe("true para cerrar aunque haya líneas por debajo de coste"),
    }).strict(),
    route: "POST /v1/intercompany/settlements/:id/close",
    summary: () => "Cerrará la liquidación intercompañía: congela los traspasos y prepara el borrador de factura. No se puede reabrir. ¿Confirmas?",
    web: settlementLink,
  }),
  defineRestWrite({
    name: "finance_intercompany_invoice_request",
    module: "finance",
    scope: "billing.write",
    title: "Pedir la factura intercompañía",
    description: "Con la liquidación cerrada, manda a aprobación la factura intercompañía del mes. Si ya estaba aprobada, la emite.",
    input: z.object({ id }).strict(),
    route: "POST /v1/intercompany/settlements/:id/invoice-request",
    summary: () => "Pedirá la aprobación de la factura intercompañía de la liquidación; si ya estaba aprobada, la emitirá con número de serie (una factura emitida no se borra, solo se rectifica). ¿Confirmas?",
    web: settlementLink,
  }),
];
