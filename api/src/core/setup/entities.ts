import { validateEori } from '../billing/export/eori';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { normalizeTaxId } from '../party/taxId';

const CODE = /^[A-Z][A-Z0-9_]{1,15}$/;
const POSTAL = /^[0-9]{5}$/;
const COUNTRY = /^[A-Z]{2}$/;
const ENTITY_FIRST = 'ABCDEFGHJNPQRSUVW';

export type LegalEntityView = {
  code: string;
  legal_name: string;
  tax_id: string;
  person_type: string;
  address_line: string;
  postal_code: string;
  city: string;
  province: string;
  country_code: string;
  eori: string | null;
};

type Current = LegalEntityView & { id: string };

type Patch = {
  legalName?: string;
  taxId?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  province?: string;
  countryCode?: string;
  eori?: string | null;
  eoriSet: boolean;
};

export async function patchLegalEntity(tx: Tx, code: string, raw: unknown): Promise<LegalEntityView> {
  const normalized = code.trim().toUpperCase();
  if (!CODE.test(normalized)) throw domainError('WC_NOT_FOUND');
  const patch = parsePatch(raw);
  const current = await readEntity(tx, normalized);
  if (!current) throw domainError('WC_NOT_FOUND');
  const next = apply(current, patch);
  if (patch.eoriSet && next.eori == null && (await exportsExist(tx))) {
    throw domainError('WC_VALIDATION', { eori: 'Hay exportaciones: el EORI no se puede quitar' });
  }
  const changed = diff(current, next);
  if (Object.keys(changed.after).length === 0) return view(next);
  const vatId = `ES${next.tax_id}`;
  tx.write(sql`
    UPDATE core.legal_entity
    SET legal_name = ${next.legal_name},
        tax_id = ${next.tax_id},
        vat_id = ${vatId},
        address_line = ${next.address_line},
        postal_code = ${next.postal_code},
        city = ${next.city},
        province = ${next.province},
        country_code = ${next.country_code},
        eori = ${next.eori},
        updated_at = now()
    WHERE id = CAST(${current.id} AS UUID)
  `);
  tx.audit({
    table: 'core.legal_entity',
    rowId: current.id,
    action: 'UPDATE',
    before: changed.before,
    after: changed.after,
  });
  return view(next);
}

function parsePatch(raw: unknown): Patch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const body = raw as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const patch: Patch = { eoriSet: false };
  if ('legal_name' in body) patch.legalName = requiredText(body.legal_name, 'legal_name', 2, 120, fields);
  if ('tax_id' in body) patch.taxId = requiredText(body.tax_id, 'tax_id', 1, 20, fields);
  if ('address_line' in body) patch.addressLine = requiredText(body.address_line, 'address_line', 2, 120, fields);
  if ('postal_code' in body) patch.postalCode = requiredText(body.postal_code, 'postal_code', 5, 5, fields);
  if ('city' in body) patch.city = requiredText(body.city, 'city', 2, 80, fields);
  if ('province' in body) patch.province = requiredText(body.province, 'province', 2, 80, fields);
  if ('country_code' in body) patch.countryCode = requiredText(body.country_code, 'country_code', 2, 2, fields);
  if ('eori' in body) {
    patch.eoriSet = true;
    patch.eori = parseEori(body.eori, fields);
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  if (
    patch.legalName === undefined
    && patch.taxId === undefined
    && patch.addressLine === undefined
    && patch.postalCode === undefined
    && patch.city === undefined
    && patch.province === undefined
    && patch.countryCode === undefined
    && !patch.eoriSet
  ) {
    throw domainError('WC_VALIDATION', { body: 'No hay ningún dato que cambiar' });
  }
  return patch;
}

function apply(current: Current, patch: Patch): Current {
  const next: Current = { ...current };
  if (patch.legalName !== undefined) next.legal_name = patch.legalName;
  if (patch.taxId !== undefined) next.tax_id = assertTaxId(patch.taxId, current.person_type);
  if (patch.addressLine !== undefined) next.address_line = assertAddressLine(patch.addressLine);
  if (patch.postalCode !== undefined) next.postal_code = assertPostal(patch.postalCode);
  if (patch.city !== undefined) next.city = assertPlace(patch.city, 'city');
  if (patch.province !== undefined) next.province = assertPlace(patch.province, 'province');
  if (patch.countryCode !== undefined) next.country_code = assertCountry(patch.countryCode);
  if (patch.eoriSet) next.eori = patch.eori ?? null;
  return next;
}

function assertTaxId(raw: string, personType: string): string {
  const value = raw.trim().toUpperCase();
  if (value === 'PENDIENTE') {
    throw domainError('WC_VALIDATION', { tax_id: 'El NIF no puede ser PENDIENTE' });
  }
  const parsed = normalizeTaxId(value, 'ES');
  if (!parsed.valid || !parsed.normalized || parsed.normalized.length !== 9) {
    throw domainError('WC_VALIDATION', { tax_id: parsed.warning ?? 'El NIF no es válido' });
  }
  const company = ENTITY_FIRST.includes(parsed.normalized.charAt(0));
  if (personType === 'legal') {
    if (!company || parsed.type !== 'nif') {
      throw domainError('WC_VALIDATION', { tax_id: 'Una sociedad necesita un CIF' });
    }
  } else if (company || (parsed.type !== 'nif' && parsed.type !== 'nie')) {
    throw domainError('WC_VALIDATION', { tax_id: 'Una persona física necesita un NIF o un NIE' });
  }
  return parsed.normalized;
}

