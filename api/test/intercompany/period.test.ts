import { describe, expect, it } from 'bun:test';
import { inMadridPeriod, monthPeriod, settlementWatcher } from '../../src/core/intercompany/calendar';
import { businessDate } from '../../src/core/time';

const october = monthPeriod('2027-10');

describe('mes de liquidación en hora de Madrid', () => {
  it('cierra octubre en el cambio de hora de 2027', () => {
    const start = '2027-10-01';
    const end = '2027-10-31';
    expect(businessDate(new Date('2027-09-30T21:59:59Z'))).toBe('2027-09-30');
    expect(inMadridPeriod(new Date('2027-09-30T21:59:59Z'), start, end)).toBe(false);
    expect(businessDate(new Date('2027-09-30T22:00:00Z'))).toBe('2027-10-01');
    expect(inMadridPeriod(new Date('2027-09-30T22:00:00Z'), start, end)).toBe(true);
    expect(businessDate(new Date('2027-10-31T22:59:00Z'))).toBe('2027-10-31');
    expect(inMadridPeriod(new Date('2027-10-31T22:59:00Z'), start, end)).toBe(true);
    expect(businessDate(new Date('2027-10-31T23:00:00Z'))).toBe('2027-11-01');
    expect(inMadridPeriod(new Date('2027-10-31T23:00:00Z'), start, end)).toBe(false);
  });

  it('pone la operación el último día y el plazo antes del día 16', () => {
    expect(october.periodEnd).toBe('2027-10-31');
    expect(october.warnFrom).toBe('2027-11-12');
    expect(october.issueDeadline).toBe('2027-11-15');
    expect(monthPeriod('2027-12')).toMatchObject({
      periodEnd: '2027-12-31',
      warnFrom: '2028-01-12',
      issueDeadline: '2028-01-15',
    });
    expect(monthPeriod('2027-02').periodEnd).toBe('2027-02-28');
    expect(monthPeriod('2028-02').periodEnd).toBe('2028-02-29');
  });

  it('avisa pendiente de emitir desde el día 12 y vencido desde el día 16', () => {
    const base = { period: october, lineCount: 2, invoiceIssued: false, closed: true };
    expect(settlementWatcher({ ...base, today: '2027-11-11' }).status).toBe('draft');
    expect(settlementWatcher({ ...base, today: '2027-11-12' })).toMatchObject({
      status: 'pending_issue',
      pendingIssue: true,
    });
    expect(settlementWatcher({ ...base, closed: false, today: '2027-11-12' }).status).toBe('pending_issue');
    expect(settlementWatcher({ ...base, today: '2027-11-15' }).status).toBe('pending_issue');
    expect(settlementWatcher({ ...base, today: '2027-11-16' }).status).toBe('overdue');
    expect(settlementWatcher({ ...base, lineCount: 0, today: '2027-11-12' }).status).toBe('no_movements');
    expect(settlementWatcher({ ...base, invoiceIssued: true, today: '2027-11-20' }).status).toBe('issued');
  });
});
