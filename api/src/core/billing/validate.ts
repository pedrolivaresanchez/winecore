import { computeInvoice, InvoiceCalculationError, type ComputedInvoice } from './compute';
import { decimalOf, seriesDocType, today } from './format';
import { issue, type IssueItem } from './issues';
import { money } from '../money';
import type { Tx } from '../db/writer';
import {
  differenceBalanceIssues,
  loadPriorDifferences,
  substitutionIssues,
  type RectTarget,
} from './rectify';
import {
  findDefaultSeries,
  lastIssuedDate,
  loadInvoice,
  loadTaxCodes,
  seriesFits,
  type InvoiceView,
  type LineView,
  type SeriesView,
} from './readModel';
import type { TaxCode } from './taxCodes';

export interface ValidationResult {
  errors: IssueItem[];
  warnings: IssueItem[];
  computed: ComputedInvoice | null;
  issueDate: string;
  series: SeriesView | null;
}

const NUMBERED: Record<string, string> = {
  invoice: 'factura',
  credit_note: 'rectificativa',
  simplified_invoice: 'factura simplificada',
};

const MILLION = decimalOf('1000000');
const MIN_ISSUE_DATE = '2024-10-28';

function holdedAmounts(view: InvoiceView, number: string, issueDate: string): {
  base: string | null;
  quota: string | null;
  surcharge: string | null;
} {
  const holded = view.header.legacyRefs.holded;
  if (!Array.isArray(holded)) return { base: null, quota: null, surcharge: null };
  for (const item of holded) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.number !== number || row.issue_date !== issueDate) continue;
    return {
      base: typeof row.base === 'string' ? row.base : null,
      quota: typeof row.quota === 'string' ? row.quota : null,
      surcharge: typeof row.surcharge === 'string' ? row.surcharge : null,
    };
  }
  return { base: null, quota: null, surcharge: null };
}

export async function validateInvoice(tx: Tx, invoiceId: string, now = new Date()): Promise<ValidationResult> {
  const loaded = await loadInvoice(tx, invoiceId);
  const view = { ...loaded, series: await issueSeries(tx, loaded, now) };
  const taxCodes = await loadTaxCodes(tx);
  const targets = await targetsOf(tx, view);
  const lastDate = view.series ? await lastIssuedDate(tx, view.series.id, view.header.id) : null;
  return validateView(view, taxCodes, targets, lastDate, now, tx);
}

/** La serie del borrador o, si no tiene, la de por defecto del año de emisión. */
async function issueSeries(tx: Tx, view: InvoiceView, now: Date): Promise<SeriesView | null> {
  if (view.header.seriesId) return view.series;
  const year = Number((view.header.issueDate ?? today(now)).slice(0, 4));
  if (!Number.isInteger(year)) return null;
  return findDefaultSeries(tx, view.header.legalEntityId, seriesDocType(view.header.invoiceType), year);
}

async function targetsOf(tx: Tx, view: InvoiceView): Promise<RectTarget[]> {
  if (!view.header.rectificationKind) return [];
  const targets: RectTarget[] = [];
  for (const row of view.rectifications) {
    if (!row.rectifiedInvoiceId) {
      const remembered = holdedAmounts(view, row.number, row.issueDate);
      targets.push({
        invoiceId: null,
        number: row.number,
        issueDate: row.issueDate,
        issuerTaxId: row.issuerTaxId,
        legalEntityId: null,
        subtotal: row.baseRectified ?? remembered.base,
        taxTotal: row.quotaRectified ?? remembered.quota,
        surchargeTotal: row.surchargeRectified ?? remembered.surcharge,
        total: null,
        status: null,
        taxes: [],
        legacyBase: row.baseRectified ?? remembered.base,
        legacyQuota: row.quotaRectified ?? remembered.quota,
        legacySurcharge: row.surchargeRectified ?? remembered.surcharge,
      });
      continue;
    }
    const original = await loadInvoice(tx, row.rectifiedInvoiceId);
    targets.push({
      invoiceId: original.header.id,
      number: original.header.number ?? row.number,
      issueDate: original.header.issueDate ?? row.issueDate,
      issuerTaxId: original.entity.taxId,
      legalEntityId: original.header.legalEntityId,
      subtotal: original.header.subtotal,
      taxTotal: original.header.taxTotal,
      surchargeTotal: original.header.surchargeTotal,
      total: original.header.total,
      status: original.header.status,
      taxes: original.taxes.map((tax) => ({ taxCode: tax.taxCode, base: tax.base })),
      legacyBase: null,
      legacyQuota: null,
      legacySurcharge: null,
    });
  }
  return targets;
}

