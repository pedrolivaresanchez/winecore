import { describe, expect, it } from 'bun:test';
import { ENTITY_EORI_MISSING } from '../../src/core/billing/export/constants';
import { DomainError } from '../../src/core/errors';
import { assessExport } from '../../src/core/billing/export/readiness';
import { exampleExportDocuments, parseExportDocuments } from '../../src/core/billing/export/setting';
import type { ExportDocumentsSetting } from '../../src/core/billing/export/types';
import { confirmedGb, sampleInvoice } from './fixture';

describe('documentos por país', () => {
  it('el ejemplo de semilla está etiquetado y solo trae Reino Unido', () => {
    const setting = exampleExportDocuments();
    expect(parseExportDocuments(setting)).toEqual(setting);
    expect(setting.notice).toContain('EJEMPLO');
    expect(setting.notice).toContain('Pedro');
    expect(setting.notice).toContain('asesor');
    expect(setting.notice).toContain('No es una regla aduanera');
    expect(Object.keys(setting.countries)).toEqual(['GB']);
    const gb = setting.countries.GB;
    expect(gb?.example).toBe(true);
    expect(gb?.confirmed).toBe(false);
    expect(gb?.notes).toContain('EJEMPLO');
    expect(gb?.notes).toContain('15-02-2027');
    expect(gb?.documents.map((document) => document.code)).toEqual([
      'commercial_invoice',
      'packing_list',
      'certificate_of_origin',
    ]);
    expect(gb?.required_fields).toEqual([
      'entity_eori',
      'customer_eori',
      'incoterm',
      'nc_code',
      'origin',
      'net_weight',
      'gross_weight',
      'packages',
    ]);
  });

  it('rechaza campos que no son de este módulo y un ejemplo marcado como confirmado', () => {
    expect(() => parseExportDocuments({
      notice: 'Texto de prueba largo',
      countries: { GB: { phytosanitary: true } },
    })).toThrow(DomainError);
    const setting = exampleExportDocuments();
    const gb = setting.countries.GB;
    if (!gb) throw new Error('gb');
    gb.confirmed = true;
    expect(() => parseExportDocuments(setting)).toThrow(DomainError);
  });
});

