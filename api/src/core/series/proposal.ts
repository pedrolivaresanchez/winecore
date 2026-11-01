import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { ensureSeriesForYear, isDocType, type DocType } from './numbering';
import { MAX_PADDING, MIN_PADDING, PLAN_PADDING, SERIES_PLAN, planPrefix } from './plan';
import { derivePrefix, formatSeriesNumber, seriesPrefixError } from './prefix';

type Read = Pick<Tx, 'read'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Código de la serie que sigue la numeración de Holded; el del plan (FA) queda para la nueva. */
export const HOLDED_CODE = 'FH';
export const HOLDED_CREDIT_CODE = 'RH';

export type NumberingOption = {
  code: string;
  prefix: string;
  padding: number;
  next_value: number;
  verifactu: boolean;
  first_number: string;
  limit_number: string;
};

export type HoldedHint = NumberingOption & {
  last_number: string;
  last_date: string;
  last_year: number;
  count: number;
};

export type NumberingProposal = {
  legal_entity_id: string;
  entity_code: string;
  doc_type: DocType;
  year: number;
  active: { id: string; prefix: string; next_number: string } | null;
  fresh: NumberingOption;
  holded: HoldedHint | null;
};

export type NumberingChoice = 'fresh' | 'holded';

export type NumberingInput = { legalEntityId: string; docType: string; year: number };

function option(code: string, prefix: string, padding: number, next: number, verifactu: boolean): NumberingOption {
  return {
    code,
    prefix,
    padding,
    next_value: next,
    verifactu,
    first_number: formatSeriesNumber(prefix, padding, next),
    limit_number: formatSeriesNumber(prefix, padding, 10 ** padding - 1),
  };
}

function validInput(input: NumberingInput): { legalEntityId: string; docType: DocType; year: number } {
  const fields: Record<string, string> = {};
  const legalEntityId = input.legalEntityId.trim().toLowerCase();
  if (!UUID.test(legalEntityId)) fields.legal_entity_id = 'Identificador no válido';
  if (!isDocType(input.docType)) fields.doc_type = 'Tipo de documento no válido';
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) fields.year = 'El año debe estar entre 2020 y 2100';
  if (Object.keys(fields).length > 0 || !isDocType(input.docType)) throw domainError('WC_VALIDATION', fields);
  return { legalEntityId, docType: input.docType, year: input.year };
}

type HoldedRow = {
  number: string;
  date: string;
  year: number;
  prefix: string;
  digits: string;
  value: number;
  invoice: boolean;
};

/**
 * Holded numera `F260086`: letras, año de dos cifras y un contador que vuelve a 1 cada año.
 * Se lee así (prefijo `F26`, contador `0086`) cuando las dos cifras son las del año de la factura;
 * el resto de formatos (`F-2026-34`, `1`, `99`) se leen como prefijo y contador finales.
 */
function splitNumber(number: string, year: number): { prefix: string; digits: string } | null {
  const dated = /^([A-Za-z]{1,4})(\d{2})(\d{3,})$/.exec(number);
  if (dated && Number(dated[2]) === year % 100) {
    return { prefix: `${dated[1] ?? ''}${dated[2] ?? ''}`, digits: dated[3] ?? '' };
  }
  const plain = /^(.*?)(\d{1,15})$/.exec(number);
  if (!plain) return null;
  return { prefix: plain[1] ?? '', digits: plain[2] ?? '' };
}

