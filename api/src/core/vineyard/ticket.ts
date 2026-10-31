import { domainError } from '../errors';
import { isInstant } from '../inventory/periods';
import { businessDate, isMadridCivilDate } from '../time';
import { parseKg, parseMeasure } from './quantity';

const CODE = /^[A-Z0-9-]{2,20}$/;
const LOT = /^[A-Z0-9][A-Z0-9./-]{1,29}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SANITARY = ['good', 'fair', 'poor'] as const;

export interface ParcelAllocation {
  parcel_id: string;
  parcel_code: string;
  kg: string;
  grams: number;
}

export interface StoredTicket {
  fiscal_date: string;
  weighed_at: string;
  variety_code: string;
  gross_kg: string;
  tare_kg: string;
  net_kg: string;
  net_g: number;
  probable_abv: string;
  sanitary_status: (typeof SANITARY)[number];
  is_organic: boolean;
  organic_label_checked: boolean;
  has_do: boolean;
  appellation: string | null;
  accompanying_doc: string | null;
  destination_vessel_id: string;
  lot_code: string;
  vintage: number;
  source:
    | { kind: 'parcels'; lines: ParcelAllocation[] }
    | { kind: 'grower'; contact_id: string };
  lot_id: string | null;
  silicie_entry_id: string | null;
}

export interface TicketDraft {
  weighed_at: string;
  fiscal_date: string;
  variety_code: string;
  gross_kg: string;
  tare_kg: string;
  net_kg: string;
  net_g: number;
  probable_abv: string;
  sanitary_status: (typeof SANITARY)[number];
  is_organic: boolean;
  organic_label_checked: boolean;
  has_do: boolean;
  appellation: string | null;
  accompanying_doc: string | null;
  destination_vessel_id: string;
  lot_code: string;
  vintage: number;
  parcels: { code: string; kg: string; grams: number }[] | null;
  grower_contact_id: string | null;
}

export function parseTicket(body: Record<string, unknown>): TicketDraft {
  const weighedAt = typeof body.occurred_at === 'string' && isInstant(body.occurred_at) ? body.occurred_at : '';
  if (weighedAt === '') throw domainError('WC_VALIDATION', { occurred_at: 'Instante ISO-8601 con zona horaria' });
  const fiscalDate = businessDate(new Date(weighedAt));
  if (body.fiscal_date !== undefined && body.fiscal_date !== null && body.fiscal_date !== fiscalDate) {
    throw domainError('WC_VALIDATION', { fiscal_date: 'Tiene que ser el día de la pesada en Europe/Madrid' });
  }
  if (fiscalDate > businessDate(new Date())) {
    throw domainError('WC_VALIDATION', { occurred_at: 'La fecha no puede ser futura' });
  }
  if (!isMadridCivilDate(fiscalDate)) throw domainError('WC_VALIDATION', { occurred_at: 'La fecha no es válida' });
  const gross = parseKg(body.gross_kg, 'gross_kg');
  const tare = parseKg(body.tare_kg, 'tare_kg');
  const net = parseKg(body.net_kg, 'net_kg');
  if (gross.grams <= 0) throw domainError('WC_VALIDATION', { gross_kg: 'El peso bruto tiene que ser mayor que cero' });
  if (tare.grams < 0) throw domainError('WC_VALIDATION', { tare_kg: 'La tara no puede ser negativa' });
  if (net.grams <= 0) throw domainError('WC_VALIDATION', { net_kg: 'El peso neto tiene que ser mayor que cero' });
  if (gross.grams - tare.grams !== net.grams) {
    throw domainError('WC_VALIDATION', { net_kg: 'El neto tiene que ser el bruto menos la tara' });
  }
  const variety = upper(body.variety_code ?? body.variety, 'variety_code');
  const lot = upper(body.lot_code, 'lot_code');
  if (!LOT.test(lot)) throw domainError('WC_VALIDATION', { lot_code: 'Código de lote no válido' });
  const vintage = yearOf(body.vintage, 'vintage');
  const sanitary = oneOf(body.sanitary_status, 'sanitary_status', SANITARY);
  const isOrganic = boolOf(body.is_organic, 'is_organic');
  const labelChecked = boolOf(body.organic_label_checked, 'organic_label_checked');
  if (isOrganic && !labelChecked) {
    throw domainError('WC_VALIDATION', { organic_label_checked: 'La recepción ecológica exige marcar la comprobación' });
  }
  const hasDo = boolOf(body.has_do, 'has_do');
  const appellation = optionalText(body.appellation, 'appellation', 80);
  if (hasDo && appellation === null) throw domainError('WC_VALIDATION', { appellation: 'La denominación de origen es obligatoria' });
  if (!hasDo && appellation !== null) throw domainError('WC_VALIDATION', { appellation: 'Sin DO no se indica denominación' });
  const vessel = uuidOf(body.destination_vessel_id, 'destination_vessel_id');
  const parcels = body.parcels;
  const grower = body.grower_contact_id;
  const hasParcels = parcels !== undefined && parcels !== null;
  const hasGrower = grower !== undefined && grower !== null && grower !== '';
  if (hasParcels === hasGrower) {
    throw domainError('WC_VALIDATION', { parcels: 'Indica parcelas propias o un viticultor externo, no las dos cosas' });
  }
  let parcelLines: TicketDraft['parcels'] = null;
  let growerId: string | null = null;
  if (hasParcels) {
    if (!Array.isArray(parcels) || parcels.length === 0) {
      throw domainError('WC_VALIDATION', { parcels: 'Indica al menos una parcela' });
    }
    parcelLines = parcels.map((item, index) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw domainError('WC_VALIDATION', { [`parcels[${index}]`]: 'La parcela no es válida' });
      }
      const row = item as Record<string, unknown>;
      const code = upper(row.parcel_code ?? row.code, `parcels[${index}].parcel_code`);
      const kg = parseKg(row.kg, `parcels[${index}].kg`);
      if (kg.grams <= 0) throw domainError('WC_VALIDATION', { [`parcels[${index}].kg`]: 'Los kilos tienen que ser mayores que cero' });
      return { code, kg: kg.kg, grams: kg.grams };
    });
    const seen = new Set<string>();
    let sum = 0;
    for (const line of parcelLines) {
      if (seen.has(line.code)) throw domainError('WC_VALIDATION', { parcels: 'La parcela está repetida' });
      seen.add(line.code);
      sum += line.grams;
    }
    if (sum !== net.grams) {
      throw domainError('WC_VALIDATION', { parcels: 'Los kilos de las parcelas tienen que sumar el neto' });
    }
  } else {
    growerId = uuidOf(grower, 'grower_contact_id');
  }
  return {
    weighed_at: weighedAt,
    fiscal_date: fiscalDate,
    variety_code: variety,
    gross_kg: gross.kg,
    tare_kg: tare.kg,
    net_kg: net.kg,
    net_g: net.grams,
    probable_abv: parseMeasure(body.probable_abv, 'probable_abv', 25),
    sanitary_status: sanitary,
    is_organic: isOrganic,
    organic_label_checked: labelChecked,
    has_do: hasDo,
    appellation,
    accompanying_doc: optionalText(body.accompanying_doc, 'accompanying_doc', 80),
    destination_vessel_id: vessel,
    lot_code: lot,
    vintage,
    parcels: parcelLines,
    grower_contact_id: growerId,
  };
}