describe('assessExport', () => {
  it('la factura completa con la regla de ejemplo queda lista y el certificado pendiente', () => {
    const result = assessExport(sampleInvoice(), exampleExportDocuments());
    expect(result.ready).toBe(true);
    expect(result.entity_eori_missing).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.confirmation_required).toBe(true);
    expect(result.example).toBe(true);
    expect(result.notice).toContain('EJEMPLO');
    expect(result.items.map((item) => [item.code, item.status, item.source])).toEqual([
      ['commercial_invoice', 'generated', 'invoice'],
      ['packing_list', 'generated', 'invoice'],
      ['certificate_of_origin', 'pending', 'external'],
    ]);
  });

  it('sin EORI de la entidad no está lista, con el mensaje de no emisión', () => {
    const result = assessExport(sampleInvoice({
      entity: { ...sampleInvoice().entity, eori: null },
    }), exampleExportDocuments());
    expect(result.ready).toBe(false);
    expect(result.entity_eori_missing).toBe(true);
    expect(result.missing[0]).toBe(ENTITY_EORI_MISSING);
    expect(result.items.every((item) => item.status === 'pending')).toBe(true);
  });

  it('un EORI de entidad con formato inválido no cuenta como ausente', () => {
    const result = assessExport(sampleInvoice({
      entity: { ...sampleInvoice().entity, eori: 'GB123' },
    }), confirmedGb());
    expect(result.entity_eori_missing).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.missing.some((item) => item.includes('entidad emisora') && item.includes('12 dígitos'))).toBe(true);
  });

  it('el EORI del cliente solo se exige si el país lo pide', () => {
    const required = assessExport(sampleInvoice({
      customer: { ...sampleInvoice().customer, eori: null },
    }), exampleExportDocuments());
    expect(required.missing).toContain('Falta el EORI del cliente.');

    const optional = withoutField('customer_eori');
    const result = assessExport(sampleInvoice({
      customer: { ...sampleInvoice().customer, eori: null },
    }), optional);
    expect(result.missing).not.toContain('Falta el EORI del cliente.');
    expect(result.ready).toBe(true);
  });

  it('informa en español cada dato que falta en las líneas de vino', () => {
    const invoice = sampleInvoice({
      incoterm: null,
      packages: null,
      origin_country: null,
      lines: [{
        ...sampleInvoice().lines[0]!,
        nc_code: null,
        unit_net_weight_g: null,
        unit_gross_weight_g: null,
      }, {
        line_no: 2,
        description: 'Camiseta',
        kind: 'other',
        quantity: '1',
        unit: 'ud',
        unit_price: '15.00',
        discount_pct: null,
        line_base: null,
        nc_code: null,
        origin_country: null,
        unit_net_weight_g: null,
        unit_gross_weight_g: null,
        sku: null,
        lot_code: null,
      }],
    });
    const result = assessExport(invoice, exampleExportDocuments());
    expect(result.missing).toEqual([
      'Falta el Incoterm.',
      'Falta el país de origen en la línea 1.',
      'Falta el número de bultos.',
      'Falta el código NC en la línea 1.',
      'Falta el peso neto del formato en la línea 1.',
      'Falta el peso bruto del formato en la línea 1.',
    ]);
  });

  it('el origen de la línea de vino basta si no hay origen de cabecera', () => {
    const line = { ...sampleInvoice().lines[0]!, origin_country: 'ES' };
    const result = assessExport(sampleInvoice({ origin_country: null, lines: [line] }), confirmedGb());
    expect(result.ready).toBe(true);
  });

  it('rechaza un Incoterm fuera de la lista del pedido y un peso neto mayor que el bruto', () => {
    const badTerm = assessExport(sampleInvoice({ incoterm: 'XXX' }), confirmedGb());
    expect(badTerm.missing.some((item) => item.includes('Incoterm'))).toBe(true);
    const line = { ...sampleInvoice().lines[0]!, unit_net_weight_g: 2000, unit_gross_weight_g: 1200 };
    const heavy = assessExport(sampleInvoice({ lines: [line] }), confirmedGb());
    expect(heavy.missing).toContain('El peso neto del formato supera al bruto en la línea 1.');
  });

  it('sin país configurado no inventa requisitos de otro destino', () => {
    const result = assessExport(sampleInvoice({ destination_country: 'US' }), exampleExportDocuments());
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([
      'No hay requisitos configurados para US. Pedro y el asesor deben confirmarlos.',
    ]);
    expect(result.items).toEqual([]);
    expect(result.confirmation_required).toBe(true);
  });

  it('la lista de bultos puede generarse sin precio si el país no pide factura comercial', () => {
    const setting = confirmedGb();
    const gb = setting.countries.GB;
    if (!gb) throw new Error('gb');
    gb.documents = gb.documents.filter((document) => document.code !== 'commercial_invoice');
    const line = { ...sampleInvoice().lines[0]!, unit_price: null, line_base: null };
    const result = assessExport(sampleInvoice({ lines: [line] }), setting);
    expect(result.ready).toBe(true);
    expect(result.items.find((item) => item.code === 'packing_list')?.status).toBe('generated');
  });

  it('falta el importe solo cuando hay que generar la factura comercial', () => {
    const line = { ...sampleInvoice().lines[0]!, unit_price: null, line_base: null };
    const result = assessExport(sampleInvoice({ lines: [line] }), confirmedGb());
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(['Falta el importe de la línea 1.']);
    expect(result.items.find((item) => item.code === 'commercial_invoice')?.status).toBe('pending');
    expect(result.items.find((item) => item.code === 'packing_list')?.status).toBe('generated');
  });
});

function withoutField(field: 'customer_eori'): ExportDocumentsSetting {
  const setting = confirmedGb();
  const gb = setting.countries.GB;
  if (!gb) throw new Error('gb');
  gb.required_fields = gb.required_fields.filter((item) => item !== field);
  return setting;
}
