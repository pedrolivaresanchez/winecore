/**
 * Importación de facturas de Stripe ya emitidas (Vinoveo) como ingreso de CVPO.
 *
 * Stripe ya les dio número (serie VV-0001… o el número por cliente, p. ej.
 * 8EC75E91-0001) y fecha. Este módulo las graba como documentos históricos,
 * igual que la proyección de Holded (migración 0047, origin `holded_import`):
 *
 *   - status `issued`, origin `stripe_import`
 *   - el número y la fecha de Stripe, sin llamar a `issueInvoice` ni a `takeNumber`
 *   - `legacy_refs.stripe` = el id `in_…` (la clave de idempotencia)
 *   - sin fila en `regulatory.verifactu_record` y sin `billing.invoice_delivery`
 *
 * POST /v1/invoices/:id/issue no sirve: asigna un número F26 y entra en el
 * flujo de emisión (serie, Verifactu, envío). Estas facturas no se emiten aquí.
 *
 * Las series VV (prefijo `VV-`, relleno 4, verifactu = false, inactiva para
 * emitir a mano) y VVR (rectificativas) no se crean en este cambio. Si el
 * cuerpo trae `series_code` y esa serie existe, se enlaza sin consumir número.
 * Si tiene Verifactu, se rechaza. Si no se indica serie, `series_id` queda
 * vacío: tampoco se toma la serie por defecto del año.
 *
 * Volver a enviar el mismo `in_…` responde 200 y solo actualiza el cobro
 * (`amount_paid`, `payment_status`). El resto del documento no se reescribe.
 *
 * Rectificativa (R1) solo contra otra factura `stripe_import` de la misma
 * sociedad, por el importe íntegro (el total calculado es el de la original
 * cambiado de signo) y, si se indica serie, una serie de rectificativas sin
 * Verifactu (la prevista es VVR).
 *
 * Identificación del cliente: el país es obligatorio. Se reutiliza el contacto
 * vivo con ese identificador. Fuera de la UE (un RUT chileno, etc.) se guarda
 * como `foreign_id` con `id_otro_type` 04, aunque el texto coincida con la
 * forma de un NIF español. No se asume España si el país falta: si no, un RUT
 * que cuadre con la letra de control española se grabaría como NIF.
 *
 * Moneda: hay que indicar EUR (mayúsculas o minúsculas). Otra moneda (CLP, USD)
 * se rechaza y no se convierte. Los importes van en texto y en unidades mayores
 * ("121.00"), nunca en céntimos de Stripe ni como número JSON.
 *
 * Tratamientos de línea: IVA21, y NS_LOC (no sujeta por localización, art. 69
 * LIVA) si el cliente no está en España: otro país de la UE o de fuera. El
 * total que guarda WineCore es el calculado con `computeInvoice`; si no
 * coincide con el de Stripe, no se graba nada.
 *
 * `dry_run: true` valida y no escribe. `livemode: false` (modo prueba de
 * Stripe) se rechaza. El id puede ser `in_…` o el de un abono `cn_…`.
 */
import type { Actor, Tx } from '../db/writer';
import { sql } from '../db/sql';
import type { UserCtx } from '../auth/permissions';
import { can } from '../auth/permissions';
import { domainError } from '../errors';
import { newId } from '../ids';
import { money } from '../money';
import { normalizeTaxId, type TaxIdType } from '../party/taxId';
import { findLiveTaxId } from '../party/guards';
import { insertAddress, insertContact, type AddressInput, type ContactInput } from '../party/contacts';
import { businessDate, isMadridCivilDate } from '../time';
import { computeInvoice, InvoiceCalculationError } from './compute';
import { day, decimalOf, flag, idOf, isUuid, moneyText, seriesDocType, text } from './format';
import { loadEntity, loadEntityByCode, loadTaxCodes } from './readModel';
import type { TaxCode } from './taxCodes';
import { assertWc080 } from './wc080';

const STRIPE_ID = /^(?:in|cn)_[A-Za-z0-9]{8,64}$/;
const NUMBER = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,59}$/;
const SERIES_CODE = /^[A-Z]{1,4}$/;
const COUNTRY = /^[A-Z]{2}$/;
const ALLOWED_TAX = new Set(['IVA21', 'NS_LOC']);
const PAYMENT_METHODS = new Set(['transfer', 'direct_debit', 'card', 'cash', 'stripe', 'other']);
const PAYMENT_STATUSES = new Set(['unpaid', 'partially_paid', 'paid', 'uncollectible']);
/** Fuera de esta lista, el identificador no se trata como NIF ni como NIF-IVA. */
const EU = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR',
  'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT',
  'RO', 'SE', 'SI', 'SK', 'XI',
]);
const SEPARATORS = /[\s.\\/\u2013\u2014\u2212-]+/gu;
const NS_LOC_MENTION = 'Prestación de servicios a un empresario no establecido en la UE: operación no sujeta al IVA español por reglas de localización (art. 69 Ley 37/1992).';
const HISTORICAL_NOTE = 'Importada de Stripe (Vinoveo). Ya estaba emitida: no recibe número F26, no se envía a Verifactu y no se entrega desde WineCore.';

export interface StripeImportOutcome {
  id: string | null;
  replayed: boolean;
  customerCreated: boolean;
  stripeInvoiceId: string;
  dryRun: boolean;
  customerExists: boolean;
  number: string | null;
  seriesId: string | null;
  invoiceType: 'F1' | 'R1' | null;
  currency: 'EUR';
  totals: {
    subtotal: string | null;
    taxTotal: string | null;
    surchargeTotal: string | null;
    withholdingTotal: string | null;
    total: string;
  } | null;
  warnings: string[];
}

