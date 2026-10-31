import { describe, expect, it } from 'bun:test';
import { buildDraft, buildIssuedBook, bookCsv, THRESHOLD_347 } from '../../src/core/aeat/compute';
import { parsePeriod } from '../../src/core/aeat/period';
import type { EntityProfile, FiscalPack, IssuedDoc } from '../../src/core/aeat/types';
import { DOC, slicePack, yearPack } from './fixture';

const po: EntityProfile = { id: '019a0000-0000-7000-8000-000000000001', code: 'PO', personType: 'natural', incomeTax: 'IRPF' };
const cvpo: EntityProfile = { id: '019a0000-0000-7000-8000-000000000002', code: 'CVPO', personType: 'legal', incomeTax: 'IS' };

function period(token: string) {
  const parsed = parsePeriod(token);
  if (!parsed) throw new Error(token);
  return parsed;
}

function box(draft: { boxes: { code: string; amount: string }[] }, code: string): string {
  return draft.boxes.find((item) => item.code === code)?.amount ?? 'missing';
}

describe('borradores AEAT', () => {
  const year = yearPack(po);
  const q1 = slicePack(year, period('2026-Q1'));

  it('cuadra el 303 del trimestre con libros, tipos y rectificativas', () => {
    const draft = buildDraft('303', q1);
    expect(box(draft, '01')).toBe('50.00');
    expect(box(draft, '03')).toBe('2.00');
    expect(box(draft, '04')).toBe('100.00');
    expect(box(draft, '06')).toBe('10.00');
    expect(box(draft, '07')).toBe('8100.00');
    expect(box(draft, '09')).toBe('1701.00');
    expect(box(draft, 'base_0')).toBe('25.00');
    expect(box(draft, 'cuota_0')).toBe('0.00');
    expect(box(draft, 'exenta_e2')).toBe('400.00');
    expect(box(draft, 'exenta_e5')).toBe('5000.00');
    expect(box(draft, '10')).toBe('5000.00');
    expect(box(draft, '11')).toBe('1050.00');
    expect(box(draft, 're_52')).toBe('10.40');
    expect(box(draft, 'deducible')).toBe('2843.00');
    expect(draft.result).toBe('-69.60');
    expect(draft.documents.some((doc) => doc.id === DOC.rect)).toBe(true);
    expect(draft.documents.some((doc) => doc.id === DOC.q2)).toBe(false);
    expect(draft.reconciliation.every((row) => row.ok)).toBe(true);
    const book = buildIssuedBook(q1);
    expect(book.checks.every((check) => check.ok)).toBe(true);
    expect(book.totals.base).toBe('13675.00');
    const csv = bookCsv(book);
    expect(csv.startsWith('\uFEFFEjercicio;Periodo;Fecha de expedición;')).toBe(true);
    expect(csv).toContain('1000,00');
    expect(csv).toContain('10,40');
    expect(csv).toContain('F-2025-0001 (20/11/2025)');
    expect(csv).not.toContain('1000.00');
  });

  it('el 390 suma el ejercicio, incluido el segundo trimestre', () => {
    const draft = buildDraft('390', slicePack(year, period('2026')));
    expect(box(draft, '07')).toBe('8110.00');
    expect(box(draft, '09')).toBe('1703.10');
    expect(draft.result).toBe('-67.50');
    expect(draft.reconciliation.every((row) => row.ok)).toBe(true);
  });

  it('el 347 deja fuera el 349, las retenciones y lo que no supera 3.005,06', () => {
    const draft = buildDraft('347', slicePack(year, period('2026')));
    const declared = draft.lines.filter((line) => line.clave !== 'C');
    expect(declared.map((line) => line.tax_id).sort()).toEqual(['B00000026', 'B00000034']);
    const sale = declared.find((line) => line.clave === 'B');
    expect(sale?.annual).toBe('4840.00');
    expect(sale?.q1).toBe('4840.00');
    expect(sale?.q2).toBe('0.00');
    const purchase = declared.find((line) => line.clave === 'A');
    expect(purchase?.annual).toBe('4840.00');
    const cash = draft.lines.find((line) => line.clave === 'C');
    expect(cash?.annual).toBe('150.00');
    expect(draft.excluded.some((row) => row.id === DOC.intra && row.reason.includes('349'))).toBe(true);
    expect(draft.excluded.some((row) => row.id === DOC.rent && row.reason.includes('retención'))).toBe(true);
    expect(draft.excluded.some((row) => row.id === DOC.rentS)).toBe(true);
    expect(draft.excluded.some((row) => row.id === DOC.intraS)).toBe(true);
    expect(draft.documents.some((doc) => doc.id === DOC.intra)).toBe(false);
    expect(THRESHOLD_347).toBe('3005.06');
  });

  it('el umbral del 347 es estricto', () => {
    const below = thresholdPack('3005.06');
    const above = thresholdPack('3005.07');
    expect(buildDraft('347', below).lines.filter((line) => line.clave === 'B')).toHaveLength(0);
    expect(buildDraft('347', above).lines.filter((line) => line.clave === 'B')).toHaveLength(1);
  });

  it('el 349 agrupa entregas y adquisiciones por NIF-IVA', () => {
    const draft = buildDraft('349', q1);
    const supply = draft.lines.find((line) => line.clave === 'E');
    const acquisition = draft.lines.find((line) => line.clave === 'A');
    expect(supply?.tax_id).toBe('DE123456789');
    expect(supply?.annual).toBe('5000.00');
    expect(supply?.q1).toBe('5000.00');
    expect(acquisition?.tax_id).toBe('FR123456789');
    expect(acquisition?.annual).toBe('5000.00');
    expect(draft.reconciliation.every((row) => row.ok)).toBe(true);
  });

  it('el 115 solo toma arrendamientos recibidos con retención', () => {
    const draft = buildDraft('115', q1);
    expect(box(draft, 'base')).toBe('4000.00');
    expect(box(draft, 'cuota')).toBe('760.00');
    expect(draft.lines[0]?.rate).toBe('19.00');
    expect(draft.lines[0]?.tax_id).toBe('B00000033');
    expect(draft.excluded.some((row) => row.id === DOC.rent)).toBe(true);
    expect(draft.documents.some((doc) => doc.id === DOC.rent)).toBe(false);
    expect(draft.reconciliation.every((row) => row.ok)).toBe(true);
  });

  it('el 130 de P.O da ingresos y gastos y deja la cuota en falta', () => {
    const draft = buildDraft('130', q1);
    expect(draft.applies).toBe(true);
    expect(box(draft, 'ingresos')).toBe('13675.00');
    expect(box(draft, 'gastos')).toBe('13580.00');
    expect(box(draft, 'retenciones')).toBe('570.00');
    expect(draft.result).toBeNull();
    expect(draft.missing.map((item) => item.code).sort()).toEqual(['cuota', 'pagos_anteriores']);
    expect(draft.reconciliation.every((row) => row.ok)).toBe(true);
    const ytd = slicePack(year, { ...period('2026-Q2'), from: '2026-01-01' });
    const later = buildDraft('130', ytd);
    expect(box(later, 'ingresos')).toBe('13685.00');
    expect(box(later, 'ingresos_2t')).toBe('10.00');
  });

  it('el 130 no aplica a una sociedad', () => {
    const draft = buildDraft('130', { ...q1, entity: cvpo });
    expect(draft.applies).toBe(false);
    expect(draft.result).toBeNull();
    expect(draft.missing[0]?.code).toBe('no_aplica');
    expect(draft.boxes).toEqual([]);
  });

  it('con Verifactu encendido un libro sin registros no se exporta', () => {
    const book = buildIssuedBook({ ...q1, verifactuEnabled: true });
    expect(book.checks.find((check) => check.name === 'verifactu')?.ok).toBe(false);
  });
});

function thresholdPack(base: string): FiscalPack {
  const doc: IssuedDoc = {
    id: '019a1001-0000-7000-8000-000000000099',
    number: 'F-UMBRAL',
    issueDate: '2026-05-01',
    operationDate: null,
    invoiceType: 'F1',
    customerId: '019a1000-0000-7000-8000-000000000099',
    customerName: 'Cliente Umbral SL',
    customerTaxId: 'B00000099',
    customerCountry: 'ES',
    includeIn347: true,
    subtotal: base,
    taxTotal: '0.00',
    surchargeTotal: '0.00',
    withholdingTotal: '0.00',
    total: base,
    verifactuStatus: null,
    verifactuCsv: null,
    rectified: [],
    taxes: [{
      taxCode: 'IVA0',
      regimeKey: '01',
      rate: '0.00',
      base,
      quota: '0.00',
      surchargeRate: '0.00',
      surchargeQuota: '0.00',
      exemption: null,
      qualification: 'S1',
      withholding: '0.00',
    }],
  };
  return {
    entity: po,
    period: period('2026'),
    issued: [doc],
    received: [],
    cash: [],
    verifactuEnabled: false,
  };
}
