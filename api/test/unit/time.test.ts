import { describe, expect, it } from 'bun:test';
import { businessDate, formatMadridDmy, isMadridCivilDate, madridMonthEnd, toMadridOffsetString } from '../../src/core/time';

describe('toMadridOffsetString', () => {
  it('formatea el horario de invierno con offset +01:00', () => {
    expect(toMadridOffsetString(new Date('2027-01-01T18:20:30Z'))).toBe('2027-01-01T19:20:30+01:00');
  });

  it('cruza el cambio de hora del 2027-03-28', () => {
    expect(toMadridOffsetString(new Date('2027-03-28T00:30:00Z'))).toBe('2027-03-28T01:30:00+01:00');
    expect(toMadridOffsetString(new Date('2027-03-28T01:30:00Z'))).toBe('2027-03-28T03:30:00+02:00');
    expect(businessDate(new Date('2027-03-27T23:30:00Z'))).toBe('2027-03-28');
  });

  it('el último día civil de Madrid incluye febrero bisiesto', () => {
    expect(madridMonthEnd('2027-02')).toBe('2027-02-28');
    expect(madridMonthEnd('2028-02')).toBe('2028-02-29');
    expect(madridMonthEnd('2027-09')).toBe('2027-09-30');
    expect(isMadridCivilDate('2027-02-31')).toBe(false);
    expect(formatMadridDmy('2027-01-01')).toBe('01-01-2027');
  });

  it('cruza el cambio de hora del 2027-10-31', () => {
    expect(toMadridOffsetString(new Date('2027-10-31T00:30:00Z'))).toBe('2027-10-31T02:30:00+02:00');
    expect(toMadridOffsetString(new Date('2027-10-31T01:30:00Z'))).toBe('2027-10-31T02:30:00+01:00');
    expect(businessDate(new Date('2027-10-31T23:30:00Z'))).toBe('2027-11-01');
  });
});
