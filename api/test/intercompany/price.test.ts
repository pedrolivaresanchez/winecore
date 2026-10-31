import { describe, expect, it } from 'bun:test';
import { intercompanyUnitPrice, rangesOverlap } from '../../src/core/intercompany/calendar';
import { money } from '../../src/core/money';

describe('precio intercompañía', () => {
  it('aplica base × (1 − descuento) con HALF_UP a 6 decimales', () => {
    expect(intercompanyUnitPrice(money.fromString('10'), money.fromString('60')).toFixed(6)).toBe('4.000000');
    expect(intercompanyUnitPrice(money.fromString('12.5'), money.fromString('60')).toFixed(6)).toBe('5.000000');
    expect(intercompanyUnitPrice(money.fromString('10'), money.fromString('33.33')).toFixed(6)).toBe('6.667000');
    expect(intercompanyUnitPrice(money.fromString('1.0000005'), money.fromString('0')).toFixed(6)).toBe('1.000001');
    expect(intercompanyUnitPrice(money.fromString('1.0000004'), money.fromString('0')).toFixed(6)).toBe('1.000000');
    expect(intercompanyUnitPrice(money.fromString('1.1111115'), money.fromString('0')).toFixed(6)).toBe('1.111112');
    expect(intercompanyUnitPrice(money.fromString('0.833333'), money.fromString('60')).toFixed(6)).toBe('0.333333');
  });

  it('trata la vigencia como intervalo semiabierto y rechaza el solape', () => {
    expect(rangesOverlap('2027-01-01', '2027-03-01', '2027-03-01', null)).toBe(false);
    expect(rangesOverlap('2027-01-01', '2027-03-02', '2027-03-01', null)).toBe(true);
    expect(rangesOverlap('2027-01-01', null, '2027-06-01', '2027-07-01')).toBe(true);
    expect(rangesOverlap('2027-01-01', '2027-02-01', '2027-02-01', '2027-03-01')).toBe(false);
  });
});
