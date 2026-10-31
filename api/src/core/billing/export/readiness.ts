import { isGeneratedDocument } from './constants';
import { ENTITY_EORI_MISSING, INCOTERM_SET } from './constants';
import { validateEori } from './eori';
import { lineAmount, lineQuantity } from './amounts';
import type {
  ChecklistItem,
  CountryExportRequirements,
  ExportAssessment,
  ExportDocumentsSetting,
  ExportField,
  ExportInvoice,
  ExportLine,
} from './types';

const INCOTERM_BAD =
  'El Incoterm no es uno de los del pedido: EXW, FCA, CPT, CIP, DAP, DPU, DDP, FAS, FOB, CFR o CIF.';

export function assessExport(invoice: ExportInvoice, setting: ExportDocumentsSetting): ExportAssessment {
  const destination = invoice.destination_country.trim().toUpperCase();
  const country = setting.countries[destination] ?? null;
  const shared: string[] = [];
  const prices: string[] = [];
  const entityMissing = checkEntityEori(invoice, shared);

  if (!country) {
    if (invoice.lines.length === 0) shared.push('La factura no tiene líneas.');
    shared.push(`No hay requisitos configurados para ${destination}. Pedro y el asesor deben confirmarlos.`);
    return assessment(invoice, setting, country, entityMissing, shared, prices);
  }

  checkCustomerEori(invoice, country, shared);
  checkIncoterm(invoice, country, shared);
  checkOrigin(invoice, country, shared);
  checkPackages(invoice, country, shared);
  checkSscc(invoice, shared);
  if (invoice.lines.length === 0) {
    shared.push('La factura no tiene líneas.');
  } else {
    checkLines(invoice, country, shared);
    if (country.documents.some((document) => document.code === 'commercial_invoice')) {
      checkPrices(invoice, prices);
    }
  }
  return assessment(invoice, setting, country, entityMissing, shared, prices);
}

function assessment(
  invoice: ExportInvoice,
  setting: ExportDocumentsSetting,
  country: CountryExportRequirements | null,
  entityMissing: boolean,
  shared: string[],
  prices: string[],
): ExportAssessment {
  const missing = [...shared, ...prices];
  const confirmationRequired = country == null || country.example || !country.confirmed;
  const items: ChecklistItem[] = (country?.documents ?? []).map((document) => ({
    code: document.code,
    name_es: document.name_es,
    name_en: document.name_en,
    source: isGeneratedDocument(document.code) ? 'invoice' : 'external',
    status: documentStatus(document.code, shared, prices),
  }));
  return {
    ready: missing.length === 0,
    confirmation_required: confirmationRequired,
    example: country?.example ?? false,
    confirmed: country?.confirmed ?? false,
    notice: confirmationRequired ? setting.notice : null,
    notes: country?.notes ?? null,
    destination_country: invoice.destination_country,
    entity_eori_missing: entityMissing,
    missing,
    items,
  };
}

function documentStatus(code: string, shared: string[], prices: string[]): 'generated' | 'pending' {
  if (!isGeneratedDocument(code) || shared.length > 0) return 'pending';
  if (code === 'commercial_invoice' && prices.length > 0) return 'pending';
  return 'generated';
}

function requires(country: CountryExportRequirements, field: ExportField): boolean {
  return country.required_fields.includes(field);
}

function checkEntityEori(invoice: ExportInvoice, missing: string[]): boolean {
  const raw = invoice.entity.eori?.trim() ?? '';
  if (raw === '') {
    missing.push(ENTITY_EORI_MISSING);
    return true;
  }
  const result = validateEori(raw);
  if (result.ok) return false;
  if (result.empty) {
    missing.push(ENTITY_EORI_MISSING);
    return true;
  }
  missing.push(`El EORI de la entidad emisora no es válido. ${result.message}`);
  return false;
}

function checkCustomerEori(
  invoice: ExportInvoice,
  country: CountryExportRequirements,
  missing: string[],
): void {
  const raw = invoice.customer.eori?.trim() ?? '';
  const required = requires(country, 'customer_eori');
  if (raw === '') {
    if (required) missing.push('Falta el EORI del cliente.');
    return;
  }
  const result = validateEori(raw);
  if (!result.ok) missing.push(`El EORI del cliente no es válido. ${result.message}`);
}

