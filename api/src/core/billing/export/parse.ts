import { Decimal } from 'decimal.js';
import { domainError } from '../../errors';
import type { ExportInvoice, ExportLine, ExportParty } from './types';

const LANGUAGES = new Set(['es', 'en']);

export function parseExportInvoice(value: unknown): ExportInvoice {
  const fields: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('WC_VALIDATION', { body: 'La factura debe ser un objeto' });
  }
  const body = value as Record<string, unknown>;
  const destination = countryCode(body.destination_country);
  if (!destination) fields.destination_country = 'Debe ser un código de país de 2 letras';
  const language = body.language == null || body.language === '' ? 'es' : String(body.language);
  if (!LANGUAGES.has(language)) fields.language = 'Debe ser es o en';
  const currency = body.currency == null || body.currency === '' ? 'EUR' : String(body.currency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fields.currency = 'Debe ser un código de divisa de 3 letras';
  const tax = optionalCode(body.tax_treatment, fields, 'tax_treatment');
  const incoterm = optionalShort(body.incoterm, fields, 'incoterm', 3, 3);
  const packages = optionalInt(body.packages, fields, 'packages');
  const origin = body.origin_country == null || body.origin_country === ''
    ? null
    : countryCode(body.origin_country);
  if (body.origin_country != null && body.origin_country !== '' && !origin) {
    fields.origin_country = 'Debe ser un código de país de 2 letras';
  }
  const number = optionalText(body.number, fields, 'number', 60);
  const issueDate = optionalDate(body.issue_date, fields, 'issue_date');
  const entity = parseParty(body.entity, 'entity', fields);
  const customer = parseParty(body.customer, 'customer', fields);
  const lines = parseLines(body.lines, fields);
  const sscc = parseSscc(body.sscc, fields);
  if (Object.keys(fields).length > 0 || !destination || !entity || !customer || !lines || !sscc) {
    throw domainError('WC_VALIDATION', fields);
  }
  return {
    destination_country: destination,
    language: language as 'es' | 'en',
    tax_treatment: tax,
    incoterm: incoterm ? incoterm.toUpperCase() : null,
    packages,
    origin_country: origin,
    currency,
    number,
    issue_date: issueDate,
    entity,
    customer,
    lines,
    sscc,
  };
}

function parseParty(
  value: unknown,
  path: string,
  fields: Record<string, string>,
): ExportParty | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fields[path] = 'Debe ser un objeto';
    return null;
  }
  const body = value as Record<string, unknown>;
  const legalName = optionalText(body.legal_name, fields, `${path}.legal_name`, 120);
  if (!legalName) fields[`${path}.legal_name`] = 'Debe tener entre 1 y 120 caracteres';
  const country = countryCode(body.country_code);
  if (!country) fields[`${path}.country_code`] = 'Debe ser un código de país de 2 letras';
  const taxId = optionalText(body.tax_id, fields, `${path}.tax_id`, 20);
  const eori = optionalText(body.eori, fields, `${path}.eori`, 32);
  if (!country || !legalName) return null;
  return {
    legal_name: legalName,
    tax_id: taxId,
    eori,
    address_line: optionalText(body.address_line, fields, `${path}.address_line`, 200),
    postal_code: optionalText(body.postal_code, fields, `${path}.postal_code`, 16),
    city: optionalText(body.city, fields, `${path}.city`, 80),
    province: optionalText(body.province, fields, `${path}.province`, 80),
    country_code: country,
  };
}

function parseLines(value: unknown, fields: Record<string, string>): ExportLine[] | null {
  if (!Array.isArray(value)) {
    fields.lines = 'Debe ser una lista';
    return null;
  }
  if (value.length > 200) {
    fields.lines = 'Hay demasiadas líneas';
    return null;
  }
  const lines: ExportLine[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseLine(value[index], `lines.${index}`, fields);
    if (!parsed) continue;
    if (seen.has(parsed.line_no)) fields[`lines.${index}.line_no`] = 'Número de línea repetido';
    seen.add(parsed.line_no);
    lines.push(parsed);
  }
  if (Object.keys(fields).some((key) => key === 'lines' || key.startsWith('lines.'))) return null;
  return lines.sort((left, right) => left.line_no - right.line_no);
}

