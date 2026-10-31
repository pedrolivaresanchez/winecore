import { describe, expect, it } from 'bun:test';
import {
  addMonths,
  cueClock,
  insideSafetyInterval,
  parseCampaign,
  safetyEndsOn,
} from '../../src/core/vineyard-notebook/dates';
import { renderCueCsv, TITULAR_NOTE, type CueWorkbook } from '../../src/core/vineyard-notebook/export-csv';
import { multiplyQuantity } from '../../src/core/vineyard-notebook/quantities';

describe('fechas del cuaderno', () => {
  it('cuenta un mes de fecha a fecha y avisa el día 20', () => {
    expect(addMonths('2027-05-01', 1)).toBe('2027-06-01');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    const base = { kind: 'phytosanitary', appliedOn: '2027-05-01', recorded: false };
    expect(cueClock({ ...base, asOf: '2027-05-20' }).status).toBe('pending');
    expect(cueClock({ ...base, asOf: '2027-05-21' })).toMatchObject({ status: 'warn', warn_on: '2027-05-21', due_on: '2027-06-01' });
    expect(cueClock({ ...base, asOf: '2027-06-01' }).status).toBe('warn');
    expect(cueClock({ ...base, asOf: '2027-06-02' }).status).toBe('overdue');
    expect(cueClock({ ...base, recorded: true, asOf: '2027-06-02' }).status).toBe('recorded');
  });

  it('no exige CUE antes de 2027 ni en la fertilización', () => {
    expect(cueClock({ kind: 'phytosanitary', appliedOn: '2026-12-31', recorded: false, asOf: '2027-02-01' }).status).toBe('not_required');
    expect(cueClock({ kind: 'fertiliser', appliedOn: '2027-03-02', recorded: false, asOf: '2027-05-01' }).required).toBe(false);
  });

  it('deja vendimiar el día en que termina el plazo', () => {
    expect(safetyEndsOn('2027-09-01', 21)).toBe('2027-09-22');
    expect(insideSafetyInterval('2027-09-10', '2027-09-01', 21)).toBe(true);
    expect(insideSafetyInterval('2027-09-22', '2027-09-01', 21)).toBe(false);
    expect(insideSafetyInterval('2027-08-31', '2027-09-01', 21)).toBe(false);
    expect(insideSafetyInterval('2027-09-10', '2027-09-01', 0)).toBe(false);
  });

  it('interpreta el año natural y la campaña vitivinícola', () => {
    expect(parseCampaign('2027')).toEqual({ label: '2027', start: '2027-01-01', end: '2027-12-31' });
    expect(parseCampaign('2026/2027')).toEqual({ label: '2026/2027', start: '2026-08-01', end: '2027-07-31' });
    expect(parseCampaign('2026/2028')).toBeNull();
    expect(parseCampaign('1989')).toBeNull();
  });

  it('multiplica dosis por superficie con decimal exacto', () => {
    expect(multiplyQuantity('3.000', '1.0000', 4)).toBe('3.0000');
    expect(multiplyQuantity('1500.000', '1.2500', 4)).toBe('1875.0000');
  });

  it('cita que el agricultor presenta el cuaderno y no lo envía', () => {
    const book: CueWorkbook = {
      campaignLabel: '2027',
      windowStart: '2027-01-01',
      windowEnd: '2027-12-31',
      generatedOn: '2027-09-15',
      parcels: [],
      products: [],
      treatments: [],
      operations: [],
      tasks: [],
      harvests: [],
      warnings: [],
    };
    const csv = renderCueCsv(book);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(TITULAR_NOTE);
    expect(csv.toLowerCase()).not.toContain('http');
    expect(csv).toContain('seccion;orden;fecha;');
  });
});
