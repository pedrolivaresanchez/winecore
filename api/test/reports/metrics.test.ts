import { describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import { money } from '../../src/core/money';
import { addYears, allocate, periodCuts, shiftKey } from '../../src/core/reports/metrics';

describe('informes · cifras', () => {
  it('reparte un importe y el residuo cae en la última línea', () => {
    const parts = allocate(money.fromString('10.00'), [
      new Decimal(1),
      new Decimal(1),
      new Decimal(1),
    ]);
    expect(parts.map((part) => money.toString(part))).toEqual(['3.33', '3.33', '3.34']);
    expect(money.toString(parts.reduce((acc, part) => money.add(acc, part)))).toBe('10.00');
  });

  it('conserva el signo de una rectificativa', () => {
    const parts = allocate(money.fromString('-24.20'), [new Decimal(-20)]);
    expect(money.toString(parts[0] ?? new Decimal(0))).toBe('-24.20');
  });

  it('retrocede un año y ajusta el 29 de febrero', () => {
    expect(addYears('2026-03-15', -1)).toBe('2025-03-15');
    expect(addYears('2024-02-29', -1)).toBe('2023-02-28');
    expect(shiftKey('month', '2026-03', -1)).toBe('2025-03');
    expect(shiftKey('product', 'abc', -1)).toBe('abc');
  });

  it('corta el stock en el fin de mes dentro del periodo', () => {
    expect(periodCuts('2026-01-15', '2026-03-02', 'month').map((cut) => cut.asOf)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-02',
    ]);
  });
});