export async function validateView(
  view: InvoiceView,
  taxCodes: Map<string, TaxCode>,
  targets: readonly RectTarget[],
  lastDate: string | null,
  now: Date,
  tx: Tx,
): Promise<ValidationResult> {
  const errors: IssueItem[] = [];
  const warnings: IssueItem[] = [];
  const header = view.header;
  const issueDate = header.issueDate ?? today(now);
  const customer = view.customer;

  if (view.lines.length === 0) {
    errors.push(issue('WC_INV_LINES_REQUIRED', 'La factura necesita al menos una línea', 'lines'));
  }

  const identified = customer != null && customer.taxId != null && customer.taxIdType !== 'none';
  if (header.invoiceType !== 'F2' && header.invoiceType !== 'R5' && !identified) {
    errors.push(issue(
      'WC_INV_TAX_ID_REQUIRED',
      'El cliente necesita NIF para una factura completa',
      'customer_id',
    ));
  }
  if (customer?.archived) {
    errors.push(issue('WC_VALIDATION', 'El cliente está archivado', 'customer_id'));
  }

  let needsVat = false;
  for (const line of view.lines) {
    const product = line.productId ? view.products.get(line.productId) : undefined;
    if ((product?.requiresLot || product?.kind === 'wine') && !line.lotId && !line.lotCode) {
      errors.push(issue(
        'WC_INV_LOT_REQUIRED',
        `Indica el lote de la línea ${line.lineNo}`,
        `lines.${line.lineNo}.lot`,
      ));
    }
    const tax = taxCodes.get(line.taxCode);
    if (!tax) {
      errors.push(issue('WC_VALIDATION', `El código de impuesto ${line.taxCode} no existe`, `lines.${line.lineNo}.tax_code`));
    } else if (tax.requiresVatId) {
      needsVat = true;
    }
  }
  if (needsVat && !customer?.vatValidatedAt) {
    errors.push(issue('WC_INV_VAT_ID_REQUIRED', 'Valida el NIF-IVA en VIES', 'customer_id'));
  }

  const computed = computeQuiet(view.lines, taxCodes, header.paymentTermsDays ?? customer?.paymentTermsDays ?? 0, issueDate, errors);

  if (computed) {
    if (computed.totalToPay.isZero()) {
      errors.push(issue('WC_INV_TOTAL_ZERO', 'El total de la factura no puede ser cero', 'total'));
    }
    if (computed.importeTotal.abs().gte(MILLION) || computed.totalToPay.abs().gte(MILLION)) {
      errors.push(issue('WC_INV_MACRO', 'La factura supera 1.000.000 € y queda bloqueada para revisión', 'total'));
    }
  }

  const year = Number(issueDate.slice(0, 4));
  const expectedType = seriesDocType(header.invoiceType);
  if (!view.series && !header.seriesId && Number.isInteger(year)) {
    errors.push({
      ...issue('WC_INV_NUMBERING', `Primera ${NUMBERED[expectedType] ?? 'factura'} de ${view.entity.code} en ${year}: elige la numeración`, 'series_id'),
      details: { legal_entity_id: header.legalEntityId, entity_code: view.entity.code, doc_type: expectedType, year },
    });
  } else if (!seriesFits(view.series, header.legalEntityId, expectedType, year)) {
    errors.push(issue('WC_INV_SERIES', 'No hay una serie activa para el año de la factura', 'series_id'));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    errors.push(issue('WC_VALIDATION', 'La fecha de emisión debe ser una fecha de calendario', 'issue_date'));
  } else {
    if (issueDate > today(now)) {
      errors.push(issue('WC_INV_DATE_FUTURE', 'La fecha de expedición no puede ser futura', 'issue_date'));
    }
    if (issueDate < MIN_ISSUE_DATE) {
      errors.push(issue('WC_INV_DATE_RANGE', 'La fecha de expedición no puede ser anterior al 28-10-2024', 'issue_date'));
    }
  }
  if (header.operationDate && header.operationDate > issueDate) {
    errors.push(issue(
      'WC_INV_OPERATION_DATE',
      'La fecha de operación no puede ser posterior a la de expedición',
      'operation_date',
    ));
  }
  if (lastDate && issueDate < lastDate) {
    errors.push(issue(
      'WC_INV_DATE_ORDER',
      'La fecha de emisión no puede ser anterior a la última factura de la serie',
      'issue_date',
    ));
  }

  if (header.invoiceType.startsWith('R')) {
    const reason = view.rectifications[0]?.reason ?? '';
    if (!header.rectificationKind || view.rectifications.length === 0 || reason.trim().length === 0) {
      errors.push(issue(
        'WC_INV_RECTIFICATION_REF',
        'La rectificativa debe referenciar la factura rectificada y el motivo',
        'rectifies',
      ));
    }
    for (const target of targets) {
      if (target.legalEntityId && target.legalEntityId !== header.legalEntityId) {
        errors.push(issue('WC_VALIDATION', 'La rectificativa se emite con la misma entidad que la factura original', 'legal_entity_id'));
      }
      if (!target.invoiceId && target.issuerTaxId !== view.entity.taxId) {
        errors.push(issue('WC_VALIDATION', 'El NIF de la factura de Holded no es el de la entidad que rectifica', 'rectifies'));
      }
      if (target.status && target.status !== 'issued') {
        errors.push(issue('WC_VALIDATION', 'Solo se rectifica una factura emitida', 'rectifies'));
      }
    }
    if (header.rectificationKind === 'S') errors.push(...substitutionIssues(targets));
    if (header.rectificationKind === 'I' && computed) {
      const currentTaxes = computed.taxes.map((tax) => ({ taxCode: tax.taxCode.code, base: money.toString(tax.base) }));
      const currentTotal = money.toString(computed.totalToPay);
      for (const target of targets) {
        if (!target.invoiceId && target.legacyBase == null) {
          warnings.push(issue(
            'WC_VALIDATION',
            'No se ha comprobado el acumulado de la factura de Holded porque no viene su base',
            'legacy.base',
          ));
          continue;
        }
        const prior = target.invoiceId ? await loadPriorDifferences(tx, target.invoiceId, header.id) : [];
        errors.push(...differenceBalanceIssues(target, prior, currentTaxes, currentTotal));
      }
    }
  }

  return { errors, warnings, computed, issueDate, series: view.series };
}

function computeQuiet(
  lines: readonly LineView[],
  taxCodes: Map<string, TaxCode>,
  paymentDays: number,
  issueDate: string,
  errors: IssueItem[],
): ComputedInvoice | null {
  if (lines.length === 0) return null;
  const prepared = [];
  for (const line of lines) {
    const tax = taxCodes.get(line.taxCode);
    if (!tax) return null;
    prepared.push({
      qty: decimalOf(line.quantity),
      unitPrice: decimalOf(line.unitPrice),
      discountPct: decimalOf(line.discountPct),
      taxCode: tax,
    });
  }
  try {
    return computeInvoice({
      lines: prepared,
      paymentTerms: { days: [paymentDays] },
      issueDate,
    });
  } catch (error) {
    if (error instanceof InvoiceCalculationError) {
      errors.push(issue(error.code, error.message, 'lines'));
      return null;
    }
    throw error;
  }
}
