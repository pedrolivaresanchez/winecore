import { tinyPdf } from "./files";

/**
 * Datos sintéticos para recorrer la app en el móvil: presupuestos, pedidos, albaranes,
 * facturas, un cobro, gastos y una aprobación pendiente. Todo pasa por la API pública
 * con el usuario de desarrollo, igual que lo haría la interfaz.
 */
export type SeedIds = {
  customerId: string;
  customerName: string;
  supplierId: string;
  quoteDraftId: string;
  quoteSentId: string;
  orderDraftId: string;
  orderConfirmedId: string;
  deliveryDraftId: string;
  deliveryDeliveredId: string;
  invoiceDraftId: string;
  invoiceIssuedId: string;
  expenseId: string;
  expenseCapturedId: string;
  approvalId: string | null;
  stockCountId: string | null;
};

// Respuestas JSON de la API sin esquema: el seed solo lee los ids que necesita.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

export function client(base: string, user = "owner@winecore.test") {
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${base}/v1${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "x-dev-user": user,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json };
  }
  async function ok(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Json> {
    const result = await call(method, path, body, headers);
    if (result.status >= 300) {
      throw new Error(`${method} ${path} → ${result.status} ${JSON.stringify(result.json).slice(0, 300)}`);
    }
    return result.json as Json;
  }
  return { call, ok };
}

async function ensureNumbering(api: ReturnType<typeof client>, entityId: string, docType: string) {
  const year = new Date().getFullYear();
  const probe = await api.call(
    "GET",
    `/number-series/proposal?legal_entity_id=${entityId}&doc_type=${docType}&year=${year}`,
  );
  if (probe.status === 200 && probe.json.active == null) {
    await api.ok("POST", "/number-series/open", {
      legal_entity_id: entityId,
      doc_type: docType,
      year,
      choice: "fresh",
    });
  }
}

