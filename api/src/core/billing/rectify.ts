import { Decimal } from 'decimal.js';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { money } from '../money';
import { day, decimalOf, fixed, idOf, isUuid, moneyText, pick, text } from './format';
import { issue, type IssueItem } from './issues';

export interface LegacyRef {
  issuerTaxId: string;
  number: string;
  issueDate: string;
  base: string | null;
  quota: string | null;
  surcharge: string | null;
}

export interface RectSource {
  invoiceId: string | null;
  legacy: LegacyRef | null;
}

export interface RectTarget {
  invoiceId: string | null;
  number: string;
  issueDate: string;
  issuerTaxId: string;
  legalEntityId: string | null;
  subtotal: string | null;
  taxTotal: string | null;
  surchargeTotal: string | null;
  total: string | null;
  status: string | null;
  taxes: { taxCode: string; base: string }[];
  legacyBase: string | null;
  legacyQuota: string | null;
  legacySurcharge: string | null;
}

export interface RectRow {
  rectifiedInvoiceId: string | null;
  number: string;
  issueDate: string;
  issuerTaxId: string;
  baseRectified: string | null;
  quotaRectified: string | null;
  surchargeRectified: string | null;
  reason: string;
}

const INVOICE_TYPES = new Set(['R1', 'R2', 'R3', 'R4']);

export function isRectificationType(value: string): boolean {
  return INVOICE_TYPES.has(value);
}

export function parseRectSources(value: unknown): RectSource[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw domainError('WC_INV_RECTIFICATION_REF', { rectifies: 'Indica la factura rectificada' });
  }
  return value.map((item, index) => parseOne(item, index));
}

function parseOne(value: unknown, index: number): RectSource {
  const field = `rectifies.${index}`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Referencia no válida' });
  }
  const body = value as Record<string, unknown>;
  const invoiceId = pick(body, 'invoice_id', 'invoiceId');
  const legacy = pick(body, 'legacy', 'legacy_ref');
  if (typeof invoiceId === 'string' && legacy == null) {
    if (!isUuid(invoiceId)) throw domainError('WC_VALIDATION', { [field]: 'Identificador no válido' });
    return { invoiceId: invoiceId.toLowerCase(), legacy: null };
  }
  const legacyBody = legacy && typeof legacy === 'object' && !Array.isArray(legacy)
    ? legacy as Record<string, unknown>
    : null;
  if (!legacyBody) throw domainError('WC_VALIDATION', { [field]: 'Indica invoice_id o la referencia de Holded' });
  const issuer = text(pick(legacyBody, 'issuer_tax_id', 'issuerTaxId'));
  const number = text(pick(legacyBody, 'number'));
  const issueDate = day(pick(legacyBody, 'issue_date', 'issueDate'));
  if (!issuer || issuer.length > 20) {
    throw domainError('WC_VALIDATION', { [field]: 'El NIF del emisor de Holded es obligatorio' });
  }
  if (!number || number.length > 60) {
    throw domainError('WC_VALIDATION', { [field]: 'El número de la factura de Holded es obligatorio' });
  }
  if (!issueDate) throw domainError('WC_VALIDATION', { [field]: 'La fecha de la factura de Holded es obligatoria' });
  return {
    invoiceId: null,
    legacy: {
      issuerTaxId: issuer.toUpperCase(),
      number,
      issueDate,
      base: optionalAmount(pick(legacyBody, 'base'), field),
      quota: optionalAmount(pick(legacyBody, 'quota'), field),
      surcharge: optionalAmount(pick(legacyBody, 'surcharge'), field),
    },
  };
}

function optionalAmount(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  try {
    return fixed(value, 2);
  } catch {
    throw domainError('WC_VALIDATION', { [field]: 'Importe de la factura de Holded no válido' });
  }
}

export async function loadTargets(tx: Tx, sources: readonly RectSource[]): Promise<RectTarget[]> {
  const targets: RectTarget[] = [];
  for (const source of sources) {
    if (source.legacy) {
      targets.push({
        invoiceId: null,
        number: source.legacy.number,
        issueDate: source.legacy.issueDate,
        issuerTaxId: source.legacy.issuerTaxId,
        legalEntityId: null,
        subtotal: source.legacy.base,
        taxTotal: source.legacy.quota,
        surchargeTotal: source.legacy.surcharge,
        total: null,
        status: null,
        taxes: [],
        legacyBase: source.legacy.base,
        legacyQuota: source.legacy.quota,
        legacySurcharge: source.legacy.surcharge,
      });
      continue;
    }
    const invoiceId = source.invoiceId;
    if (!invoiceId) throw domainError('WC_INV_RECTIFICATION_REF');
    const rows = await tx.read(sql`
      SELECT i.id, i.number, i.issue_date, i.status, i.legal_entity_id, i.subtotal, i.tax_total,
             i.surcharge_total, i.total, e.tax_id
      FROM billing.invoice i
      JOIN core.legal_entity e ON e.id = i.legal_entity_id
      WHERE i.id = CAST(${invoiceId} AS UUID)
    `);
    const row = rows[0];
    if (!row) throw domainError('WC_NOT_FOUND');
    if (String(row.status) !== 'issued') {
      throw domainError('WC_VALIDATION', { rectifies: 'Solo se rectifica una factura emitida' });
    }
    const number = text(row.number);
    const issueDate = day(row.issue_date);
    if (!number || !issueDate) throw domainError('WC_VALIDATION', { rectifies: 'La factura original no tiene número' });
    const taxes = await tx.read<{ tax_code: unknown; base: unknown }>(sql`
      SELECT tax_code, base FROM billing.invoice_tax WHERE invoice_id = CAST(${invoiceId} AS UUID)
    `);
    targets.push({
      invoiceId,
      number,
      issueDate,
      issuerTaxId: String(row.tax_id).toUpperCase(),
      legalEntityId: idOf(row.legal_entity_id),
      subtotal: moneyText(row.subtotal),
      taxTotal: moneyText(row.tax_total),
      surchargeTotal: moneyText(row.surcharge_total),
      total: moneyText(row.total),
      status: 'issued',
      taxes: taxes.map((tax) => ({ taxCode: String(tax.tax_code), base: fixed(tax.base, 2) })),
      legacyBase: null,
      legacyQuota: null,
      legacySurcharge: null,
    });
  }
  return targets;
}

