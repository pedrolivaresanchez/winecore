import { sql } from '../../src/core/db/sql';
import type { Tx } from '../../src/core/db/writer';
import { newId } from '../../src/core/ids';
import { parsePeriod, type Period } from '../../src/core/aeat/period';
import type { EntityProfile, FiscalPack, IssuedDoc, ReceivedDoc, TaxSlice } from '../../src/core/aeat/types';

const SERIES = '019a1000-0000-7000-8000-0000000000aa';

export const CONTACT = {
  varios: '019a1000-0000-7000-8000-000000000001',
  export: '019a1000-0000-7000-8000-000000000002',
  intra: '019a1000-0000-7000-8000-000000000003',
  rect: '019a1000-0000-7000-8000-000000000004',
  re: '019a1000-0000-7000-8000-000000000005',
  rent: '019a1000-0000-7000-8000-000000000006',
  grande: '019a1000-0000-7000-8000-000000000007',
  q2: '019a1000-0000-7000-8000-000000000008',
  uva: '019a1000-0000-7000-8000-000000000011',
  diez: '019a1000-0000-7000-8000-000000000012',
  rentS: '019a1000-0000-7000-8000-000000000013',
  grandeS: '019a1000-0000-7000-8000-000000000014',
  intraS: '019a1000-0000-7000-8000-000000000015',
} as const;

export const DOC = {
  varios21: '019a1001-0000-7000-8000-000000000001',
  varios10: '019a1001-0000-7000-8000-000000000002',
  varios4: '019a1001-0000-7000-8000-000000000003',
  varios0: '019a1001-0000-7000-8000-000000000004',
  export: '019a1001-0000-7000-8000-000000000005',
  intra: '019a1001-0000-7000-8000-000000000006',
  rect: '019a1001-0000-7000-8000-000000000007',
  re: '019a1001-0000-7000-8000-000000000008',
  rent: '019a1001-0000-7000-8000-000000000009',
  grande: '019a1001-0000-7000-8000-000000000010',
  q2: '019a1001-0000-7000-8000-000000000011',
  uva: '019a1001-0000-7000-8000-000000000021',
  diez: '019a1001-0000-7000-8000-000000000022',
  rentS: '019a1001-0000-7000-8000-000000000023',
  grandeS: '019a1001-0000-7000-8000-000000000024',
  intraS: '019a1001-0000-7000-8000-000000000025',
  cash: '019a1001-0000-7000-8000-000000000031',
} as const;

function tax(input: Partial<TaxSlice> & Pick<TaxSlice, 'taxCode' | 'base' | 'quota' | 'rate'>): TaxSlice {
  return {
    regimeKey: '01',
    surchargeRate: '0.00',
    surchargeQuota: '0.00',
    exemption: null,
    qualification: 'S1',
    withholding: '0.00',
    ...input,
  };
}

function issued(input: Omit<IssuedDoc, 'verifactuStatus' | 'verifactuCsv' | 'rectified' | 'operationDate' | 'includeIn347'> & Partial<IssuedDoc>): IssuedDoc {
  return {
    operationDate: null,
    includeIn347: true,
    verifactuStatus: null,
    verifactuCsv: null,
    rectified: [],
    ...input,
  };
}