interface PaymentResolved {
  amountPaid: string;
  status: string;
  method: string;
}

interface ParsedLine {
  description: string;
  quantity: ReturnType<typeof money.fromString>;
  unitPrice: ReturnType<typeof money.fromString>;
  discountPct: ReturnType<typeof money.fromString>;
  unit: string;
  taxCode: string;
  sku: string | null;
}

interface ParsedCustomer {
  legalName: string;
  taxId: string;
  taxIdType: TaxIdType;
  taxIdCountry: string;
  countryCode: string;
  idOtroType: '02' | '03' | '04' | null;
  kind: 'company' | 'person';
  language: 'es' | 'en';
  email: string | null;
  address: AddressInput | null;
}

interface ParsedCreate {
  number: string;
  issueDate: string;
  seriesCode: string | null;
  description: string;
  notes: string | null;
  language: 'es' | 'en';
  paymentTermsDays: number;
  lines: ParsedLine[];
  declared: {
    total: ReturnType<typeof money.fromString>;
    subtotal: ReturnType<typeof money.fromString> | null;
    taxTotal: ReturnType<typeof money.fromString> | null;
    surchargeTotal: ReturnType<typeof money.fromString> | null;
    withholdingTotal: ReturnType<typeof money.fromString> | null;
  };
  payment: PaymentResolved;
  invoiceType: 'F1' | 'R1';
  rectifiesStripeId: string | null;
  reason: string | null;
  customer: ParsedCustomer;
}

