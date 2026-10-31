import { exampleExportDocuments } from '../../src/core/billing/export/setting';
import type { ExportDocumentsSetting, ExportInvoice } from '../../src/core/billing/export/types';

export function sampleInvoice(overrides: Partial<ExportInvoice> = {}): ExportInvoice {
  const invoice: ExportInvoice = {
    destination_country: 'GB',
    language: 'es',
    tax_treatment: 'EXP_E2',
    incoterm: 'FCA',
    packages: 2,
    origin_country: 'ES',
    currency: 'EUR',
    number: 'EXP-2026-0001',
    issue_date: '2026-03-15',
    entity: {
      legal_name: 'Productor (P.O)',
      tax_id: '00000000T',
      eori: 'ES00000000T',
      address_line: 'Calle Ejemplo 1',
      postal_code: '00000',
      city: 'Ejemplo',
      province: 'Ejemplo',
      country_code: 'ES',
    },
    customer: {
      legal_name: 'Cliente Ejemplo Ltd',
      tax_id: null,
      eori: 'GB123456789000',
      address_line: '1 Example Street',
      postal_code: 'SW1A 1AA',
      city: 'London',
      province: null,
      country_code: 'GB',
    },
    lines: [{
      line_no: 1,
      description: 'Viña Arcal 2024',
      kind: 'wine',
      quantity: '12',
      unit: 'ud',
      unit_price: '10.00',
      discount_pct: null,
      line_base: null,
      nc_code: '22042100',
      origin_country: null,
      unit_net_weight_g: 750,
      unit_gross_weight_g: 1200,
      sku: null,
      lot_code: null,
    }],
    sscc: [],
  };
  return {
    ...invoice,
    ...overrides,
    entity: { ...invoice.entity, ...overrides.entity },
    customer: { ...invoice.customer, ...overrides.customer },
    lines: overrides.lines ?? invoice.lines,
    sscc: overrides.sscc ?? invoice.sscc,
  };
}

export function confirmedGb(): ExportDocumentsSetting {
  const setting = exampleExportDocuments();
  const country = setting.countries.GB;
  if (!country) throw new Error('falta GB');
  country.example = false;
  country.confirmed = true;
  country.notes = 'Confirmado para la prueba sintética.';
  setting.notice = 'Prueba sintética.';
  return setting;
}