export function rectificationRows(kind: 'S' | 'I', reason: string, targets: readonly RectTarget[]): RectRow[] {
  return targets.map((target) => ({
    rectifiedInvoiceId: target.invoiceId,
    number: target.number,
    issueDate: target.issueDate,
    issuerTaxId: target.issuerTaxId,
    baseRectified: kind === 'S' ? target.subtotal : null,
    quotaRectified: kind === 'S' ? target.taxTotal : null,
    surchargeRectified: kind === 'S' ? target.surchargeTotal : null,
    reason,
  }));
}

export interface PriorDifference {
  subtotal: string;
  total: string;
  taxes: { taxCode: string; base: string }[];
}

export async function loadPriorDifferences(
  tx: Tx,
  originalId: string,
  exceptInvoiceId: string | null,
): Promise<PriorDifference[]> {
  const rows = await tx.read<{ id: unknown; subtotal: unknown; total: unknown }>(sql`
    SELECT i.id, i.subtotal, i.total
    FROM billing.invoice_rectification r
    JOIN billing.invoice i ON i.id = r.rectifying_invoice_id
    WHERE r.rectified_invoice_id = CAST(${originalId} AS UUID)
      AND i.rectification_kind = 'I'
      AND i.status = 'issued'
      AND (${exceptInvoiceId} IS NULL OR i.id <> CAST(${exceptInvoiceId} AS UUID))
  `);
  const prior: PriorDifference[] = [];
  for (const row of rows) {
    const id = idOf(row.id);
    const taxes = await tx.read<{ tax_code: unknown; base: unknown }>(sql`
      SELECT tax_code, base FROM billing.invoice_tax WHERE invoice_id = CAST(${id} AS UUID)
    `);
    prior.push({
      subtotal: fixed(row.subtotal, 2),
      total: fixed(row.total, 2),
      taxes: taxes.map((tax) => ({ taxCode: String(tax.tax_code), base: fixed(tax.base, 2) })),
    });
  }
  return prior;
}

export function differenceBalanceIssues(
  target: RectTarget,
  prior: readonly PriorDifference[],
  currentTaxes: readonly { taxCode: string; base: string }[],
  currentTotal: string,
): IssueItem[] {
  const issues: IssueItem[] = [];
  const bases = new Map<string, Decimal>();
  const add = (code: string, amount: string) => {
    bases.set(code, money.add(bases.get(code) ?? decimalOf('0'), decimalOf(amount)));
  };
  if (target.invoiceId) {
    for (const tax of target.taxes) add(tax.taxCode, tax.base);
  } else if (target.legacyBase != null) {
    add('legacy', target.legacyBase);
  }
  for (const item of prior) {
    for (const tax of item.taxes) add(tax.taxCode, tax.base);
  }
  for (const tax of currentTaxes) add(tax.taxCode, tax.base);
  if (target.invoiceId || target.legacyBase != null) {
    for (const [code, amount] of bases) {
      if (amount.isNeg()) {
        issues.push(issue(
          'WC_INV_NEGATIVE_BALANCE',
          'La rectificativa por diferencias dejaría la factura original en negativo',
          `tax.${code}`,
        ));
        break;
      }
    }
    const originalTotal = target.total ?? target.legacyBase;
    if (originalTotal != null) {
      let accumulated = decimalOf(originalTotal);
      for (const item of prior) accumulated = money.add(accumulated, decimalOf(item.total));
      accumulated = money.add(accumulated, decimalOf(currentTotal));
      if (accumulated.isNeg()) {
        issues.push(issue(
          'WC_INV_NEGATIVE_BALANCE',
          'La rectificativa por diferencias dejaría la factura original en negativo',
          'total',
        ));
      }
    }
  }
  return issues;
}

export function substitutionIssues(targets: readonly RectTarget[]): IssueItem[] {
  const issues: IssueItem[] = [];
  for (const target of targets) {
    if (target.invoiceId) continue;
    if (target.legacyBase == null || target.legacyQuota == null || target.legacySurcharge == null) {
      issues.push(issue(
        'WC_VALIDATION',
        'Indica la base, la cuota y el recargo de la factura de Holded',
        'legacy',
      ));
    }
  }
  return issues;
}