export async function importStripeInvoice(
  tx: Tx,
  raw: unknown,
  actor: Actor,
  user: UserCtx,
  now: Date,
): Promise<StripeImportOutcome> {
  if (!isUuid(actor.id)) throw domainError('WC_VALIDATION', { actor: 'El usuario no es válido' });
  const body = record(raw);
  assertLiveMode(body.livemode);
  const dryRun = dryRunOf(body.dry_run);
  const stripeInvoiceId = stripeId(body.stripe_invoice_id);
  const entity = await requireCvpo(tx, body.entity, user);
  const existing = await findImported(tx, stripeInvoiceId);
  if (existing) {
    if (existing.legalEntityId !== entity.id) {
      throw domainError('WC_VALIDATION', { entity: 'Esta factura de Stripe ya está importada en otra sociedad' });
    }
    if (!dryRun && body.payment !== undefined) {
      const payment = resolvePayment(decimalOf(existing.total), paymentRecord(body.payment));
      await applyPayment(tx, existing, payment, now);
    }
    return {
      id: existing.id,
      replayed: true,
      customerCreated: false,
      stripeInvoiceId,
      dryRun,
      customerExists: true,
      number: null,
      seriesId: null,
      invoiceType: null,
      currency: 'EUR',
      totals: {
        subtotal: null,
        taxTotal: null,
        surchargeTotal: null,
        withholdingTotal: null,
        total: existing.total,
      },
      warnings: dryRun
        ? ['La factura ya estaba importada. La simulación no ha cambiado el cobro.']
        : [],
    };
  }

  const parsed = parseCreate(body, now);
  const series = parsed.seriesCode
    ? await requireOpenSeries(
      tx,
      entity.id,
      parsed.seriesCode,
      seriesDocType(parsed.invoiceType),
      yearOf(parsed.issueDate),
    )
    : null;
  await assertNumberFree(tx, entity.id, parsed.number);
  const taxCodes = await loadTaxCodes(tx);
  const computed = calculate(parsed, taxCodes);
  assertDeclared(parsed, computed);
  const original = parsed.invoiceType === 'R1'
    ? await requireRectified(tx, entity.id, parsed.rectifiesStripeId, stripeInvoiceId, computed.totalToPay)
    : null;
  const totals = {
    subtotal: money.toString(computed.subtotal),
    taxTotal: money.toString(computed.taxTotal),
    surchargeTotal: money.toString(computed.surchargeTotal),
    withholdingTotal: money.toString(computed.withholdingTotal),
    total: money.toString(computed.totalToPay),
  };
  if (dryRun) {
    const live = await findLiveTaxId(tx, parsed.customer.taxId);
    return {
      id: null,
      replayed: false,
      customerCreated: false,
      stripeInvoiceId,
      dryRun: true,
      customerExists: live != null,
      number: parsed.number,
      seriesId: series?.id ?? null,
      invoiceType: parsed.invoiceType,
      currency: 'EUR',
      totals,
      warnings: previewWarnings(parsed, body.livemode),
    };
  }
  const customer = await resolveCustomer(tx, parsed.customer, actor, now);

  const id = newId();
  const mentions = mentionsOf(parsed, computed.taxes.map((tax) => tax.taxCode));
  const notes = composeNotes(parsed);
  const snapshot = customerSnapshot(customer.stored, parsed.customer.address, customer.stored.idOtroType, parsed.customer.email);
  const legacy = {
    source: 'stripe_import',
    stripe: stripeInvoiceId,
    original_number: parsed.number,
    verifactu: 'not_applicable',
    series_code: parsed.seriesCode ?? '',
    ...(original ? { rectifies_stripe: original.stripeId } : {}),
  };

  tx.write(sql`
    INSERT INTO billing.invoice (
      id, legal_entity_id, series_id, number, status, invoice_type, rectification_kind,
      issue_date, operation_date, customer_id, customer_snapshot, currency, language,
      description, legal_mentions, notes, subtotal, tax_total, surcharge_total, withholding_total,
      total, amount_paid, payment_status, payment_method, payment_terms_days,
      issued_by, issued_at, legacy_refs, created_by, created_at, updated_at, origin
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${entity.id} AS UUID),
      CAST(${series?.id ?? null} AS UUID),
      ${parsed.number},
      'issued',
      ${parsed.invoiceType},
      ${parsed.invoiceType === 'R1' ? 'I' : null},
      CAST(${parsed.issueDate} AS DATE),
      CAST(${parsed.issueDate} AS DATE),
      CAST(${customer.id} AS UUID),
      ${sql.json(snapshot)},
      'EUR',
      ${parsed.language},
      ${parsed.description},
      ${mentions},
      ${notes},
      ${decimalOf(totals.subtotal)},
      ${decimalOf(totals.taxTotal)},
      ${decimalOf(totals.surchargeTotal)},
      ${decimalOf(totals.withholdingTotal)},
      ${decimalOf(totals.total)},
      ${decimalOf(parsed.payment.amountPaid)},
      ${parsed.payment.status},
      ${parsed.payment.method},
      ${parsed.paymentTermsDays},
      CAST(${actor.id} AS UUID),
      ${instantOf(parsed.issueDate)},
      ${sql.json(legacy)},
      ${actor.id},
      ${now},
      ${now},
      'stripe_import'
    )
  `);
  parsed.lines.forEach((line, index) => {
    const computedLine = computed.lines[index];
    if (!computedLine) return;
    tx.write(sql`
      INSERT INTO billing.invoice_line (
        id, invoice_id, line_no, sku, description, quantity, unit, unit_price, discount_pct, line_base, tax_code
      ) VALUES (
        CAST(${newId()} AS UUID),
        CAST(${id} AS UUID),
        ${index + 1},
        ${line.sku},
        ${line.description},
        ${line.quantity},
        ${line.unit},
        ${line.unitPrice},
        ${line.discountPct},
        ${computedLine.lineBase},
        ${line.taxCode}
      )
    `);
  });
  for (const tax of computed.taxes) {
    tx.write(sql`
      INSERT INTO billing.invoice_tax (
        id, invoice_id, tax_code, tax, regime_key, qualification, exemption, rate, base, quota,
        surcharge_rate, surcharge_quota, withholding_rate, withholding
      ) VALUES (
        CAST(${newId()} AS UUID),
        CAST(${id} AS UUID),
        ${tax.taxCode.code},
        ${tax.taxCode.tax},
        ${tax.taxCode.regimeKey},
        ${tax.taxCode.qualification},
        ${tax.taxCode.exemption},
        ${tax.rate},
        ${tax.base},
        ${tax.quota},
        ${tax.surchargeRate},
        ${tax.surchargeQuota},
        ${tax.withholdingRate},
        ${tax.withholding}
      )
    `);
  }
  const due = computed.dues[0];
  if (due) {
    tx.write(sql`
      INSERT INTO billing.invoice_due (id, invoice_id, seq, due_date, amount)
      VALUES (
        CAST(${newId()} AS UUID),
        CAST(${id} AS UUID),
        1,
        CAST(${due.dueDate} AS DATE),
        ${due.amount}
      )
    `);
  }
  if (original) {
    tx.write(sql`
      INSERT INTO billing.invoice_rectification (
        id, rectifying_invoice_id, rectified_invoice_id, rectified_number, rectified_issue_date,
        rectified_issuer_tax_id, relation, reason
      ) VALUES (
        CAST(${newId()} AS UUID),
        CAST(${id} AS UUID),
        CAST(${original.id} AS UUID),
        ${original.number},
        CAST(${original.issueDate} AS DATE),
        ${entity.taxId},
        'rectified',
        ${parsed.reason ?? 'Abono íntegro de la factura de Stripe ya emitida'}
      )
    `);
  }
  tx.audit({
    table: 'billing.invoice',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: {
      origin: 'stripe_import',
      number: parsed.number,
      status: 'issued',
      stripe: stripeInvoiceId,
      total: totals.total,
      series_id: series?.id ?? null,
      verifactu_record_id: null,
    },
  });
  return {
    id,
    replayed: false,
    customerCreated: customer.created,
    stripeInvoiceId,
    dryRun: false,
    customerExists: true,
    number: parsed.number,
    seriesId: series?.id ?? null,
    invoiceType: parsed.invoiceType,
    currency: 'EUR',
    totals,
    warnings: [],
  };
}

function calculate(parsed: ParsedCreate, taxCodes: Map<string, TaxCode>) {
  const lines = parsed.lines.map((line) => {
    const taxCode = taxCodes.get(line.taxCode);
    if (!taxCode) throw domainError('WC_VALIDATION', { tax_code: `El tratamiento ${line.taxCode} no está activo` });
    return {
      qty: line.quantity,
      unitPrice: line.unitPrice,
      discountPct: line.discountPct,
      taxCode,
    };
  });
  try {
    return computeInvoice({
      lines,
      paymentTerms: { days: [parsed.paymentTermsDays] },
      issueDate: parsed.issueDate,
    });
  } catch (error) {
    if (error instanceof InvoiceCalculationError) {
      throw domainError('WC_VALIDATION', { lines: error.message });
    }
    throw error;
  }
}

