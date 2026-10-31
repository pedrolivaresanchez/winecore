import { describe, expect, it } from 'bun:test';
import { EORI_ISSUERS, validateEori } from '../../src/core/billing/export/eori';

const ACCEPTED: Record<string, string[]> = {
  AT: ['ATU12345678'],
  BE: ['BE0123456789', 'BE123456789012', 'BEUS123456'],
  BG: ['BG123456789'],
  CY: ['CY12345678A'],
  CZ: ['CZ1234567890'],
  DE: ['DE123456789012345'],
  DK: ['DK12345678'],
  EE: ['EE123456789'],
  EL: ['EL123456789'],
  ES: ['ES00000000T', 'ES00000000A', 'ESK1234567890A'],
  FI: ['FI12345678'],
  FR: ['FR12345678901234', 'FRGB123456789'],
  GB: ['GB123456789000'],
  HR: ['HR12345678901'],
  HU: ['HU12345678'],
  IE: ['IE1234567T'],
  IT: ['IT12345678901'],
  LT: ['LT123456789'],
  LU: ['LU12345678'],
  LV: ['LV12345678901'],
  MT: ['MT12345678'],
  NL: ['NL123456789B01'],
  PL: ['PL1234567890'],
  PT: ['PT123456789', 'PTGB1234567'],
  RO: ['RO123456789', 'ROT0530123456789'],
  SE: ['SE123456789012'],
  SI: ['SI12345678'],
  SK: ['SK1234567890'],
  XI: ['XI123456789000'],
};

describe('validateEori', () => {
  it('cubre los 27 emisores de la UE más GB y XI', () => {
    expect([...EORI_ISSUERS].sort()).toEqual(Object.keys(ACCEPTED).sort());
    expect(EORI_ISSUERS).toHaveLength(29);
    expect(EORI_ISSUERS).not.toContain('GR');
    expect(EORI_ISSUERS).not.toContain('US');
  });

  it('acepta el formato publicado de cada emisor, sin dígito de control', () => {
    for (const [country, samples] of Object.entries(ACCEPTED)) {
      for (const sample of samples) {
        expect(validateEori(sample)).toEqual({ ok: true, normalized: sample, country });
      }
    }
    // ES00000000A no tiene la letra de control del NIF (sería T). El formato sí cuadra.
    expect(validateEori('ES00000000A').ok).toBe(true);
  });

  it('normaliza espacios, guiones y mayúsculas', () => {
    expect(validateEori('es 00000000t')).toEqual({ ok: true, normalized: 'ES00000000T', country: 'ES' });
    expect(validateEori('gb-1234-5678-9000')).toEqual({
      ok: true,
      normalized: 'GB123456789000',
      country: 'GB',
    });
  });

  it('rechaza prefijos y longitudes que no son el formato', () => {
    const empty = validateEori('');
    const blank = validateEori('   ');
    expect(empty.ok).toBe(false);
    expect(blank.ok).toBe(false);
    if (!empty.ok) expect(empty.empty).toBe(true);
    if (!blank.ok) expect(blank.empty).toBe(true);
    expect(message('GR123456789')).toContain('EL');
    expect(message('US123456789012')).toContain('no es un país emisor');
    expect(message('ES123')).toContain('España');
    expect(message('GB123456789')).toContain('12 dígitos');
    expect(message('XI123')).toContain('Irlanda del Norte');
    expect(message('BE12345')).toContain('Bélgica');
    expect(message('FR123')).toContain('Francia');
    expect(message('HR123')).toContain('Croacia');
    expect(message('PT12345')).toContain('Portugal');
    expect(message(`DE${'1'.repeat(16)}`)).toContain('17');
    expect(message('ES00000000T*')).toContain('letras y números');
  });
});

function message(raw: string): string {
  const result = validateEori(raw);
  if (result.ok) throw new Error(raw);
  return result.message;
}
