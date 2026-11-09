import { decimalText, text } from './metrics';
import type { ReportBody } from './types';

export function companyOf(row: Record<string, unknown>): ReportBody['companies'] {
  const code = text(row.code);
  if (code !== 'PO' && code !== 'CVPO') return [];
  return [{
    code,
    amount: moneyText(row.amount),
    base: moneyText(row.base),
    tax: moneyText(row.tax),
    units: decimalText(row.units),
    volume_ml: decimalText(row.volume_ml),
  }];
}

function moneyText(value: unknown): string {
  const raw = decimalText(value, '0');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return '0.00';
  return parsed.toFixed(2);
}
