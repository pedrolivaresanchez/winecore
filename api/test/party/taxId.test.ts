import { describe, expect, it } from 'bun:test';
import { normalizeTaxId, type TaxIdResult } from '../../src/core/party/taxId';

const NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_LETTERS = 'JABCDEFGHI';

function nifLetter(numeric: number): string {
  const letter = NIF_LETTERS[numeric % 23];
  if (letter === undefined) throw new Error('letter');
  return letter;
}

function personNif(n: number): string {
  return String(n).padStart(8, '0') + nifLetter(n);
}

function nie(prefix: 'X' | 'Y' | 'Z', n: number): string {
  const head = prefix === 'X' ? 0 : prefix === 'Y' ? 1 : 2;
  const body = String(n).padStart(7, '0');
  return prefix + body + nifLetter(head * 10_000_000 + n);
}

function specialNif(prefix: 'K' | 'L' | 'M', n: number): string {
  const body = String(n).padStart(7, '0');
  return prefix + body + nifLetter(n);
}

function cifControl(digits: string): { digit: string; letter: string } {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const n = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      const doubled = n * 2;
      sum += Math.trunc(doubled / 10) + (doubled % 10);
    } else {
      sum += n;
    }
  }
  const digit = (10 - (sum % 10)) % 10;
  const letter = CIF_LETTERS[digit];
  if (letter === undefined) throw new Error('cif letter');
  return { digit: String(digit), letter };
}

function entityNif(org: string, digits: string, control: string): string {
  return org + digits + control;
}

