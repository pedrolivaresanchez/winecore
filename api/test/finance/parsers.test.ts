import { describe, expect, it } from 'bun:test';
import { DomainError } from '../../src/core/errors';
import { parseCamt053 } from '../../src/core/finance/camt053';
import { parseN43 } from '../../src/core/finance/n43';
import { camtEntry, camtStatement, n43AccountHeader, n43Movement } from './files';

describe('Norma 43', () => {
  it('lee abono, cargo y concepto complementario', () => {
    const file = [
      n43AccountHeader('0000000001', '2026-10-01', '2026-10-31'),
      n43Movement({
        bookingDate: '2026-10-15',
        valueDate: '2026-10-16',
        amount: '121.00',
        document: 'FS26-0001',
        concept: 'Factura FS26-0001',
      }),
      n43Movement({ bookingDate: '2026-10-17', amount: '-40.50', credit: false, document: 'PR-9' }),
      '880000000000000000000001',
    ].join('\n');
    const parsed = parseN43(file);
    expect(parsed.movements).toHaveLength(2);
    expect(parsed.periodFrom).toBe('2026-10-01');
    expect(parsed.periodTo).toBe('2026-10-31');
    expect(parsed.movements[0]).toMatchObject({
      bookingDate: '2026-10-15',
      valueDate: '2026-10-16',
      amount: '121.00',
      accountLast4: '0001',
      description: 'Factura FS26-0001',
    });
    expect(parsed.movements[0]?.reference).toContain('FS26-0001');
    expect(parsed.movements[1]?.amount).toBe('-40.50');
  });

  it('rechaza un fichero sin apuntes', () => {
    expect(() => parseN43('110099000100000000012610012610312' + '0'.repeat(40))).toThrow(DomainError);
  });
});

describe('CAMT.053', () => {
  it('lee el abono, la referencia bancaria y el texto de la remesa', () => {
    const xml = camtStatement(camtEntry({
      amount: '80.50',
      bookingDate: '2026-10-20',
      reference: 'REF-BANCO-1',
      remittance: 'Factura PR-1001',
      counterparty: 'Proveedor Ejemplo SL',
      credit: false,
    }), '2026-10-01', '2026-10-31');
    const parsed = parseCamt053(xml);
    expect(parsed.format).toBe('camt053');
    expect(parsed.movements[0]).toMatchObject({
      amount: '-80.50',
      bookingDate: '2026-10-20',
      counterpartyName: 'Proveedor Ejemplo SL',
    });
    expect(parsed.movements[0]?.reference).toContain('REF-BANCO-1');
    expect(parsed.movements[0]?.description).toContain('PR-1001');
    expect(parsed.movements[0]?.fingerprint).toContain('REF-BANCO-1');
  });

  it('rechaza un XML que no es un extracto', () => {
    expect(() => parseCamt053('<Document><Otro/></Document>')).toThrow(DomainError);
  });
});