export function yearPack(entity: EntityProfile): FiscalPack {
  const period = parsePeriod('2026');
  if (!period) throw new Error('periodo');
  const issuedDocs: IssuedDoc[] = [
    issued({
      id: DOC.varios21, number: 'F-2026-0001', issueDate: '2026-02-10', invoiceType: 'F1',
      customerId: CONTACT.varios, customerName: 'Cliente Varios SL', customerTaxId: 'B00000021', customerCountry: 'ES',
      subtotal: '1000.00', taxTotal: '210.00', surchargeTotal: '0.00', withholdingTotal: '0.00', total: '1210.00',
      taxes: [tax({ taxCode: 'IVA21', rate: '21.00', base: '1000.00', quota: '210.00' })],
    }),
    issued({
      id: DOC.varios10, number: 'F-2026-0002', issueDate: '2026-02-11', invoiceType: 'F1',
      customerId: CONTACT.varios, customerName: 'Cliente Varios SL', customerTaxId: 'B00000021', customerCountry: 'ES',
      subtotal: '100.00', taxTotal: '10.00', surchargeTotal: '0.00', withholdingTotal: '0.00', total: '110.00',
      taxes: [tax({ taxCode: 'IVA10', rate: '10.00', base: '100.00', quota: '10.00' })],
    }),
    issued({
      id: DOC.varios4, number: 'F-2026-0003', issueDate: '2026-02-12', invoiceType: 'F1',
      customerId: CONTACT.varios, customerName: 'Cliente Varios SL', customerTaxId: 'B00000021', customerCountry: 'ES',
      subtotal: '50.00', taxTotal: '2.00', surchargeTotal: '0.00', withholdingTotal: '0.00', total: '52.00',
      taxes: [tax({ taxCode: 'IVA4', rate: '4.00', base: '50.00', quota: '2.00' })],
    }),
    issued({
      id: DOC.varios0, number: 'F-2026-0004', issueDate: '2026-02-13', invoiceType: 'F1',
      customerId: CONTACT.varios, customerName: 'Cliente Varios SL', customerTaxId: 'B00000021', customerCountry: 'ES',
      subtotal: '25.00', taxTotal: '0.00', surchargeTotal: '0.00', withholdingTotal: '0.00', total: '25.00',
      taxes: [tax({ taxCode: 'IVA0', rate: '0.00', base: '25.00', quota: '0.00' })],
    }),
    issued({
      id: DOC.export, number: 'F-2026-0005', issueDate: '2026-02-14', invoiceType: 'F1',
      customerId: CONTACT.export, customerName: 'Cliente Export SL', customerTaxId: 'B00000022', customerCountry: 'GB',
      subtotal: '400.00', taxTotal: '0.00', surchargeTotal: '0.00', withholdingTotal: '0.00', total: '400.00',
      taxes: [tax({ taxCode: 'EXP_E2', rate: '0.00', base: '400.00', quota: '0.00', regimeKey: '02', qualification: null, exemption: 'E2' })],
    }),
    issued({
      id: DOC.intra, number: 'F-2026-0006', issueDate: '2026-02-15', invoiceType: 'F1',
      customerId: CONTACT.intra, customerName: 'Cliente Intra EU', customerTaxId: 'DE123456789', customerCountry: 'DE',
      subtotal: '5000.00', taxTotal: '0.00', surchargeTotal: '0.00', withholdingTotal: '0.00', total: '5000.00',
      taxes: [tax({ taxCode: 'INTRA_E5', rate: '0.00', base: '5000.00', quota: '0.00', qualification: null, exemption: 'E5' })],
    }),
    issued({
      id: DOC.rect, number: 'R-2026-0001', issueDate: '2026-02-20', invoiceType: 'R1',
      customerId: CONTACT.rect, customerName: 'Cliente Rectificativa SL', customerTaxId: 'B00000023', customerCountry: 'ES',
      subtotal: '-100.00', taxTotal: '-21.00', surchargeTotal: '0.00', withholdingTotal: '0.00', total: '-121.00',
      rectified: [{ number: 'F-2025-0001', issueDate: '2025-11-20' }],
      taxes: [tax({ taxCode: 'IVA21', rate: '21.00', base: '-100.00', quota: '-21.00' })],
    }),
    issued({
      id: DOC.re, number: 'F-2026-0007', issueDate: '2026-03-01', invoiceType: 'F1',
      customerId: CONTACT.re, customerName: 'Cliente Recargo SL', customerTaxId: 'B00000024', customerCountry: 'ES',
      subtotal: '200.00', taxTotal: '42.00', surchargeTotal: '10.40', withholdingTotal: '0.00', total: '252.40',
      taxes: [tax({ taxCode: 'IVA21_RE', rate: '21.00', base: '200.00', quota: '42.00', regimeKey: '18', surchargeRate: '5.20', surchargeQuota: '10.40' })],
    }),
    issued({
      id: DOC.rent, number: 'F-2026-0008', issueDate: '2026-03-02', invoiceType: 'F1',
      customerId: CONTACT.rent, customerName: 'Cliente Alquiler SL', customerTaxId: 'B00000025', customerCountry: 'ES',
      subtotal: '3000.00', taxTotal: '630.00', surchargeTotal: '0.00', withholdingTotal: '570.00', total: '3060.00',
      taxes: [tax({ taxCode: 'IVA21_ALQ', rate: '21.00', base: '3000.00', quota: '630.00', regimeKey: '11', withholding: '570.00' })],
    }),
    issued({
      id: DOC.grande, number: 'F-2026-0009', issueDate: '2026-03-10', invoiceType: 'F1',
      customerId: CONTACT.grande, customerName: 'Cliente Grande SL', customerTaxId: 'B00000026', customerCountry: 'ES',
      subtotal: '4000.00', taxTotal: '840.00', surchargeTotal: '0.00', withholdingTotal: '0.00', total: '4840.00',
      taxes: [tax({ taxCode: 'IVA21', rate: '21.00', base: '4000.00', quota: '840.00' })],
    }),
    issued({
      id: DOC.q2, number: 'F-2026-0010', issueDate: '2026-04-15', invoiceType: 'F1',
      customerId: CONTACT.q2, customerName: 'Cliente Trimestre Dos SL', customerTaxId: 'B00000027', customerCountry: 'ES',
      subtotal: '10.00', taxTotal: '2.10', surchargeTotal: '0.00', withholdingTotal: '0.00', total: '12.10',
      taxes: [tax({ taxCode: 'IVA21', rate: '21.00', base: '10.00', quota: '2.10' })],
    }),
  ];
  const received: ReceivedDoc[] = [
    receivedDoc({
      id: DOC.uva, number: 'P-100', issueDate: '2026-01-20', accountingDate: '2026-01-31',
      categoryCode: 'grapes', categoryName: 'Compra de uva', supplierId: CONTACT.uva,
      supplierName: 'Proveedor Uva SL', supplierTaxId: 'B00000031', supplierTaxIdType: 'nif', supplierCountry: 'ES',
      supplierVatRegime: 'general', subtotal: '500.00', taxTotal: '105.00', withholdingTotal: '0.00', total: '605.00',
      lines: [{ rate: '21.00', base: '500.00', quota: '105.00', withholdingRate: '0.00', deductiblePct: '100.00' }],
    }),
    receivedDoc({
      id: DOC.diez, number: 'P-101', issueDate: '2026-02-02', accountingDate: '2026-02-02',
      categoryCode: 'other_services', categoryName: 'Otros servicios', supplierId: CONTACT.diez,
      supplierName: 'Proveedor Diez SL', supplierTaxId: 'B00000032', supplierTaxIdType: 'nif', supplierCountry: 'ES',
      supplierVatRegime: 'general', subtotal: '80.00', taxTotal: '8.00', withholdingTotal: '0.00', total: '88.00',
      lines: [{ rate: '10.00', base: '80.00', quota: '8.00', withholdingRate: '0.00', deductiblePct: '100.00' }],
    }),
    receivedDoc({
      id: DOC.rentS, number: 'P-102', issueDate: '2026-02-28', accountingDate: '2026-02-28',
      categoryCode: 'rent', categoryName: 'Arrendamientos', supplierId: CONTACT.rentS,
      supplierName: 'Proveedor Alquiler SL', supplierTaxId: 'B00000033', supplierTaxIdType: 'nif', supplierCountry: 'ES',
      supplierVatRegime: 'general', subtotal: '4000.00', taxTotal: '840.00', withholdingTotal: '760.00', total: '4080.00',
      lines: [{ rate: '21.00', base: '4000.00', quota: '840.00', withholdingRate: '19.00', deductiblePct: '100.00' }],
    }),
    receivedDoc({
      id: DOC.grandeS, number: 'P-103', issueDate: '2026-03-05', accountingDate: '2026-03-05',
      categoryCode: 'packaging', categoryName: 'Envases', supplierId: CONTACT.grandeS,
      supplierName: 'Proveedor Grande SL', supplierTaxId: 'B00000034', supplierTaxIdType: 'nif', supplierCountry: 'ES',
      supplierVatRegime: 'general', subtotal: '4000.00', taxTotal: '840.00', withholdingTotal: '0.00', total: '4840.00',
      lines: [{ rate: '21.00', base: '4000.00', quota: '840.00', withholdingRate: '0.00', deductiblePct: '100.00' }],
    }),
    receivedDoc({
      id: DOC.intraS, number: 'P-104', issueDate: '2026-03-12', accountingDate: '2026-03-12',
      categoryCode: 'bulk_wine', categoryName: 'Vino a granel', supplierId: CONTACT.intraS,
      supplierName: 'Proveedor Intra EU', supplierTaxId: 'FR123456789', supplierTaxIdType: 'vat_eu', supplierCountry: 'FR',
      supplierVatRegime: 'intra_eu', subtotal: '5000.00', taxTotal: '1050.00', withholdingTotal: '0.00', total: '6050.00',
      lines: [{ rate: '21.00', base: '5000.00', quota: '1050.00', withholdingRate: '0.00', deductiblePct: '100.00' }],
    }),
  ];
  return {
    entity,
    period,
    issued: issuedDocs,
    received,
    cash: [{
      id: DOC.cash,
      counterpartyId: CONTACT.varios,
      name: 'Cliente Varios SL',
      taxId: 'B00000021',
      country: 'ES',
      includeIn347: true,
      amount: '150.00',
      valueDate: '2026-03-01',
    }],
    verifactuEnabled: false,
  };
}