function wrongControl(id: string): string {
  const last = id.slice(-1);
  return id.slice(0, -1) + (last === 'T' ? 'R' : 'T');
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertStored(result: TaxIdResult): void {
  if (result.normalized !== null) {
    expect(result.normalized).toMatch(/^[A-Z0-9]{2,20}$/);
  }
}

describe('normalizeTaxId', () => {
  it('entrada vacía → identificador ausente', () => {
    const absent: TaxIdResult = { normalized: null, type: 'none', country: null, valid: true };
    expect(normalizeTaxId('')).toEqual(absent);
    expect(normalizeTaxId('  .- / ')).toEqual(absent);
  });

  it('NIF de persona con letra correcta → nif ES', () => {
    expect(normalizeTaxId('00000000T')).toEqual({
      normalized: '00000000T',
      type: 'nif',
      country: 'ES',
      valid: true,
    });
    expect(normalizeTaxId('00000000T').warning).toBeUndefined();
    const hand = `${String(12_345_678)}Z`;
    expect(nifLetter(12_345_678)).toBe('Z');
    expect(normalizeTaxId(hand)).toEqual({
      normalized: hand,
      type: 'nif',
      country: 'ES',
      valid: true,
    });
  });

  it('prefijo ES, mayúsculas y separadores → el mismo NIF', () => {
    const raw = 'es / 00.000.000-t';
    expect(normalizeTaxId(raw)).toEqual(normalizeTaxId('00000000T'));
    expect(normalizeTaxId('00.000.000 T')).toEqual(normalizeTaxId('00000000T'));
    expect(normalizeTaxId('ES00000000T', 'FR').country).toBe('ES');
  });

  it('letra de control del NIF incorrecta → none y aviso', () => {
    const bad = `${'00000000T'.slice(0, 8)}R`;
    expect(normalizeTaxId(bad)).toEqual({
      normalized: bad,
      type: 'none',
      country: 'ES',
      valid: false,
      warning: 'La letra de control del NIF no coincide',
    });
    expect(normalizeTaxId(`ES ${bad}`)).toEqual(normalizeTaxId(bad));
  });

  it('la coma no es un separador → no se puede almacenar', () => {
    expect(normalizeTaxId('00000000,T')).toEqual({
      normalized: null,
      type: 'none',
      country: null,
      valid: false,
    });
  });

  it('NIE X/Y/Z con sustitución 0/1/2 → nie', () => {
    const built = [
      nie('X', 0),
      nie('Y', 0),
      nie('Z', 0),
    ];
    expect(built[0]?.endsWith('T')).toBe(true);
    expect(built[1]?.endsWith('Z')).toBe(true);
    expect(built[2]?.endsWith('M')).toBe(true);
    for (const id of built) {
      expect(normalizeTaxId(id)).toEqual({
        normalized: id,
        type: 'nie',
        country: 'ES',
        valid: true,
      });
      const bad = wrongControl(id);
      expect(normalizeTaxId(bad)).toEqual({
        normalized: bad,
        type: 'none',
        country: 'ES',
        valid: false,
        warning: 'La letra de control del NIE no coincide',
      });
    }
  });

  it('NIF K/L/M usa el módulo 23 de los 7 dígitos → nif', () => {
    const body = 1_234_567;
    expect(nifLetter(body)).toBe('L');
    for (const prefix of ['K', 'L', 'M'] as const) {
      const id = specialNif(prefix, body);
      expect(id.endsWith('L')).toBe(true);
      expect(normalizeTaxId(id)).toMatchObject({ type: 'nif', country: 'ES', valid: true, normalized: id });
      const bad = wrongControl(id);
      expect(normalizeTaxId(bad)).toMatchObject({
        type: 'none',
        valid: false,
        normalized: bad,
        warning: 'La letra de control del NIF no coincide',
      });
    }
  });

  it('CIF con cuerpo cero → dígito 0 o letra J según el tipo', () => {
    for (const org of ['A', 'B', 'E', 'H']) {
      expect(normalizeTaxId(`${org}00000000`)).toMatchObject({ type: 'nif', valid: true, country: 'ES' });
      expect(normalizeTaxId(`${org}0000000J`).valid).toBe(false);
      expect(normalizeTaxId(`${org}0000000J`).warning).toBe('El dígito de control del CIF no coincide');
    }
    for (const org of ['N', 'P', 'Q', 'R', 'S', 'W']) {
      expect(normalizeTaxId(`${org}0000000J`)).toMatchObject({ type: 'nif', valid: true });
      expect(normalizeTaxId(`${org}00000000`).valid).toBe(false);
    }
    for (const org of ['C', 'D', 'F', 'G', 'J', 'U', 'V']) {
      expect(normalizeTaxId(`${org}00000000`).valid).toBe(true);
      expect(normalizeTaxId(`${org}0000000J`).valid).toBe(true);
    }
  });

  it('CIF 1234567 → dígito 4 o letra D, y B solo admite el dígito', () => {
    expect(cifControl('1234567')).toEqual({ digit: '4', letter: 'D' });
    expect(normalizeTaxId('B12345674')).toMatchObject({ normalized: 'B12345674', type: 'nif', valid: true });
    expect(normalizeTaxId('b-12.345.674')).toEqual(normalizeTaxId('B12345674'));
    expect(normalizeTaxId('ES B12345674')).toEqual(normalizeTaxId('B12345674'));
    expect(normalizeTaxId('B1234567D')).toMatchObject({ valid: false, type: 'none', normalized: 'B1234567D' });
    expect(normalizeTaxId('P1234567D').valid).toBe(true);
    expect(normalizeTaxId('P12345674').valid).toBe(false);
    expect(normalizeTaxId('C12345674').valid).toBe(true);
    expect(normalizeTaxId('C1234567D').valid).toBe(true);
  });

  it('formatos de NIF-IVA de la UE → vat_eu sin comprobar VIES', () => {
    const samples: ReadonlyArray<readonly [string, string]> = [
      ['ATU12345678', 'AT'],
      ['BE0123456789', 'BE'],
      ['BG123456789', 'BG'],
      ['BG1234567890', 'BG'],
      ['CY12345678L', 'CY'],
      ['CZ12345678', 'CZ'],
      ['CZ123456789', 'CZ'],
      ['CZ1234567890', 'CZ'],
      ['DE123456789', 'DE'],
      ['DK12345678', 'DK'],
      ['EE123456789', 'EE'],
      ['EL123456789', 'EL'],
      ['FI12345678', 'FI'],
      ['FRAB123456789', 'FR'],
      ['FR12123456789', 'FR'],
      ['HR12345678901', 'HR'],
      ['HU12345678', 'HU'],
      ['IE1234567T', 'IE'],
      ['IE1234567FA', 'IE'],
      ['IE1A23456B', 'IE'],
      ['IT12345678901', 'IT'],
      ['LT123456789', 'LT'],
      ['LT123456789012', 'LT'],
      ['LU12345678', 'LU'],
      ['LV12345678901', 'LV'],
      ['MT12345678', 'MT'],
      ['NL123456789B01', 'NL'],
      ['PL1234567890', 'PL'],
      ['PT123456789', 'PT'],
      ['RO12', 'RO'],
      ['RO1234567890', 'RO'],
      ['SE123456789012', 'SE'],
      ['SI12345678', 'SI'],
      ['SK1234567890', 'SK'],
      ['XI123456789', 'XI'],
      ['XI123456789012', 'XI'],
      ['XIGD123', 'XI'],
      ['XIHA499', 'XI'],
    ];
    for (const [value, country] of samples) {
      expect(normalizeTaxId(value.toLowerCase())).toEqual({
        normalized: value,
        type: 'vat_eu',
        country,
        valid: true,
      });
    }
    expect(normalizeTaxId('de/123.456.789')).toEqual(normalizeTaxId('DE123456789'));
    expect(normalizeTaxId('IE1+23456W').normalized).toBeNull();
  });

  it('el NIF-IVA español se guarda sin prefijo y como nif o nie', () => {
    expect(normalizeTaxId('ES00000000T')).toEqual(normalizeTaxId('00000000T'));
    expect(normalizeTaxId('ESB00000000').type).toBe('nif');
    const id = nie('Y', 0);
    expect(normalizeTaxId(`ES${id}`)).toMatchObject({ normalized: id, type: 'nie', country: 'ES', valid: true });
  });

  it('prefijo GR o formato UE incompleto → no es vat_eu', () => {
    expect(normalizeTaxId('GR123456789')).toMatchObject({ type: 'none', valid: false, normalized: 'GR123456789' });
    expect(normalizeTaxId('EL123456789').type).toBe('vat_eu');
    expect(normalizeTaxId('AT123456789').valid).toBe(false);
    expect(normalizeTaxId('FROI123456789').valid).toBe(false);
    expect(normalizeTaxId('FRIO123456789').valid).toBe(false);
    expect(normalizeTaxId('BE123456789').valid).toBe(false);
    expect(normalizeTaxId('NL123456789A01').valid).toBe(false);
    expect(normalizeTaxId('DE123')).toEqual({
      normalized: 'DE123',
      type: 'none',
      country: null,
      valid: false,
    });
    expect(normalizeTaxId('DE123', 'DE').type).toBe('none');
  });

  it('país fuera de la UE → foreign_id; dentro, no', () => {
    expect(normalizeTaxId('ab-12', ' mx ')).toEqual({
      normalized: 'AB12',
      type: 'foreign_id',
      country: 'MX',
      valid: true,
    });
    expect(normalizeTaxId('GB123456789', 'GB')).toMatchObject({
      type: 'foreign_id',
      country: 'GB',
      valid: true,
    });
    expect(normalizeTaxId('PT123456789', 'JP').type).toBe('vat_eu');
    expect(normalizeTaxId('00000000T', 'US').type).toBe('nif');
    expect(normalizeTaxId('ZZ1234', 'FR')).toMatchObject({ type: 'none', valid: false });
    expect(normalizeTaxId('ZZ1234', 'EL').type).toBe('none');
    expect(normalizeTaxId('ZZ1234', 'XI').type).toBe('none');
    expect(normalizeTaxId('ZZ1234', 'GR').type).toBe('none');
  });

  it('longitud fuera de 2..20 o caracteres no admitidos → normalized null', () => {
    expect(normalizeTaxId('A', 'JP')).toEqual({
      normalized: null,
      type: 'none',
      country: null,
      valid: false,
    });
    const twenty = `Q${'A'.repeat(19)}`;
    expect(normalizeTaxId(twenty, 'JP')).toEqual({
      normalized: twenty,
      type: 'foreign_id',
      country: 'JP',
      valid: true,
    });
    expect(normalizeTaxId('A'.repeat(21), 'JP').normalized).toBeNull();
    expect(normalizeTaxId('AB@CD', 'JP').normalized).toBeNull();
  });

  it('normalizar dos veces → el mismo resultado', () => {
    const inputs: ReadonlyArray<readonly [string, string | undefined]> = [
      ['00000000T', undefined],
      ['ES B00000000', 'ES'],
      ['de 123456789', undefined],
      ['ab-12', 'MX'],
      ['', undefined],
    ];
    for (const [raw, hint] of inputs) {
      const once = normalizeTaxId(raw, hint);
      assertStored(once);
      if (once.normalized !== null) {
        expect(normalizeTaxId(once.normalized, hint)).toEqual(once);
      }
    }
    expect(normalizeTaxId(normalizeTaxId('').normalized ?? '')).toEqual(normalizeTaxId(''));
    const invalid = normalizeTaxId('B0000000J');
    expect(normalizeTaxId(invalid.normalized ?? '')).toEqual(invalid);
  });

  it('bucle con semilla de NIF, NIE y CIF → ida y vuelta del control', () => {
    const rng = mulberry32(20261031);
    const next = (bound: number) => Math.floor(rng() * bound);
    const orgs = {
      digit: ['A', 'B', 'E', 'H'],
      letter: ['N', 'P', 'Q', 'R', 'S', 'W'],
      both: ['C', 'D', 'F', 'G', 'J', 'U', 'V'],
    };

    for (let i = 0; i < 40; i += 1) {
      const nif = personNif(next(100_000_000));
      const pretty = `${nif.slice(0, 2)}.${nif.slice(2, 5)}.${nif.slice(5, 8)}-${nif.slice(8)}`;
      expect(normalizeTaxId(pretty).normalized).toBe(nif);
      expect(normalizeTaxId(`ES${pretty.toLowerCase()}`)).toEqual(normalizeTaxId(nif));
      const badNif = wrongControl(nif);
      expect(normalizeTaxId(badNif)).toMatchObject({
        valid: false,
        type: 'none',
        normalized: badNif,
        country: 'ES',
      });
      expect(normalizeTaxId(normalizeTaxId(nif).normalized ?? '')).toEqual(normalizeTaxId(nif));

      for (const prefix of ['X', 'Y', 'Z'] as const) {
        const id = nie(prefix, next(10_000_000));
        expect(normalizeTaxId(id)).toMatchObject({ type: 'nie', valid: true, normalized: id });
        expect(normalizeTaxId(wrongControl(id)).valid).toBe(false);
      }

      for (const prefix of ['K', 'L', 'M'] as const) {
        const id = specialNif(prefix, next(10_000_000));
        expect(normalizeTaxId(`es/${id}`)).toMatchObject({ type: 'nif', valid: true, normalized: id });
        expect(normalizeTaxId(wrongControl(id)).type).toBe('none');
      }

      const digits = String(next(10_000_000)).padStart(7, '0');
      const control = cifControl(digits);
      for (const org of orgs.digit) {
        const id = entityNif(org, digits, control.digit);
        expect(normalizeTaxId(id).valid).toBe(true);
        expect(normalizeTaxId(entityNif(org, digits, control.letter)).valid).toBe(false);
      }
      for (const org of orgs.letter) {
        const id = entityNif(org, digits, control.letter);
        expect(normalizeTaxId(id).valid).toBe(true);
        expect(normalizeTaxId(entityNif(org, digits, control.digit)).valid).toBe(false);
      }
      for (const org of orgs.both) {
        expect(normalizeTaxId(entityNif(org, digits, control.digit)).valid).toBe(true);
        expect(normalizeTaxId(entityNif(org, digits, control.letter)).valid).toBe(true);
        const other = control.digit === '0' ? '1' : '0';
        expect(normalizeTaxId(entityNif(org, digits, other)).valid).toBe(false);
      }
    }
  });
});