function parseLine(value: unknown, path: string, fields: Record<string, string>): ExportLine | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fields[path] = 'Debe ser un objeto';
    return null;
  }
  const body = value as Record<string, unknown>;
  const lineNo = body.line_no;
  if (typeof lineNo !== 'number' || !Number.isInteger(lineNo) || lineNo < 1 || lineNo > 999) {
    fields[`${path}.line_no`] = 'Debe ser un entero entre 1 y 999';
  }
  const description = optionalText(body.description, fields, `${path}.description`, 250);
  if (!description) fields[`${path}.description`] = 'Debe tener entre 1 y 250 caracteres';
  const kind = body.kind === 'wine' || body.kind === 'other' ? body.kind : null;
  if (!kind) fields[`${path}.kind`] = 'Debe ser wine u other';
  const quantity = decimalText(body.quantity, fields, `${path}.quantity`);
  if (quantity && !new Decimal(quantity).gt(0)) fields[`${path}.quantity`] = 'Debe ser mayor que cero';
  const unit = body.unit == null || body.unit === '' ? 'ud' : optionalText(body.unit, fields, `${path}.unit`, 12);
  if (!unit) fields[`${path}.unit`] = 'Debe tener entre 1 y 12 caracteres';
  const unitPrice = optionalDecimal(body.unit_price, fields, `${path}.unit_price`);
  const discount = optionalDecimal(body.discount_pct, fields, `${path}.discount_pct`);
  if (discount && (new Decimal(discount).lt(0) || new Decimal(discount).gt(100))) {
    fields[`${path}.discount_pct`] = 'Debe estar entre 0 y 100';
  }
  const lineBase = optionalDecimal(body.line_base, fields, `${path}.line_base`);
  const nc = body.nc_code == null || body.nc_code === '' ? null : optionalText(body.nc_code, fields, `${path}.nc_code`, 8);
  const origin = body.origin_country == null || body.origin_country === ''
    ? null
    : countryCode(body.origin_country);
  if (body.origin_country != null && body.origin_country !== '' && !origin) {
    fields[`${path}.origin_country`] = 'Debe ser un código de país de 2 letras';
  }
  const net = optionalGrams(body.unit_net_weight_g, fields, `${path}.unit_net_weight_g`);
  const gross = optionalGrams(body.unit_gross_weight_g, fields, `${path}.unit_gross_weight_g`);
  const sku = optionalText(body.sku, fields, `${path}.sku`, 40);
  const lot = optionalText(body.lot_code, fields, `${path}.lot_code`, 40);
  if (
    typeof lineNo !== 'number'
    || !description
    || !kind
    || !quantity
    || !unit
    || fields[`${path}.quantity`]
    || fields[`${path}.discount_pct`]
  ) return null;
  return {
    line_no: lineNo,
    description,
    kind,
    quantity,
    unit,
    unit_price: unitPrice,
    discount_pct: discount,
    line_base: lineBase,
    nc_code: nc,
    origin_country: origin,
    unit_net_weight_g: net,
    unit_gross_weight_g: gross,
    sku,
    lot_code: lot,
  };
}

function parseSscc(value: unknown, fields: Record<string, string>): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    fields.sscc = 'Debe ser una lista';
    return null;
  }
  const out: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string' || !/^\d{18}$/.test(item)) {
      fields[`sscc.${index}`] = 'Debe tener 18 dígitos';
      continue;
    }
    out.push(item);
  }
  if (Object.keys(fields).some((key) => key.startsWith('sscc'))) return null;
  return out;
}

function countryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function optionalText(
  value: unknown,
  fields: Record<string, string>,
  path: string,
  max: number,
): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    fields[path] = 'Debe ser un texto';
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    fields[path] = `Debe tener entre 1 y ${max} caracteres`;
    return null;
  }
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    fields[path] = 'No puede contener saltos de línea';
    return null;
  }
  return trimmed;
}

function optionalCode(
  value: unknown,
  fields: Record<string, string>,
  path: string,
): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Z0-9_]{2,20}$/.test(value.trim())) {
    fields[path] = 'Código no válido';
    return null;
  }
  return value.trim();
}

function optionalShort(
  value: unknown,
  fields: Record<string, string>,
  path: string,
  min: number,
  max: number,
): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    fields[path] = 'Debe ser un texto';
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length < min || trimmed.length > max) {
    fields[path] = `Debe tener entre ${min} y ${max} caracteres`;
    return null;
  }
  return trimmed;
}

function optionalDate(value: unknown, fields: Record<string, string>, path: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fields[path] = 'Debe ser una fecha AAAA-MM-DD';
    return null;
  }
  return value;
}

function optionalInt(value: unknown, fields: Record<string, string>, path: string): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fields[path] = 'Debe ser un entero';
    return null;
  }
  return value;
}

function optionalDecimal(value: unknown, fields: Record<string, string>, path: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value.trim())) {
    fields[path] = 'Debe ser un decimal en texto';
    return null;
  }
  return value.trim();
}

function decimalText(value: unknown, fields: Record<string, string>, path: string): string | null {
  const parsed = optionalDecimal(value, fields, path);
  if (value == null || value === '') fields[path] = 'Debe ser un decimal en texto';
  return parsed;
}

function optionalGrams(value: unknown, fields: Record<string, string>, path: string): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fields[path] = 'Debe ser un entero de gramos mayor que cero';
    return null;
  }
  return value;
}
