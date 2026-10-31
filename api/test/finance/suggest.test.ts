import { describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import { suggestForLine, type SuggestCandidate } from '../../src/core/finance/suggest';

function candidate(overrides: Partial<SuggestCandidate> = {}): SuggestCandidate {
  return {
    targetTable: 'billing.invoice',
    targetId: '11111111-1111-1111-1111-111111111111',
    documentNumber: 'FS26-0001',
    contactName: 'Cliente Ejemplo SL',
    outstanding: new Decimal('121.00'),
    direction: 'in',
    ...overrides,
  };
}

describe('sugerencias de conciliación', () => {
  it('pone delante el importe exacto con el número de factura y descarta el ruido', () => {
    const other = candidate({
      targetId: '22222222-2222-2222-2222-222222222222',
      documentNumber: 'FS26-0099',
      contactName: 'Otra Bodega SL',
      outstanding: new Decimal('121.00'),
    });
    const partial = candidate({
      targetId: '33333333-3333-3333-3333-333333333333',
      documentNumber: 'FS26-0002',
      outstanding: new Decimal('200.00'),
    });
    const ranked = suggestForLine({
      amount: '121.00',
      description: 'Transferencia factura FS26-0001 y FS26-0002',
      reference: null,
      counterpartyName: 'Cliente Ejemplo SL',
    }, [other, partial, candidate()]);
    expect(ranked[0]).toMatchObject({
      document_number: 'FS26-0001',
      score: '1.00',
      reason: 'importe exacto y número de factura',
    });
    expect(ranked.find((item) => item.document_number === 'FS26-0099')?.score).toBe('0.35');
    expect(ranked.find((item) => item.document_number === 'FS26-0002')?.reason).toContain('número de factura');
    expect(ranked.map((item) => item.score)).toEqual(['1.00', '0.65', '0.35']);
  });

  it('no cruza un cargo con una factura de cliente', () => {
    const ranked = suggestForLine({
      amount: '-121.00',
      description: 'Factura FS26-0001',
      reference: null,
      counterpartyName: null,
    }, [candidate()]);
    expect(ranked).toEqual([]);
  });

  it('no da confianza 1 si el número aparece dentro de otro número', () => {
    const ranked = suggestForLine({
      amount: '10.00',
      description: 'FS26-00019',
      reference: null,
      counterpartyName: null,
    }, [candidate({ documentNumber: 'FS26-0001', outstanding: new Decimal('10.00'), contactName: null })]);
    expect(ranked.every((item) => item.score !== '1.00')).toBe(true);
  });
});
