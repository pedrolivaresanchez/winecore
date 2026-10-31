import { describe, expect, it } from 'bun:test';
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
});
