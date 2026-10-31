import { describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import { allocationError, addCalendarDays, ageingOf } from '../../src/core/finance/support';
import { isCreditorId, sepaCreditorId } from '../../src/core/finance/sepa';

const amount = (value: string) => new Decimal(value);

describe('imputación', () => {
  it('deja pasar un cobro parcial y rechaza el exceso antes que el documento no cobrable', () => {
    expect(allocationError({
      paymentAmount: amount('100.00'),
      alreadyAllocated: amount('0.00'),
      adding: amount('100.00'),
      payable: true,
      outstanding: amount('121.00'),
    })).toBeNull();
    expect(allocationError({
      paymentAmount: amount('100.00'),
      alreadyAllocated: amount('60.00'),
      adding: amount('50.00'),
      payable: true,
      outstanding: amount('200.00'),
    })).toBe('WC100');
    expect(allocationError({
      paymentAmount: amount('50.00'),
      alreadyAllocated: amount('0.00'),
      adding: amount('50.00'),
      payable: true,
      outstanding: amount('21.00'),
    })).toBe('WC100');
    expect(allocationError({
      paymentAmount: amount('100.00'),
      alreadyAllocated: amount('0.00'),
      adding: amount('10.00'),
      payable: false,
      outstanding: amount('10.00'),
    })).toBe('WC101');
    expect(allocationError({
      paymentAmount: amount('10.00'),
      alreadyAllocated: amount('10.00'),
      adding: amount('1.00'),
      payable: false,
      outstanding: amount('0.00'),
    })).toBe('WC100');
  });
});

describe('antigüedad', () => {
  const today = '2026-10-31';

  it('clasifica los límites 30, 60 y 90 y no marca vencido lo que vence hoy', () => {
    expect(ageingOf(today, '2026-10-01', today)).toMatchObject({ bucket: '0-30', days: 0, isOverdue: false });
    expect(ageingOf(addCalendarDays(today, -1), '2026-09-01', today)).toMatchObject({ bucket: '0-30', days: 1, isOverdue: true });
    expect(ageingOf(addCalendarDays(today, -30), '2026-09-01', today)).toMatchObject({ bucket: '0-30', days: 30, isOverdue: true });
    expect(ageingOf(addCalendarDays(today, -31), '2026-08-01', today)).toMatchObject({ bucket: '31-60', days: 31, isOverdue: true });
    expect(ageingOf(addCalendarDays(today, -60), '2026-08-01', today)).toMatchObject({ bucket: '31-60', days: 60, isOverdue: true });
    expect(ageingOf(addCalendarDays(today, -61), '2026-07-01', today)).toMatchObject({ bucket: '61-90', days: 61, isOverdue: true });
    expect(ageingOf(addCalendarDays(today, -90), '2026-07-01', today)).toMatchObject({ bucket: '61-90', days: 90, isOverdue: true });
    expect(ageingOf(addCalendarDays(today, -91), '2026-06-01', today)).toMatchObject({ bucket: '>90', days: 91, isOverdue: true });
    expect(ageingOf(addCalendarDays(today, 10), today, today)).toMatchObject({ bucket: '0-30', days: 0, isOverdue: false });
    expect(ageingOf(null, addCalendarDays(today, -45), today)).toMatchObject({ bucket: '31-60', isOverdue: false });
  });
});

describe('identificador de acreedor', () => {
  it('calcula dígitos de control que verifican el módulo 97', () => {
    const id = sepaCreditorId('ES', 'Q0000001A');
    expect(isCreditorId(id)).toBe(true);
    expect(id.endsWith('000Q0000001A')).toBe(true);
    expect(isCreditorId(`${id.slice(0, 2)}00${id.slice(4)}`)).toBe(false);
  });
});
