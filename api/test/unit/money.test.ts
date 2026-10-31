import { describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import { money } from '../../src/core/money';

describe('money', () => {
  it('redondea HALF_UP en el límite de 5 milésimas', () => {
    expect(money.toString(money.round2(money.fromString('1.005')))).toBe('1.01');
    expect(money.toString(money.round2(money.fromString('1.004')))).toBe('1.00');
    expect(money.toString(money.round2(money.fromString('2.675')))).toBe('2.68');
    expect(money.toString(money.round2(money.fromString('-1.005')))).toBe('-1.01');
  });

  it('suma y multiplica sin usar number de JS', () => {
    const total = money.round2(money.add(money.fromString('0.10'), money.fromString('0.20')));
    expect(money.toString(total)).toBe('0.30');
    expect(money.toString(money.round2(money.mul(money.fromString('1.005'), money.fromString('2'))))).toBe('2.01');
    expect(money.toString(money.sub(money.fromString('2.00'), money.fromString('0.005')))).toBe('2.00');
  });

  it('conserva el producto de cantidad, precio y descuento antes de redondear a céntimos', () => {
    // numeric(14,3) × numeric(14,6) is 28 digits. The global Decimal precision is 20,
    // so this product is only exact on the money clone (precision 40).
    // 12345678901.005 × (100000000 − 0.000001)
    //   = 1234567890100500000 − 12345.678901005
    //   = 1234567890100487654.321098995
    // × (1 − 50/100) = 617283945050243827.1605494975
    // half-up to 2 dp → 617283945050243827.16
    const qty = new Decimal('12345678901.005');
    const price = new Decimal('99999999.999999');
    const gross = money.mul(qty, price);
    expect(gross.toString()).toBe('1234567890100487654.321098995');
    const factor = money.sub(money.fromString('1'), money.mul(money.fromString('50'), money.fromString('0.01')));
    const raw = money.mul(gross, factor);
    expect(raw.toString()).toBe('617283945050243827.1605494975');
    expect(money.toString(raw)).toBe('617283945050243827.16');
    expect(Decimal.precision).toBe(20);
  });
});
