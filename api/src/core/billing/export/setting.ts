import { domainError } from '../../errors';
import type {
  CountryExportRequirements,
  ExportDocumentSpec,
  ExportDocumentsSetting,
  ExportField,
} from './types';
import { EXPORT_FIELDS } from './types';

export const EXPORT_DOCUMENTS_SETTING_KEY = 'billing.export_documents_by_country';

const FIELD_SET = new Set<string>(EXPORT_FIELDS);
const TOP_KEYS = new Set(['notice', 'countries']);
const COUNTRY_KEYS = new Set(['example', 'confirmed', 'required_fields', 'documents', 'notes']);
const DOCUMENT_KEYS = new Set(['code', 'name_es', 'name_en']);

/**
 * Labelled example only. Pedro and the adviser must confirm every country.
 * GB is the forwarder case called out as still open in emcs.md §7.
 * It is not a customs rule.
 */
const EXAMPLE: ExportDocumentsSetting = {
  notice: 'EJEMPLO sin confirmar. Pedro y el asesor deben confirmar los requisitos de cada país. No es una regla aduanera.',
  countries: {
    GB: {
      example: true,
      confirmed: false,
      required_fields: [
        'entity_eori',
        'customer_eori',
        'incoterm',
        'nc_code',
        'origin',
        'net_weight',
        'gross_weight',
        'packages',
      ],
      documents: [
        { code: 'commercial_invoice', name_es: 'Factura comercial', name_en: 'Commercial invoice' },
        { code: 'packing_list', name_es: 'Lista de bultos', name_en: 'Packing list' },
        { code: 'certificate_of_origin', name_es: 'Certificado de origen', name_en: 'Certificate of origin' },
      ],
      notes: 'EJEMPLO sin confirmar. La lista del Reino Unido para el transitario está pendiente (Pedro, 15-02-2027). No es una regla aduanera.',
    },
  },
};

export function exampleExportDocuments(): ExportDocumentsSetting {
  return structuredClone(EXAMPLE);
}

export function parseExportDocuments(value: unknown): ExportDocumentsSetting {
  const fields: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('WC_VALIDATION', { body: 'El ajuste debe ser un objeto' });
  }
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!TOP_KEYS.has(key)) fields[key] = 'Campo no reconocido';
  }
  const notice = typeof body.notice === 'string' ? body.notice.trim() : '';
  if (notice.length < 1 || notice.length > 500) fields.notice = 'Debe tener entre 1 y 500 caracteres';
  if (notice.includes('\n') || notice.includes('\r')) fields.notice = 'No puede contener saltos de línea';

  const countries: Record<string, CountryExportRequirements> = {};
  if (!body.countries || typeof body.countries !== 'object' || Array.isArray(body.countries)) {
    fields.countries = 'Debe ser un objeto por país';
  } else {
    const entries = Object.entries(body.countries as Record<string, unknown>);
    if (entries.length > 60) fields.countries = 'Hay demasiados países';
    for (const [rawCode, rawCountry] of entries) {
      const code = rawCode.trim().toUpperCase();
      const path = `countries.${code}`;
      if (!/^[A-Z]{2}$/.test(code)) {
        fields[path] = 'El país debe ser un código de 2 letras';
        continue;
      }
      if (countries[code]) {
        fields[path] = 'País repetido';
        continue;
      }
      const parsed = parseCountry(rawCountry, path, fields);
      if (parsed) countries[code] = parsed;
    }
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return { notice, countries };
}

function parseCountry(
  value: unknown,
  path: string,
  fields: Record<string, string>,
): CountryExportRequirements | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fields[path] = 'Debe ser un objeto';
    return null;
  }
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!COUNTRY_KEYS.has(key)) fields[`${path}.${key}`] = 'Campo no reconocido';
  }
  if (typeof body.example !== 'boolean') fields[`${path}.example`] = 'Debe ser verdadero o falso';
  if (typeof body.confirmed !== 'boolean') fields[`${path}.confirmed`] = 'Debe ser verdadero o falso';
  if (body.example === true && body.confirmed === true) {
    fields[`${path}.confirmed`] = 'Un ejemplo no puede marcarse como confirmado';
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length < 1 || notes.length > 2000) fields[`${path}.notes`] = 'Debe tener entre 1 y 2000 caracteres';
  if (notes.includes('\n') || notes.includes('\r')) fields[`${path}.notes`] = 'No puede contener saltos de línea';

  const required = parseFields(body.required_fields, `${path}.required_fields`, fields);
  const documents = parseDocuments(body.documents, `${path}.documents`, fields);
  if (typeof body.example !== 'boolean' || typeof body.confirmed !== 'boolean' || !required || !documents) {
    return null;
  }
  return {
    example: body.example,
    confirmed: body.confirmed,
    required_fields: required,
    documents,
    notes,
  };
}

function parseFields(value: unknown, path: string, fields: Record<string, string>): ExportField[] | null {
  if (!Array.isArray(value)) {
    fields[path] = 'Debe ser una lista de campos';
    return null;
  }
  const out: ExportField[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !FIELD_SET.has(item)) {
      fields[path] = 'Hay un campo que este módulo no comprueba';
      return null;
    }
    if (seen.has(item)) {
      fields[path] = 'Hay un campo repetido';
      return null;
    }
    seen.add(item);
    out.push(item as ExportField);
  }
  return out;
}

function parseDocuments(
  value: unknown,
  path: string,
  fields: Record<string, string>,
): ExportDocumentSpec[] | null {
  if (!Array.isArray(value)) {
    fields[path] = 'Debe ser una lista de documentos';
    return null;
  }
  if (value.length > 20) {
    fields[path] = 'Hay demasiados documentos';
    return null;
  }
  const out: ExportDocumentSpec[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const itemPath = `${path}.${index}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fields[itemPath] = 'Debe ser un objeto';
      continue;
    }
    const body = item as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      if (!DOCUMENT_KEYS.has(key)) fields[`${itemPath}.${key}`] = 'Campo no reconocido';
    }
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(code)) fields[`${itemPath}.code`] = 'Código no válido';
    if (code && seen.has(code)) fields[`${itemPath}.code`] = 'Documento repetido';
    seen.add(code);
    const nameEs = cleanName(body.name_es);
    const nameEn = cleanName(body.name_en);
    if (!nameEs) fields[`${itemPath}.name_es`] = 'Debe tener entre 2 y 80 caracteres, sin saltos de línea';
    if (!nameEn) fields[`${itemPath}.name_en`] = 'Debe tener entre 2 y 80 caracteres, sin saltos de línea';
    if (code && nameEs && nameEn && !fields[`${itemPath}.code`]) {
      out.push({ code, name_es: nameEs, name_en: nameEn });
    }
  }
  if (Object.keys(fields).some((key) => key.startsWith(path))) return null;
  return out;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return null;
  if (trimmed.includes('\n') || trimmed.includes('\r')) return null;
  return trimmed;
}