function assertDeclared(parsed: ParsedCreate, computed: ReturnType<typeof computeInvoice>): void {
  const fields: Record<string, string> = {};
  const total = money.toString(computed.totalToPay);
  if (!computed.totalToPay.eq(parsed.declared.total)) {
    fields.total = `El total calculado (${total}) no coincide con el total de Stripe (${money.toString(parsed.declared.total)})`;
  }
  mismatch(fields, 'subtotal', parsed.declared.subtotal, computed.subtotal);
  mismatch(fields, 'tax_total', parsed.declared.taxTotal, computed.taxTotal);
  mismatch(fields, 'surcharge_total', parsed.declared.surchargeTotal, computed.surchargeTotal);
  mismatch(fields, 'withholding_total', parsed.declared.withholdingTotal, computed.withholdingTotal);
  if (parsed.invoiceType === 'F1' && !computed.totalToPay.gt(0)) {
    fields.total = 'La factura tiene que tener un total positivo. Un abono es una rectificativa R1';
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
}

function mismatch(
  fields: Record<string, string>,
  key: string,
  declared: ReturnType<typeof money.fromString> | null,
  computed: ReturnType<typeof money.fromString>,
): void {
  if (declared && !declared.eq(computed)) {
    fields[key] = `El calculado (${money.toString(computed)}) no coincide con Stripe (${money.toString(declared)})`;
  }
}

interface ExistingInvoice {
  id: string;
  legalEntityId: string;
  total: string;
  amountPaid: string;
  paymentStatus: string;
}

async function findImported(tx: Tx, stripeInvoiceId: string): Promise<ExistingInvoice | null> {
  const rows = await tx.read(sql`
    SELECT id, legal_entity_id, total, amount_paid, payment_status
    FROM billing.invoice
    WHERE origin = 'stripe_import'
      AND json_extract_string(legacy_refs, '$.stripe') = ${stripeInvoiceId}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const total = moneyText(row.total);
  if (!total) throw domainError('WC_VALIDATION', { stripe_invoice_id: 'La factura importada no tiene total' });
  return {
    id: idOf(row.id),
    legalEntityId: idOf(row.legal_entity_id),
    total,
    amountPaid: moneyText(row.amount_paid) ?? '0.00',
    paymentStatus: String(row.payment_status),
  };
}

async function applyPayment(tx: Tx, existing: ExistingInvoice, payment: PaymentResolved, now: Date): Promise<void> {
  if (existing.amountPaid === payment.amountPaid && existing.paymentStatus === payment.status) return;
  assertWc080('issued', {
    amount_paid: existing.amountPaid,
    payment_status: existing.paymentStatus,
  }, {
    amount_paid: payment.amountPaid,
    payment_status: payment.status,
    updated_at: now.toISOString(),
  });
  tx.write(sql`
    UPDATE billing.invoice
    SET amount_paid = ${decimalOf(payment.amountPaid)},
        payment_status = ${payment.status},
        updated_at = ${now}
    WHERE id = CAST(${existing.id} AS UUID)
      AND origin = 'stripe_import'
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: existing.id,
    action: 'UPDATE',
    before: { amount_paid: existing.amountPaid, payment_status: existing.paymentStatus },
    after: { amount_paid: payment.amountPaid, payment_status: payment.status },
  });
}

async function requireCvpo(tx: Tx, value: unknown, user: UserCtx) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw domainError('WC_VALIDATION', { entity: 'Indica la sociedad CVPO' });
  const entity = isUuid(raw)
    ? await loadEntity(tx, raw.toLowerCase())
    : await loadEntityByCode(tx, raw.toUpperCase());
  if (!entity || entity.code !== 'CVPO') {
    throw domainError('WC_VALIDATION', { entity: 'Solo se importan facturas de Stripe ya emitidas de CVPO' });
  }
  if (!can(user, 'billing.write', entity.id)) throw domainError('WC_FORBIDDEN');
  return entity;
}

async function requireOpenSeries(
  tx: Tx,
  entityId: string,
  code: string,
  docType: 'invoice' | 'credit_note' | 'simplified_invoice',
  issueYear: number,
): Promise<{ id: string }> {
  const rows = await tx.read(sql`
    SELECT id, verifactu, "year" AS series_year
    FROM core.number_series
    WHERE legal_entity_id = CAST(${entityId} AS UUID)
      AND code = ${code}
      AND doc_type = ${docType}
    ORDER BY "year" DESC
  `);
  if (rows.length === 0) {
    throw domainError('WC_VALIDATION', {
      series_code: `No hay una serie ${code} (${docType}) en CVPO. VV y VVR se crean a mano, sin Verifactu; mientras, omite series_code`,
    });
  }
  const sameYear = rows.find((candidate) => Number(candidate.series_year) === issueYear);
  const row = sameYear ?? (rows.length === 1 ? rows[0] : undefined);
  if (!row) {
    throw domainError('WC_VALIDATION', {
      series_code: `Hay varias series ${code} y ninguna es del año ${issueYear}. Crea la de ese año o usa una sola serie`,
    });
  }
  if (flag(row.verifactu)) {
    throw domainError('WC_VALIDATION', {
      series_code: 'Esa serie tiene Verifactu. Una factura de Stripe ya emitida no puede entrar en una serie que se envía a la AEAT',
    });
  }
  return { id: idOf(row.id) };
}