function assertAddressLine(value: string): string {
  const line = value.trim();
  const folded = line.toLowerCase();
  if (folded === 'pendiente' || folded === 'calle ejemplo 1') {
    throw domainError('WC_VALIDATION', { address_line: 'Indica la dirección fiscal real' });
  }
  return line;
}

function assertPostal(value: string): string {
  const postal = value.trim();
  if (!POSTAL.test(postal) || postal === '00000') {
    throw domainError('WC_VALIDATION', { postal_code: 'El código postal no es válido' });
  }
  return postal;
}

function assertPlace(value: string, field: 'city' | 'province'): string {
  const place = value.trim();
  const folded = place.toLowerCase();
  if (folded === 'pendiente' || folded === 'ejemplo') {
    throw domainError('WC_VALIDATION', { [field]: 'Indica el dato real' });
  }
  return place;
}

function assertCountry(value: string): string {
  const country = value.trim().toUpperCase();
  if (!COUNTRY.test(country)) {
    throw domainError('WC_VALIDATION', { country_code: 'El país debe ser un código de dos letras' });
  }
  return country;
}

function parseEori(value: unknown, fields: Record<string, string>): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    fields.eori = 'Debe ser texto';
    return null;
  }
  const result = validateEori(value);
  if (!result.ok) {
    fields.eori = result.message;
    return null;
  }
  return result.normalized;
}

function requiredText(
  value: unknown,
  field: string,
  min: number,
  max: number,
  fields: Record<string, string>,
): string {
  if (typeof value !== 'string') {
    fields[field] = 'Debe ser texto';
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fields[field] = `Debe tener entre ${min} y ${max} caracteres`;
  }
  return trimmed;
}

export async function listLegalEntities(db: Pick<Tx, 'read'>): Promise<(LegalEntityView & { id: string })[]> {
  const rows = await db.read<Record<string, unknown>>(sql`
    SELECT id, code, legal_name, tax_id, person_type, address_line, postal_code, city, province, country_code, eori
    FROM core.legal_entity
    WHERE is_active
    ORDER BY code
  `);
  return rows.map((row) => {
    const entity = currentOf(row);
    return { id: entity.id, ...view(entity) };
  });
}

async function readEntity(tx: Tx, code: string): Promise<Current | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, code, legal_name, tax_id, person_type, address_line, postal_code, city, province, country_code, eori
    FROM core.legal_entity
    WHERE code = ${code}
    LIMIT 1
  `);
  const row = rows[0];
  return row ? currentOf(row) : null;
}

function currentOf(row: Record<string, unknown>): Current {
  return {
    id: String(row.id).toLowerCase(),
    code: String(row.code),
    legal_name: String(row.legal_name),
    tax_id: String(row.tax_id),
    person_type: String(row.person_type),
    address_line: String(row.address_line),
    postal_code: String(row.postal_code),
    city: String(row.city),
    province: String(row.province),
    country_code: String(row.country_code),
    eori: row.eori == null || String(row.eori) === '' ? null : String(row.eori),
  };
}

function view(entity: Current): LegalEntityView {
  return {
    code: entity.code,
    legal_name: entity.legal_name,
    tax_id: entity.tax_id,
    person_type: entity.person_type,
    address_line: entity.address_line,
    postal_code: entity.postal_code,
    city: entity.city,
    province: entity.province,
    country_code: entity.country_code,
    eori: entity.eori,
  };
}

function diff(before: Current, after: Current): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  const fields: (keyof LegalEntityView)[] = [
    'legal_name',
    'tax_id',
    'address_line',
    'postal_code',
    'city',
    'province',
    'country_code',
    'eori',
  ];
  for (const field of fields) {
    if (before[field] === after[field]) continue;
    previous[field] = before[field];
    next[field] = after[field];
  }
  return { before: previous, after: next };
}

async function exportsExist(tx: Tx): Promise<boolean> {
  const contacts = await tx.read<{ total: unknown }>(sql`
    SELECT count(*)::INTEGER AS total
    FROM party.contact
    WHERE archived_at IS NULL AND merged_into_id IS NULL AND vat_regime = 'export'
  `).catch((error: unknown) => {
    if (missingTable(error)) return [{ total: 0 }];
    throw error;
  });
  if (int(contacts[0]?.total) > 0) return true;
  const lines = await tx.read<{ total: unknown }>(sql`
    SELECT count(*)::INTEGER AS total FROM billing.invoice_line WHERE tax_code = 'EXP_E2'
  `).catch((error: unknown) => {
    if (missingTable(error)) return [{ total: 0 }];
    throw error;
  });
  return int(lines[0]?.total) > 0;
}

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist|Catalog Error|Table with name/i.test(message);
}

function int(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return 0;
}