function receivedDoc(input: Omit<ReceivedDoc, 'includeIn347'> & { includeIn347?: boolean }): ReceivedDoc {
  return { includeIn347: true, ...input };
}

export function slicePack(pack: FiscalPack, period: Period): FiscalPack {
  return {
    ...pack,
    period,
    issued: pack.issued.filter((doc) => doc.issueDate >= period.from && doc.issueDate <= period.to),
    received: pack.received.filter((doc) => doc.accountingDate >= period.from && doc.accountingDate <= period.to),
    cash: pack.cash.filter((row) => row.valueDate >= period.from && row.valueDate <= period.to),
  };
}

export async function insertSample(tx: Tx, entityId: string, userId: string): Promise<void> {
  tx.write(sql`
    INSERT INTO billing.tax_code (code, name_es, tax, regime_key, qualification, exemption, rate, surcharge_rate, withholding_rate, requires_vat_id)
    SELECT * FROM (VALUES
      ('IVA10', 'IVA reducido 10 %', '01', '01', 'S1', NULL, 10, 0, 0, false),
      ('IVA4', 'IVA superreducido 4 %', '01', '01', 'S1', NULL, 4, 0, 0, false),
      ('IVA0', 'IVA 0 %', '01', '01', 'S1', NULL, 0, 0, 0, false)
    ) AS v(code, name_es, tax, regime_key, qualification, exemption, rate, surcharge_rate, withholding_rate, requires_vat_id)
    WHERE NOT EXISTS (SELECT 1 FROM billing.tax_code t WHERE t.code = v.code)
  `);
  const contacts: [string, string, string, string, string, string, boolean, boolean][] = [
    [CONTACT.varios, 'Cliente Varios SL', 'B00000021', 'nif', 'ES', 'general', true, false],
    [CONTACT.export, 'Cliente Export SL', 'B00000022', 'nif', 'GB', 'export', true, false],
    [CONTACT.intra, 'Cliente Intra EU', 'DE123456789', 'vat_eu', 'DE', 'intra_eu', true, false],
    [CONTACT.rect, 'Cliente Rectificativa SL', 'B00000023', 'nif', 'ES', 'general', true, false],
    [CONTACT.re, 'Cliente Recargo SL', 'B00000024', 'nif', 'ES', 'equivalence_surcharge', true, false],
    [CONTACT.rent, 'Cliente Alquiler SL', 'B00000025', 'nif', 'ES', 'general', true, false],
    [CONTACT.grande, 'Cliente Grande SL', 'B00000026', 'nif', 'ES', 'general', true, false],
    [CONTACT.q2, 'Cliente Trimestre Dos SL', 'B00000027', 'nif', 'ES', 'general', true, false],
    [CONTACT.uva, 'Proveedor Uva SL', 'B00000031', 'nif', 'ES', 'general', false, true],
    [CONTACT.diez, 'Proveedor Diez SL', 'B00000032', 'nif', 'ES', 'general', false, true],
    [CONTACT.rentS, 'Proveedor Alquiler SL', 'B00000033', 'nif', 'ES', 'general', false, true],
    [CONTACT.grandeS, 'Proveedor Grande SL', 'B00000034', 'nif', 'ES', 'general', false, true],
    [CONTACT.intraS, 'Proveedor Intra EU', 'FR123456789', 'vat_eu', 'FR', 'intra_eu', false, true],
  ];
  for (const [id, name, taxId, taxType, country, regime, customer, supplier] of contacts) {
    tx.write(sql`
      INSERT INTO party.contact (
        id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code,
        is_customer, is_supplier, vat_regime, include_in_m347, created_by
      ) VALUES (
        CAST(${id} AS UUID), 'company', ${name}, ${taxId}, ${taxType}, ${country}, ${country},
        ${customer}, ${supplier}, ${regime}, true, ${userId}
      )
    `);
  }
  const entity = { id: entityId, code: 'PO', personType: 'natural' as const, incomeTax: 'IRPF' as const };
  const pack = yearPack(entity);
  for (const doc of pack.issued) {
    tx.write(sql`
      INSERT INTO billing.invoice (
        id, legal_entity_id, series_id, number, status, invoice_type, rectification_kind,
        issue_date, customer_id, customer_snapshot, subtotal, tax_total, surcharge_total,
        withholding_total, total, issued_at, created_by
      ) VALUES (
        CAST(${doc.id} AS UUID), CAST(${entityId} AS UUID), CAST(${SERIES} AS UUID), ${doc.number},
        'issued', ${doc.invoiceType}, ${doc.invoiceType.startsWith('R') ? 'S' : null},
        CAST(${doc.issueDate} AS DATE), CAST(${doc.customerId} AS UUID),
        ${sql.json({ name: doc.customerName, tax_id: doc.customerTaxId, country: doc.customerCountry })},
        ${doc.subtotal}, ${doc.taxTotal}, ${doc.surchargeTotal}, ${doc.withholdingTotal}, ${doc.total},
        TIMESTAMPTZ '2026-03-15 10:00:00+00', ${userId}
      )
    `);
    for (const slice of doc.taxes) {
      tx.write(sql`
        INSERT INTO billing.invoice_tax (
          id, invoice_id, tax_code, tax, regime_key, qualification, exemption, rate, base, quota,
          surcharge_rate, surcharge_quota, withholding_rate, withholding
        ) VALUES (
          CAST(${newId()} AS UUID), CAST(${doc.id} AS UUID), ${slice.taxCode}, '01', ${slice.regimeKey},
          ${slice.qualification}, ${slice.exemption}, ${slice.rate}, ${slice.base}, ${slice.quota},
          ${slice.surchargeRate}, ${slice.surchargeQuota},
          ${slice.withholding === '570.00' ? '19.00' : '0.00'}, ${slice.withholding}
        )
      `);
    }
    for (const rect of doc.rectified) {
      tx.write(sql`
        INSERT INTO billing.invoice_rectification (
          id, rectifying_invoice_id, rectified_number, rectified_issue_date, rectified_issuer_tax_id, relation, reason
        ) VALUES (
          CAST(${newId()} AS UUID), CAST(${doc.id} AS UUID), ${rect.number}, CAST(${rect.issueDate} AS DATE),
          (SELECT tax_id FROM core.legal_entity WHERE id = CAST(${entityId} AS UUID)),
          'rectified', 'Rectificacion sintetica'
        )
      `);
    }
  }
  for (const doc of pack.received) {
    tx.write(sql`
      INSERT INTO purchasing.supplier_invoice (
        id, legal_entity_id, supplier_id, supplier_invoice_number, issue_date, accounting_date,
        source, status, category_code, subtotal, tax_total, withholding_total, total,
        approved_by, approved_at, created_by
      ) VALUES (
        CAST(${doc.id} AS UUID), CAST(${entityId} AS UUID), CAST(${doc.supplierId} AS UUID), ${doc.number},
        CAST(${doc.issueDate} AS DATE), CAST(${doc.accountingDate} AS DATE),
        'upload', 'approved', ${doc.categoryCode}, ${doc.subtotal}, ${doc.taxTotal}, ${doc.withholdingTotal}, ${doc.total},
        CAST(${userId} AS UUID), TIMESTAMPTZ '2026-03-20 10:00:00+00', ${userId}
      )
    `);
    doc.lines.forEach((line, index) => {
      const account = doc.categoryCode === 'rent' ? '621' : '600';
      tx.write(sql`
        INSERT INTO purchasing.supplier_invoice_line (
          id, supplier_invoice_id, line_no, description, expense_account, quantity, unit_price,
          line_base, vat_rate, vat_deductible_pct, vat_quota, withholding_rate
        ) VALUES (
          CAST(${newId()} AS UUID), CAST(${doc.id} AS UUID), ${index + 1}, ${doc.categoryName}, ${account},
          1, ${line.base}, ${line.base}, ${line.rate}, ${line.deductiblePct}, ${line.quota}, ${line.withholdingRate}
        )
      `);
    });
  }
  for (const payment of pack.cash) {
    tx.write(sql`
      INSERT INTO finance.payment (
        id, legal_entity_id, direction, method, amount, value_date, counterparty_id, source, status, created_by
      ) VALUES (
        CAST(${payment.id} AS UUID), CAST(${entityId} AS UUID), 'in', 'cash', ${payment.amount},
        CAST(${payment.valueDate} AS DATE), CAST(${payment.counterpartyId} AS UUID), 'manual', 'registered', ${userId}
      )
    `);
  }
}