async function assertNumberFree(tx: Tx, entityId: string, number: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM billing.invoice
    WHERE legal_entity_id = CAST(${entityId} AS UUID)
      AND number = ${number}
    LIMIT 1
  `);
  if (rows[0]) {
    throw domainError('WC_VALIDATION', { number: 'Ya existe una factura con este número en CVPO' });
  }
}

interface Rectified {
  id: string;
  number: string;
  issueDate: string;
  stripeId: string;
}

async function requireRectified(
  tx: Tx,
  entityId: string,
  stripeId: string | null,
  creditStripeId: string,
  creditTotal: ReturnType<typeof money.fromString>,
): Promise<Rectified> {
  if (!stripeId) {
    throw domainError('WC_VALIDATION', { rectifies: 'La rectificativa tiene que indicar la factura de Stripe que abona' });
  }
  if (stripeId === creditStripeId) {
    throw domainError('WC_VALIDATION', { rectifies: 'Una factura no puede abonarse a sí misma' });
  }
  const rows = await tx.read(sql`
    SELECT id, number, issue_date, invoice_type, status, origin, total,
           json_extract_string(legacy_refs, '$.stripe') AS stripe_id
    FROM billing.invoice
    WHERE legal_entity_id = CAST(${entityId} AS UUID)
      AND json_extract_string(legacy_refs, '$.stripe') = ${stripeId}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row || text(row.origin) !== 'stripe_import' || String(row.invoice_type) !== 'F1' || String(row.status) !== 'issued') {
    throw domainError('WC_VALIDATION', {
      rectifies: 'La rectificativa solo puede abonar una factura importada de Stripe (origin stripe_import), emitida y no rectificativa',
    });
  }
  const originalTotal = decimalOf(moneyText(row.total) ?? '0');
  if (!creditTotal.eq(originalTotal.neg())) {
    throw domainError('WC_VALIDATION', {
      total: `El abono tiene que ser por el importe íntegro (${money.toString(originalTotal.neg())})`,
    });
  }
  const prior = await tx.read(sql`
    SELECT id FROM billing.invoice_rectification
    WHERE rectified_invoice_id = CAST(${idOf(row.id)} AS UUID)
    LIMIT 1
  `);
  if (prior[0]) {
    throw domainError('WC_VALIDATION', { rectifies: 'Esa factura de Stripe ya tiene una rectificativa por el importe íntegro' });
  }
  const issueDate = day(row.issue_date);
  const number = text(row.number);
  if (!issueDate || !number) throw domainError('WC_VALIDATION', { rectifies: 'La factura abonada no tiene número o fecha' });
  return { id: idOf(row.id), number, issueDate, stripeId };
}

interface StoredCustomer {
  legalName: string;
  taxId: string;
  taxIdType: string;
  taxIdCountry: string | null;
  countryCode: string;
  language: string;
  idOtroType: '02' | '03' | '04' | null;
}