export async function seedMobile(base: string): Promise<SeedIds> {
  const api = client(base);
  const customers = (await api.ok("GET", "/contacts?role=customer&archived=false&limit=60")).items as Json[];
  const withCity = customers.filter((item) => item.city && item.country_code === "ES");
  const customer = withCity[0];
  const second = withCity[1];
  const third = withCity[2];
  if (!customer || !second || !third) throw new Error("El seed de demostración no trae clientes españoles");
  const suppliers = (await api.ok("GET", "/contacts?role=supplier&archived=false&limit=10")).items as Json[];
  const supplier = suppliers[0];
  if (!supplier) throw new Error("El seed de demostración no trae proveedores");
  const stock = (await api.ok("GET", "/stock/balances?limit=40")).items as Json[];
  const packaged = stock.filter((row) => row.product_id && row.lot_id && row.qty_units >= 40);
  const first = packaged[0];
  const other = packaged[1] ?? first;
  if (!first) throw new Error("El seed de demostración no deja stock envasado");

  const lines = (row: Json, quantity: string, price: string) => [
    { product_id: row.product_id, quantity, unit_price: price, price_reason: "Precio de la prueba móvil" },
  ];

  const quoteDraft = await api.ok("POST", "/quotes", {
    customer_id: second.id,
    channel: "direct",
    lines: lines(other, "12", "9.80"),
  });
  const quoteSent = await api.ok("POST", "/quotes", {
    customer_id: third.id,
    channel: "horeca",
    lines: lines(first, "24", "11.40"),
  });
  await api.ok("POST", `/quotes/${quoteSent.id}/send`, {});

  const chainQuote = await api.ok("POST", "/quotes", {
    customer_id: customer.id,
    channel: "direct",
    lines: lines(first, "6", "12.50"),
  });
  await api.ok("POST", `/quotes/${chainQuote.id}/send`, {});
  await api.ok("POST", `/quotes/${chainQuote.id}/accept`, {});
  const order = await api.ok("POST", `/quotes/${chainQuote.id}/to-order`, {});
  await api.ok("POST", `/sales-orders/${order.id}/confirm`, {});
  const confirmed = await api.ok("GET", `/sales-orders/${order.id}`);
  const entityId = String(confirmed.legal_entity_id);

  const orderDraft = await api.ok("POST", "/sales-orders", {
    customer_id: third.id,
    channel: "direct",
    lines: lines(other, "4", "10.20"),
  });

  const noteBody = (source: Json) => ({
    from_location_id: first.location_id,
    lines: (source.lines as Json[]).map((line) => ({
      order_line_id: line.id,
      quantity: line.quantity,
      lot_id: first.lot_id,
    })),
  });
  const note = await api.ok("POST", `/sales-orders/${order.id}/delivery-notes`, noteBody(confirmed));
  await api.ok("POST", `/delivery-notes/${note.id}/issue`, {});
  await api.ok("POST", `/delivery-notes/${note.id}/dispatch`, {});
  await api.ok("POST", `/delivery-notes/${note.id}/deliver`, {});

  const orderB = await api.ok("POST", "/sales-orders", {
    customer_id: second.id,
    channel: "direct",
    lines: lines(other, "5", "10.20"),
  });
  await api.ok("POST", `/sales-orders/${orderB.id}/confirm`, {});
  const orderBFull = await api.ok("GET", `/sales-orders/${orderB.id}`);
  const noteDraft = await api.ok("POST", `/sales-orders/${orderB.id}/delivery-notes`, {
    from_location_id: first.location_id,
    lines: (orderBFull.lines as Json[]).map((line) => ({
      order_line_id: line.id,
      quantity: line.quantity,
      lot_id: other.lot_id,
    })),
  });

  await ensureNumbering(api, entityId, "invoice");
  const invoice = await api.ok("POST", "/invoices", {
    customer_id: customer.id,
    legal_entity_id: entityId,
    from_delivery_notes: [note.id],
  });
  const validation = await api.ok("POST", `/invoices/${invoice.id}/validate`, {});
  if (Array.isArray(validation.errors) && validation.errors.length > 0) {
    throw new Error(`La factura no valida: ${JSON.stringify(validation.errors)}`);
  }
  await api.ok("POST", `/invoices/${invoice.id}/issue`, {});

  const invoiceDraft = await api.ok("POST", "/invoices", {
    customer_id: second.id,
    legal_entity_id: entityId,
    lines: [{ product_id: other.product_id, quantity: "3", unit_price: "14.00", tax_code: "IVA21" }],
  });

  const issued = await api.ok("GET", `/invoices/${invoice.id}`);
  const outstanding = String(issued.total ?? "0");
  const half = (Number(outstanding) / 2).toFixed(2);
  const payment = await api.call("POST", "/payments", {
    direction: "in",
    method: "transfer",
    amount: half,
    value_date: new Date().toISOString().slice(0, 10),
    counterparty_id: customer.id,
    legal_entity_id: entityId,
    reference: "Cobro de la prueba móvil",
    allocations: [{ target_table: "billing.invoice", target_id: invoice.id, amount: half }],
  });
  if (payment.status >= 300) console.warn(`Cobro de demostración no creado: ${JSON.stringify(payment.json).slice(0, 200)}`);

  const category = ((await api.ok("GET", "/expense-categories")).items as Json[])[0];
  const captured = await api.ok("POST", "/supplier-invoices/capture", {
    filename: "gasto-movil.pdf",
    content_base64: tinyPdf().toString("base64"),
    entity: "CVPO",
    source: "upload",
  });
  const expense = await api.ok("POST", "/supplier-invoices/capture", {
    filename: "gasto-movil-2.pdf",
    content_base64: Buffer.concat([tinyPdf(), Buffer.from("\n%seed2\n")]).toString("base64"),
    entity: "CVPO",
    source: "photo",
  });
  const today = new Date().toISOString().slice(0, 10);
  const patched = await api.ok(
    "PATCH",
    `/supplier-invoices/${expense.id}`,
    {
      supplier_id: supplier.id,
      supplier_invoice_number: `F-MOVIL-${Date.now()}`,
      issue_date: today,
      accounting_date: today,
      category_code: category?.code,
      subtotal: "48.00",
      tax_total: "10.08",
      withholding_total: "0.00",
      total: "58.08",
      lines: [
        {
          description: "Metabisulfito de potasio sintético",
          quantity: "1.000",
          unit_price: "48.00",
          line_base: "48.00",
          vat_rate: "21.00",
          vat_quota: "10.08",
          withholding_rate: "0.00",
          vat_deductible_pct: "100.00",
          expense_account: category?.default_account ?? "600",
        },
      ],
    },
    { "if-match": String(expense.updated_at) },
  );
  const validated = await api.ok("POST", `/supplier-invoices/${expense.id}/validate`, undefined, {
    "if-match": String(patched.updated_at),
  });
  const asked = await api.call("POST", `/supplier-invoices/${expense.id}/request-approval`, undefined, {
    "if-match": String(validated.updated_at),
  });
  if (asked.status >= 300) console.warn(`Aprobación de gasto no creada: ${JSON.stringify(asked.json).slice(0, 200)}`);

  const pending = await api.ok("GET", "/approvals?status=pending&limit=10");
  const approvalId = ((pending.items as Json[])[0]?.id as string | undefined) ?? null;

  return {
    customerId: customer.id,
    customerName: customer.legal_name,
    supplierId: supplier.id,
    quoteDraftId: quoteDraft.id,
    quoteSentId: quoteSent.id,
    orderDraftId: orderDraft.id,
    orderConfirmedId: orderB.id,
    deliveryDraftId: noteDraft.id,
    deliveryDeliveredId: note.id,
    invoiceDraftId: invoiceDraft.id,
    invoiceIssuedId: invoice.id,
    expenseId: expense.id,
    expenseCapturedId: captured.id,
    approvalId,
    stockCountId: null,
  };
}

if (import.meta.main) {
  const base = process.argv[2] ?? "http://127.0.0.1:3161";
  const ids = await seedMobile(base);
  console.log(JSON.stringify(ids, null, 2));
}