export function ticketView(ticket: StoredTicket) {
  return {
    weighed_at: ticket.weighed_at,
    fiscal_date: ticket.fiscal_date,
    variety_code: ticket.variety_code,
    gross_kg: ticket.gross_kg,
    tare_kg: ticket.tare_kg,
    net_kg: ticket.net_kg,
    net_g: ticket.net_g,
    probable_abv: ticket.probable_abv,
    sanitary_status: ticket.sanitary_status,
    is_organic: ticket.is_organic,
    organic_label_checked: ticket.organic_label_checked,
    has_do: ticket.has_do,
    appellation: ticket.appellation,
    accompanying_doc: ticket.accompanying_doc,
    destination_vessel_id: ticket.destination_vessel_id,
    lot_code: ticket.lot_code,
    vintage: ticket.vintage,
    source: ticket.source,
    lot_id: ticket.lot_id,
    silicie_entry_id: ticket.silicie_entry_id,
  };
}

function upper(value: unknown, field: string): string {
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  const code = value.trim().toUpperCase();
  if (field.endsWith('lot_code')) {
    if (!LOT.test(code)) throw domainError('WC_VALIDATION', { [field]: 'Código de lote no válido' });
    return code;
  }
  if (!CODE.test(code)) throw domainError('WC_VALIDATION', { [field]: 'Código no válido' });
  return code;
}

function yearOf(value: unknown, field: string): number {
  const year = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) {
    throw domainError('WC_VALIDATION', { [field]: 'La añada está entre 1990 y 2100' });
  }
  return year;
}

function boolOf(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw domainError('WC_VALIDATION', { [field]: 'Tiene que ser sí o no' });
  return value;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Debe ser un texto' });
  const trimmed = value.trim();
  if (trimmed.length > max) throw domainError('WC_VALIDATION', { [field]: `Máximo ${max} caracteres` });
  return trimmed.length === 0 ? null : trimmed;
}

function uuidOf(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw domainError('WC_VALIDATION', { [field]: 'Debe ser un UUID' });
  return value.toLowerCase();
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw domainError('WC_VALIDATION', { [field]: `Valores: ${allowed.join(', ')}` });
  }
  return value as T;
}