async function resolveCustomer(
  tx: Tx,
  input: ParsedCustomer,
  actor: Actor,
  now: Date,
): Promise<{ id: string; created: boolean; stored: StoredCustomer }> {
  const live = await findLiveTaxId(tx, input.taxId);
  if (live) {
    const rows = await tx.read(sql`
      SELECT id, legal_name, is_customer, tax_id, tax_id_type, tax_id_country, country_code, language
      FROM party.contact
      WHERE id = CAST(${idOf(live.id)} AS UUID)
    `);
    const row = rows[0];
    if (!row) throw domainError('WC_VALIDATION', { tax_id: 'No se ha podido reutilizar el contacto' });
    const id = idOf(row.id);
    if (row.is_customer !== true) {
      tx.write(sql`
        UPDATE party.contact
        SET is_customer = TRUE, updated_at = ${now}
        WHERE id = CAST(${id} AS UUID)
      `);
      tx.audit({
        table: 'party.contact',
        rowId: id,
        action: 'UPDATE',
        before: { is_customer: false },
        after: { is_customer: true },
      });
    }
    const taxType = String(row.tax_id_type);
    return {
      id,
      created: false,
      stored: {
        legalName: String(row.legal_name),
        taxId: String(row.tax_id),
        taxIdType: taxType,
        taxIdCountry: text(row.tax_id_country),
        countryCode: String(row.country_code),
        language: String(row.language),
        idOtroType: idOtroOf(taxType),
      },
    };
  }

  const id = newId();
  const contact: ContactInput = {
    kind: input.kind,
    legal_name: input.legalName,
    tax_id: input.taxId,
    country_code: input.countryCode,
    language: input.language,
    is_customer: true,
    is_supplier: false,
    is_carrier: false,
    is_logistics_operator: false,
    vat_regime: 'general',
    payment_method: 'stripe',
    payment_terms_days: 30,
    notes: 'Alta al importar una factura de Stripe ya emitida.',
  };
  insertContact(tx, id, contact, {
    taxId: input.taxId,
    taxIdType: input.taxIdType,
    taxIdCountry: input.taxIdCountry,
    warning: null,
  }, actor.id, now);
  tx.write(sql`
    UPDATE party.contact
    SET legacy_refs = ${sql.json({ source: 'stripe_import' })}
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({
    table: 'party.contact',
    rowId: id,
    action: 'UPDATE',
    before: { legacy_refs: {} },
    after: { legacy_refs: { source: 'stripe_import' } },
  });
  if (input.address) insertAddress(tx, id, newId(), input.address, now);
  return {
    id,
    created: true,
    stored: {
      legalName: input.legalName,
      taxId: input.taxId,
      taxIdType: input.taxIdType,
      taxIdCountry: input.taxIdCountry,
      countryCode: input.countryCode,
      language: input.language,
      idOtroType: input.idOtroType,
    },
  };
}

function customerSnapshot(
  customer: StoredCustomer,
  address: AddressInput | null,
  idOtroType: '02' | '03' | '04' | null,
  email: string | null,
): Record<string, unknown> {
  return {
    legal_name: customer.legalName,
    name: customer.legalName,
    tax_id: customer.taxId,
    tax_id_type: customer.taxIdType,
    tax_id_country: customer.taxIdCountry,
    country: customer.countryCode,
    language: customer.language,
    source: 'stripe_import',
    ...(idOtroType ? { id_otro_type: idOtroType } : {}),
    ...(email ? { email } : {}),
    address: address ? {
      line1: address.line1,
      line2: address.line2 ?? null,
      postal_code: address.postal_code,
      city: address.city,
      province: address.province ?? null,
      country_code: address.country_code,
    } : null,
  };
}

function mentionsOf(parsed: ParsedCreate, taxes: TaxCode[]): string[] {
  const mentions = new Set<string>();
  for (const tax of taxes) {
    const mention = parsed.language === 'en' ? tax.legalMentionEn : tax.legalMentionEs;
    if (mention) mentions.add(mention);
  }
  if (parsed.lines.some((line) => line.taxCode === 'NS_LOC') && !EU.has(parsed.customer.countryCode)) {
    mentions.add(NS_LOC_MENTION);
  }
  return [...mentions];
}

function parseCreate(body: Record<string, unknown>, now: Date): ParsedCreate {
  requireEur(body.currency);
  const invoiceType = body.invoice_type == null || body.invoice_type === 'F1'
    ? 'F1'
    : body.invoice_type === 'R1'
      ? 'R1'
      : null;
  if (!invoiceType) {
    throw domainError('WC_VALIDATION', { invoice_type: 'Solo F1, o R1 para abonar una factura de Stripe' });
  }
  const rectifies = body.rectifies;
  let rectifiesStripeId: string | null = null;
  if (invoiceType === 'R1') {
    const ref = record(rectifies, 'rectifies');
    rectifiesStripeId = stripeId(ref.stripe_invoice_id, 'rectifies.stripe_invoice_id');
  } else if (rectifies != null) {
    throw domainError('WC_VALIDATION', { rectifies: 'Una factura completa no referencia otra factura' });
  }
  const lines = parseLines(body.lines);
  const customer = parseCustomer(body.customer);
  if (lines.some((line) => line.taxCode === 'NS_LOC') && customer.countryCode === 'ES') {
    throw domainError('WC_VALIDATION', {
      tax_code: 'NS_LOC (art. 69 LIVA) no vale para un cliente de España. Sí vale para otro país de la UE o de fuera',
    });
  }
  const paymentTermsDays = body.payment_terms_days == null ? 0 : intIn(body.payment_terms_days, 'payment_terms_days', 0, 180);
  return {
    number: invoiceNumber(body.number),
    issueDate: issueDateOf(body.issue_date, now),
    seriesCode: optionalSeries(body.series_code),
    description: clip(optionalText(body.description, 'description', 500) ?? 'Servicios Vinoveo', 500),
    notes: optionalText(body.notes, 'notes', 2000),
    language: body.language == null || body.language === 'es' ? 'es' : body.language === 'en' ? 'en' : fail('language', 'Idioma es o en'),
    paymentTermsDays,
    lines,
    declared: {
      total: parseAmount(body.total, 'total', 2),
      subtotal: body.subtotal == null ? null : parseAmount(body.subtotal, 'subtotal', 2),
      taxTotal: body.tax_total == null ? null : parseAmount(body.tax_total, 'tax_total', 2),
      surchargeTotal: body.surcharge_total == null ? null : parseAmount(body.surcharge_total, 'surcharge_total', 2),
      withholdingTotal: body.withholding_total == null ? null : parseAmount(body.withholding_total, 'withholding_total', 2),
    },
    payment: resolvePayment(parseAmount(body.total, 'total', 2), body.payment == null ? {} : paymentRecord(body.payment)),
    invoiceType,
    rectifiesStripeId,
    reason: optionalText(body.reason, 'reason', 2000),
    customer,
  };
}

function parseLines(value: unknown): ParsedLine[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw domainError('WC_VALIDATION', { lines: 'La factura necesita al menos una línea' });
  }
  if (value.length > 100) throw domainError('WC_VALIDATION', { lines: 'Hay demasiadas líneas' });
  return value.map((item, index) => {
    const line = record(item, `lines[${index}]`);
    const field = (name: string) => `lines[${index}].${name}`;
    const taxCode = typeof line.tax_code === 'string' ? line.tax_code.trim() : '';
    if (!ALLOWED_TAX.has(taxCode)) {
      throw domainError('WC_VALIDATION', { [field('tax_code')]: 'Usa IVA21 o NS_LOC (no sujeta, art. 69 LIVA)' });
    }
    const description = optionalText(line.description, field('description'), 250);
    if (!description) throw domainError('WC_VALIDATION', { [field('description')]: 'Indica el concepto' });
    return {
      description,
      quantity: parseAmount(line.quantity, field('quantity'), 3),
      unitPrice: parseAmount(line.unit_price, field('unit_price'), 6),
      discountPct: line.discount_pct == null ? money.fromString('0') : parseAmount(line.discount_pct, field('discount_pct'), 2),
      unit: optionalText(line.unit, field('unit'), 20) ?? 'ud',
      taxCode,
      sku: optionalText(line.sku, field('sku'), 80),
    };
  });
}

function parseCustomer(value: unknown): ParsedCustomer {
  const customer = record(value, 'customer');
  const legalName = optionalText(customer.legal_name, 'customer.legal_name', 120);
  if (!legalName) throw domainError('WC_VALIDATION', { 'customer.legal_name': 'Indica la razón social' });
  if (customer.country_code == null || customer.country_code === '') {
    throw domainError('WC_VALIDATION', {
      'customer.country_code': 'Indica el país. Sin él, un identificador extranjero se trataría como NIF español',
    });
  }
  const countryCode = country(customer.country_code, 'customer.country_code');
  const taxRaw = typeof customer.tax_id === 'string' ? customer.tax_id.trim() : '';
  if (!taxRaw) throw domainError('WC_VALIDATION', { 'customer.tax_id': 'Indica el NIF o el identificador fiscal' });
  const tax = classifyTax(taxRaw, countryCode);
  const kind = customer.kind == null || customer.kind === 'company'
    ? 'company'
    : customer.kind === 'person'
      ? 'person'
      : fail('customer.kind', 'company o person');
  const language = customer.language == null
    ? (countryCode === 'ES' ? 'es' : 'en')
    : customer.language === 'es' || customer.language === 'en'
      ? customer.language
      : fail('customer.language', 'Idioma es o en');
  return {
    legalName,
    taxId: tax.taxId,
    taxIdType: tax.taxIdType,
    taxIdCountry: tax.taxIdCountry,
    countryCode,
    idOtroType: tax.idOtroType,
    kind,
    language,
    email: optionalText(customer.email, 'customer.email', 200),
    address: parseAddress(customer.address, countryCode),
  };
}

/**
 * Fuera de la UE el identificador es IDOtro tipo 04, aunque parezca un NIF
 * (un RUT chileno de 8 cifras y dígito K tiene la misma forma). Dentro, se
 * usa la clasificación normal: NIF/NIE o NIF-IVA (IDOtro 02).
 */
function classifyTax(raw: string, countryCode: string): {
  taxId: string;
  taxIdType: TaxIdType;
  taxIdCountry: string;
  idOtroType: '02' | '03' | '04' | null;
} {
  if (!EU.has(countryCode)) {
    const cleaned = raw.toUpperCase().replace(SEPARATORS, '');
    if (!/^[A-Z0-9]{2,20}$/.test(cleaned)) {
      throw domainError('WC_VALIDATION', { 'customer.tax_id': 'El identificador fiscal no se puede almacenar' });
    }
    return { taxId: cleaned, taxIdType: 'foreign_id', taxIdCountry: countryCode, idOtroType: '04' };
  }
  const result = normalizeTaxId(raw, countryCode);
  if (!result.valid || !result.normalized || result.type === 'none') {
    throw domainError('WC_VALIDATION', {
      'customer.tax_id': result.warning ?? 'El NIF o el NIF-IVA no es válido',
    });
  }
  return {
    taxId: result.normalized,
    taxIdType: result.type,
    taxIdCountry: result.country ?? countryCode,
    idOtroType: idOtroOf(result.type),
  };
}

function idOtroOf(type: string): '02' | '03' | '04' | null {
  if (type === 'vat_eu') return '02';
  if (type === 'passport') return '03';
  if (type === 'foreign_id') return '04';
  return null;
}

function parseAddress(value: unknown, fallbackCountry: string): AddressInput | null {
  if (value == null) return null;
  const address = record(value, 'customer.address');
  const line1 = optionalText(address.line1, 'customer.address.line1', 160);
  const postal = optionalText(address.postal_code, 'customer.address.postal_code', 20);
  const city = optionalText(address.city, 'customer.address.city', 80);
  if (!line1 || !postal || !city) {
    throw domainError('WC_VALIDATION', { 'customer.address': 'Indica dirección, código postal y población' });
  }
  return {
    kind: 'billing',
    line1,
    line2: optionalText(address.line2, 'customer.address.line2', 160),
    postal_code: postal,
    city,
    province: optionalText(address.province, 'customer.address.province', 80),
    country_code: address.country_code == null ? fallbackCountry : country(address.country_code, 'customer.address.country_code'),
    is_default: true,
  };
}

function resolvePayment(
  total: ReturnType<typeof money.fromString>,
  raw: Record<string, unknown>,
): PaymentResolved {
  const method = raw.method == null ? 'stripe' : paymentMethod(raw.method);
  const status = raw.status == null ? null : paymentStatus(raw.status);
  const amount = raw.amount_paid == null && raw.amount == null
    ? null
    : parseAmount(raw.amount_paid ?? raw.amount, 'payment.amount_paid', 2);
  if (total.isNeg()) {
    if (amount && !amount.isZero()) {
      throw domainError('WC_VALIDATION', { 'payment.amount_paid': 'Un abono no admite un cobro positivo' });
    }
    if (status === 'partially_paid') {
      throw domainError('WC_VALIDATION', { 'payment.status': 'Un abono no queda parcialmente cobrado' });
    }
    return { amountPaid: '0.00', status: status ?? 'unpaid', method };
  }
  if (total.isZero()) {
    throw domainError('WC_VALIDATION', { total: 'El total no puede ser cero' });
  }
  let paid = amount;
  let next = status;
  if (paid == null && next == null) {
    return { amountPaid: '0.00', status: 'unpaid', method };
  }
  if (paid == null) {
    if (next === 'paid') paid = total;
    else if (next === 'unpaid' || next === 'uncollectible') paid = money.fromString('0');
    else throw domainError('WC_VALIDATION', { 'payment.amount_paid': 'Indica el importe cobrado' });
  }
  if (paid.isNeg() || paid.gt(total)) {
    throw domainError('WC_VALIDATION', { 'payment.amount_paid': 'El cobro no puede superar el total ni ser negativo' });
  }
  if (next == null) {
    if (paid.isZero()) next = 'unpaid';
    else if (paid.eq(total)) next = 'paid';
    else next = 'partially_paid';
  }
  if (next === 'unpaid' && !paid.isZero()) {
    throw domainError('WC_VALIDATION', { 'payment.status': 'Un impago no puede llevar importe cobrado' });
  }
  if (next === 'paid' && !paid.eq(total)) {
    throw domainError('WC_VALIDATION', { 'payment.status': 'Cobrada exige el importe íntegro' });
  }
  if (next === 'partially_paid' && (paid.isZero() || paid.eq(total))) {
    throw domainError('WC_VALIDATION', { 'payment.status': 'El cobro parcial tiene que ser mayor que cero y menor que el total' });
  }
  if (next === 'uncollectible' && paid.eq(total)) {
    throw domainError('WC_VALIDATION', { 'payment.status': 'Un impago incobrable no puede estar cobrado del todo' });
  }
  return { amountPaid: money.toString(paid), status: next, method };
}

function stripeId(value: unknown, field = 'stripe_invoice_id'): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!STRIPE_ID.test(id)) {
    throw domainError('WC_VALIDATION', { [field]: 'Tiene que ser un id de factura (in_…) o de abono (cn_…) de Stripe' });
  }
  return id;
}

function invoiceNumber(value: unknown): string {
  const number = typeof value === 'string' ? value.trim() : '';
  if (!NUMBER.test(number)) {
    throw domainError('WC_VALIDATION', { number: 'El número de Stripe no es válido (hasta 60 caracteres)' });
  }
  return number;
}

function issueDateOf(value: unknown, now: Date): string {
  const day = typeof value === 'string' ? value.trim() : '';
  if (!isMadridCivilDate(day)) throw domainError('WC_VALIDATION', { issue_date: 'Fecha no válida' });
  if (day > businessDate(now)) throw domainError('WC_INV_DATE_FUTURE');
  return day;
}

function optionalSeries(value: unknown): string | null {
  if (value == null || value === '') return null;
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!SERIES_CODE.test(code)) throw domainError('WC_VALIDATION', { series_code: 'El código de serie tiene de 1 a 4 letras' });
  return code;
}

function paymentRecord(value: unknown): Record<string, unknown> {
  return record(value, 'payment');
}

function paymentMethod(value: unknown): string {
  if (typeof value === 'string' && PAYMENT_METHODS.has(value)) return value;
  throw domainError('WC_VALIDATION', { 'payment.method': 'Método de cobro no válido' });
}

function paymentStatus(value: unknown): string {
  if (typeof value === 'string' && PAYMENT_STATUSES.has(value)) return value;
  throw domainError('WC_VALIDATION', { 'payment.status': 'Estado de cobro no válido' });
}

function country(value: unknown, field: string): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!COUNTRY.test(code)) throw domainError('WC_VALIDATION', { [field]: 'Usa el código de país de dos letras' });
  return code;
}

function parseAmount(value: unknown, field: string, scale: number): ReturnType<typeof money.fromString> {
  if (typeof value === 'number') {
    throw domainError('WC_VALIDATION', {
      [field]: 'Envía el importe como texto con punto decimal (por ejemplo "121.00"), en euros y no en céntimos',
    });
  }
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw domainError('WC_VALIDATION', { [field]: 'Importe no válido' });
  const places = raw.includes('.') ? (raw.split('.')[1]?.length ?? 0) : 0;
  if (places > scale) throw domainError('WC_VALIDATION', { [field]: `Usa como máximo ${scale} decimales` });
  return money.fromString(raw);
}

function intIn(value: unknown, field: string, min: number, max: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(number) || number < min || number > max) {
    throw domainError('WC_VALIDATION', { [field]: `Tiene que estar entre ${min} y ${max}` });
  }
  return number;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Tiene que ser texto' });
  const trimmed = value.trim();
  if (trimmed.length > max) throw domainError('WC_VALIDATION', { [field]: `Máximo ${max} caracteres` });
  return trimmed.length === 0 ? null : trimmed;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function record(value: unknown, field = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'JSON no válido' });
  }
  return value as Record<string, unknown>;
}

function fail(field: string, message: string): never {
  throw domainError('WC_VALIDATION', { [field]: message });
}

function instantOf(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

function yearOf(day: string): number {
  return Number(day.slice(0, 4));
}

function requireEur(value: unknown): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw domainError('WC_VALIDATION', {
      currency: 'Indica la moneda. Solo se importan euros; una factura en CLP o USD no se guarda como EUR',
    });
  }
  if (value.trim().toUpperCase() !== 'EUR') {
    throw domainError('WC_VALIDATION', {
      currency: 'Solo se importan facturas en euros. No conviertas otra moneda en este alta',
    });
  }
}

function dryRunOf(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (value === true) return true;
  throw domainError('WC_VALIDATION', { dry_run: 'Tiene que ser verdadero o falso' });
}

function assertLiveMode(value: unknown): void {
  if (value == null || value === true) return;
  if (value === false) {
    throw domainError('WC_VALIDATION', { livemode: 'Las facturas de prueba de Stripe no se importan' });
  }
  throw domainError('WC_VALIDATION', { livemode: 'Tiene que ser verdadero o falso' });
}

function composeNotes(parsed: ParsedCreate): string {
  const outsideEu = parsed.lines.some((line) => line.taxCode === 'NS_LOC') && !EU.has(parsed.customer.countryCode);
  const tail = [HISTORICAL_NOTE, outsideEu ? NS_LOC_MENTION : null]
    .filter((part): part is string => part != null);
  const suffix = tail.join(' ');
  const room = parsed.notes ? 2000 - suffix.length - 1 : 0;
  const head = parsed.notes && room > 0 ? clip(parsed.notes, room) : null;
  return [head, suffix].filter((part): part is string => part != null && part !== '').join(' ');
}

function previewWarnings(parsed: ParsedCreate, livemode: unknown): string[] {
  const warnings: string[] = [];
  if (!parsed.customer.address) {
    warnings.push('Sin dirección el PDF no se puede componer.');
  }
  if (!parsed.seriesCode) {
    warnings.push('Sin series_code la factura no queda enlazada a VV ni a VVR.');
  }
  if (parsed.customer.countryCode === 'CL') {
    warnings.push('Cliente de Chile. La carga completa los excluye; esta simulación no ha grabado nada.');
  }
  if (livemode == null) {
    warnings.push('No has indicado livemode. Una factura de prueba de Stripe (livemode false) no se importa.');
  }
  return warnings;
}