function holdedRows(rows: { number: unknown; issue_date: unknown; total: unknown }[]): HoldedRow[] {
  const parsed: HoldedRow[] = [];
  for (const row of rows) {
    const number = String(row.number);
    const date = row.issue_date instanceof Date ? row.issue_date.toISOString().slice(0, 10) : String(row.issue_date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const year = Number(date.slice(0, 4));
    const split = splitNumber(number, year);
    if (!split) continue;
    const invoice = Number(row.total) >= 0;
    parsed.push({ number, date, year, prefix: split.prefix, digits: split.digits, value: Number(split.digits), invoice });
  }
  return parsed;
}

function lastDate(rows: readonly HoldedRow[]): string {
  return rows.reduce((max, row) => (row.date > max ? row.date : max), '');
}

/**
 * La última numeración de venta de Holded de la entidad hasta `year`. Las facturas siguen la de
 * las facturas; las rectificativas (total negativo) siguen la suya, que es otra (`CN260008`),
 * y las facturas con total negativo en su serie solo cuentan para el último número.
 * Del mismo año se sigue desde el último número; de un año anterior se cambia el año del
 * prefijo y se empieza en 1, salvo que el prefijo no lleve año: entonces el contador sigue.
 * El ancho es el de Holded (mínimo 2) y crece si el siguiente número ya no cabe:
 * `F-2026-34` sigue en `F-2026-35` y `F-2026-99` en `F-2026-100`.
 */
async function holdedHint(
  db: Read,
  legalEntityId: string,
  year: number,
  verifactu: boolean,
  credit: boolean,
): Promise<HoldedHint | null> {
  const rows = holdedRows(await db.read<{ number: unknown; issue_date: unknown; total: unknown }>(sql`
    SELECT number, issue_date, total FROM legacy.holded_invoice
    WHERE entity_id = CAST(${legalEntityId} AS UUID) AND kind = 'sale' AND year(issue_date) <= ${year}
  `));
  const invoicePrefix = credit ? invoiceSeriesPrefix(rows) : null;
  const chosenRows = credit ? rows.filter((row) => !row.invoice && row.prefix !== invoicePrefix) : rows.filter((row) => row.invoice);
  const latestYear = Math.max(...chosenRows.map((row) => row.year));
  if (!Number.isFinite(latestYear)) return null;
  const groups = new Map<string, HoldedRow[]>();
  for (const row of chosenRows) {
    if (row.year !== latestYear) continue;
    groups.set(row.prefix, [...(groups.get(row.prefix) ?? []), row]);
  }
  const ranked = [...groups.values()].sort((a, b) => lastDate(b).localeCompare(lastDate(a)) || b.length - a.length);
  const group = ranked[0];
  const chosen = group?.[0]?.prefix;
  if (!group || chosen === undefined) return null;
  const series = rows.filter((row) => row.year === latestYear && row.prefix === chosen);
  const last = series.reduce((top, row) => (row.value > top.value ? row : top));
  const width = Math.max(MIN_PADDING, ...series.map((row) => row.digits.length));
  const renamed = latestYear === year ? null : derivePrefix(chosen, year);
  const prefix = renamed ?? chosen;
  const next = renamed ? 1 : last.value + 1;
  const padding = Math.min(MAX_PADDING, Math.max(width, String(next).length));
  if (String(next).length > padding || seriesPrefixError(prefix, padding)) return null;
  return {
    ...option(credit ? HOLDED_CREDIT_CODE : HOLDED_CODE, prefix, padding, next, verifactu),
    last_number: last.number,
    last_date: last.date,
    last_year: latestYear,
    count: group.length,
  };
}

function invoiceSeriesPrefix(rows: readonly HoldedRow[]): string | null {
  const invoices = rows.filter((row) => row.invoice);
  const latestYear = Math.max(...invoices.map((row) => row.year));
  if (!Number.isFinite(latestYear)) return null;
  const groups = new Map<string, HoldedRow[]>();
  for (const row of invoices) {
    if (row.year !== latestYear) continue;
    groups.set(row.prefix, [...(groups.get(row.prefix) ?? []), row]);
  }
  const ranked = [...groups.values()].sort((a, b) => lastDate(b).localeCompare(lastDate(a)) || b.length - a.length);
  return ranked[0]?.[0]?.prefix ?? null;
}

export async function numberingProposal(db: Read, raw: NumberingInput): Promise<NumberingProposal> {
  const input = validInput(raw);
  const entities = await db.read<{ code: unknown }>(sql`
    SELECT code FROM core.legal_entity WHERE id = CAST(${input.legalEntityId} AS UUID) AND is_active
  `);
  const entity = entities[0];
  if (!entity) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });
  const actives = await db.read<{ id: unknown; prefix: unknown; padding: unknown; next_value: unknown }>(sql`
    SELECT id, prefix, padding, next_value FROM core.number_series
    WHERE legal_entity_id = CAST(${input.legalEntityId} AS UUID)
      AND doc_type = ${input.docType}
      AND "year" = ${input.year}
      AND is_active
    ORDER BY is_default DESC, created_at
    LIMIT 1
  `);
  const current = actives[0];
  const plan = SERIES_PLAN[input.docType];
  return {
    legal_entity_id: input.legalEntityId,
    entity_code: String(entity.code),
    doc_type: input.docType,
    year: input.year,
    active: current
      ? {
          id: String(current.id).toLowerCase(),
          prefix: String(current.prefix),
          next_number: formatSeriesNumber(String(current.prefix), Number(current.padding), Number(current.next_value)),
        }
      : null,
    fresh: option(plan.code, planPrefix(input.docType, input.year), PLAN_PADDING, 1, plan.verifactu),
    holded: input.docType === 'invoice' || input.docType === 'credit_note'
      ? await holdedHint(db, input.legalEntityId, input.year, plan.verifactu, input.docType === 'credit_note')
      : null,
  };
}

/**
 * Abre la serie elegida. Si mientras tanto alguien ya abrió una activa, se queda esa.
 * `nextValue` corrige el primer número propuesto (p. ej. si la importación de Holded va atrasada).
 */
export async function openNumbering(
  tx: Tx,
  raw: NumberingInput & { choice: unknown; nextValue?: unknown },
): Promise<string> {
  if (raw.choice !== 'fresh' && raw.choice !== 'holded') {
    throw domainError('WC_VALIDATION', { choice: 'Elige seguir con Holded o empezar una serie nueva' });
  }
  const override = raw.nextValue ?? null;
  if (override !== null && (typeof override !== 'number' || !Number.isInteger(override) || override < 1)) {
    throw domainError('WC_VALIDATION', { next_value: 'El primer número debe ser un entero desde 1' });
  }
  const proposal = await numberingProposal(tx, raw);
  if (proposal.active) return proposal.active.id;
  const chosen = raw.choice === 'holded' ? proposal.holded : proposal.fresh;
  if (!chosen) throw domainError('WC_VALIDATION', { choice: 'No hay numeración de Holded que seguir' });
  const opened = await ensureSeriesForYear(tx, {
    legalEntityId: proposal.legal_entity_id,
    docType: proposal.doc_type,
    code: chosen.code,
    year: proposal.year,
    prefix: chosen.prefix,
    padding: chosen.padding,
    isDefault: true,
    verifactu: chosen.verifactu,
    nextValue: override ?? chosen.next_value,
  });
  return opened.id;
}