function checkIncoterm(
  invoice: ExportInvoice,
  country: CountryExportRequirements,
  missing: string[],
): void {
  const code = invoice.incoterm?.trim().toUpperCase() ?? '';
  if (code === '') {
    if (requires(country, 'incoterm')) missing.push('Falta el Incoterm.');
    return;
  }
  if (!INCOTERM_SET.has(code)) missing.push(INCOTERM_BAD);
}

function checkOrigin(
  invoice: ExportInvoice,
  country: CountryExportRequirements,
  missing: string[],
): void {
  const headerRaw = invoice.origin_country?.trim() ?? '';
  const header = iso2(headerRaw);
  if (headerRaw !== '' && !header) {
    missing.push('El país de origen debe ser un código de 2 letras.');
  }
  const required = requires(country, 'origin');
  if (header) {
    for (const line of invoice.lines) {
      const raw = line.origin_country?.trim() ?? '';
      if (raw !== '' && !iso2(raw)) {
        missing.push(`El país de origen de la línea ${line.line_no} debe ser un código de 2 letras.`);
      }
    }
    return;
  }
  if (!required || headerRaw !== '') return;
  const wine = invoice.lines.filter((line) => line.kind === 'wine');
  if (wine.length === 0) {
    missing.push('Falta el país de origen.');
    return;
  }
  for (const line of wine) {
    const raw = line.origin_country?.trim() ?? '';
    if (raw === '') missing.push(`Falta el país de origen en la línea ${line.line_no}.`);
    else if (!iso2(raw)) missing.push(`El país de origen de la línea ${line.line_no} debe ser un código de 2 letras.`);
  }
}

function checkPackages(
  invoice: ExportInvoice,
  country: CountryExportRequirements,
  missing: string[],
): void {
  const packages = invoice.packages;
  const required = requires(country, 'packages');
  if (packages == null) {
    if (required) missing.push('Falta el número de bultos.');
    return;
  }
  if (!Number.isInteger(packages) || packages < 1) {
    missing.push('El número de bultos debe ser un entero mayor que cero.');
  }
}

function checkSscc(invoice: ExportInvoice, missing: string[]): void {
  invoice.sscc.forEach((code, index) => {
    if (!/^\d{18}$/.test(code)) missing.push(`El SSCC de la posición ${index + 1} debe tener 18 dígitos.`);
  });
}

function checkLines(
  invoice: ExportInvoice,
  country: CountryExportRequirements,
  missing: string[],
): void {
  const needNc = requires(country, 'nc_code');
  const needNet = requires(country, 'net_weight');
  const needGross = requires(country, 'gross_weight');
  for (const line of invoice.lines) {
    if (lineQuantity(line) == null) missing.push(`La cantidad de la línea ${line.line_no} no es válida.`);
    if (line.kind !== 'wine') continue;
    checkNc(line, needNc, missing);
    checkWeight(line, 'net', needNet, missing);
    checkWeight(line, 'gross', needGross, missing);
    const net = line.unit_net_weight_g;
    const gross = line.unit_gross_weight_g;
    if (
      net != null && gross != null
      && Number.isInteger(net) && Number.isInteger(gross)
      && net > 0 && gross > 0
      && net > gross
    ) {
      missing.push(`El peso neto del formato supera al bruto en la línea ${line.line_no}.`);
    }
  }
}

function checkNc(line: ExportLine, required: boolean, missing: string[]): void {
  const code = line.nc_code?.trim() ?? '';
  if (code === '') {
    if (required) missing.push(`Falta el código NC en la línea ${line.line_no}.`);
    return;
  }
  if (!/^\d{8}$/.test(code)) missing.push(`El código NC de la línea ${line.line_no} debe tener 8 dígitos.`);
}

function checkWeight(
  line: ExportLine,
  kind: 'net' | 'gross',
  required: boolean,
  missing: string[],
): void {
  const value = kind === 'net' ? line.unit_net_weight_g : line.unit_gross_weight_g;
  const label = kind === 'net' ? 'neto' : 'bruto';
  if (value == null) {
    if (required) missing.push(`Falta el peso ${label} del formato en la línea ${line.line_no}.`);
    return;
  }
  if (!Number.isInteger(value) || value < 1) {
    missing.push(`El peso ${label} del formato en la línea ${line.line_no} no es válido.`);
  }
}

function checkPrices(invoice: ExportInvoice, missing: string[]): void {
  for (const line of invoice.lines) {
    if (lineQuantity(line) == null) continue;
    if (lineAmount(line) == null) missing.push(`Falta el importe de la línea ${line.line_no}.`);
  }
}

function iso2(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}
