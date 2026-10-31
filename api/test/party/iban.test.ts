import { describe, expect, it } from 'bun:test';
import { ibanLast4, isValidIban, normalizeIban } from '../../src/core/party/iban';

function ibanCheckDigits(country: string, bban: string): string {
  const rearranged = `${bban}${country}00`;
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= 'A' && char <= 'Z' ? char.charCodeAt(0) - 55 : char.charCodeAt(0) - 48;
    if (value >= 10) {
      remainder = (remainder * 10 + Math.trunc(value / 10)) % 97;
      remainder = (remainder * 10 + (value % 10)) % 97;
    } else {
      remainder = (remainder * 10 + value) % 97;
    }
  }
  return String(98 - remainder).padStart(2, '0');
}

function makeIban(country: string, bban: string): string {
  return country + ibanCheckDigits(country, bban) + bban;
}

describe('normalizeIban', () => {
  it('mayúsculas y sin espacios ni guiones → compacto', () => {
    expect(normalizeIban(' de89 3704-0044 0532 0130 00 ')).toBe('DE89370400440532013000');
    expect(normalizeIban('')).toBe('');
  });
});

describe('isValidIban', () => {
  it('IBAN español generado → válido, y con un dígito cambiado no', () => {
    const bban = '21000418401234567890';
    const iban = makeIban('ES', bban);
    expect(iban).toHaveLength(24);
    expect(iban.startsWith('ES')).toBe(true);
    expect(isValidIban(iban)).toBe(true);
    expect(isValidIban(iban.toLowerCase())).toBe(true);
    const spaced = iban.replace(/(.{4})/g, '$1 ').trim();
    expect(isValidIban(spaced)).toBe(true);
    expect(normalizeIban(spaced)).toBe(iban);
    const broken = `${iban.slice(0, -1)}${iban.endsWith('0') ? '1' : '0'}`;
    expect(isValidIban(broken)).toBe(false);
    expect(isValidIban(iban.slice(0, -1))).toBe(false);
  });

  it('ejemplos extranjeros publicados → válidos', () => {
    const samples = [
      'DE89370400440532013000',
      'GB82WEST12345698765432',
      'FR1420041010050500013M02606',
      'NL91ABNA0417164300',
      'BE68539007547034',
      'PT50000201231234567890154',
      'IT60X0542811101000000123456',
      'AT611904300234573201',
      'IE29AIBK93115212345678',
      'GR1601101250000000012300695',
      'CH9300762011623852957',
      'NO9386011117947',
    ];
    for (const sample of samples) {
      expect(isValidIban(sample)).toBe(true);
    }
    expect(isValidIban('DE00370400440532013000')).toBe(false);
  });

  it('país fuera de SEPA o cadena vacía → inválido', () => {
    const brazil = makeIban('BR', '00000000000010932840814P2');
    expect(brazil).toHaveLength(29);
    expect(isValidIban(brazil)).toBe(false);
    expect(isValidIban('')).toBe(false);
    expect(isValidIban('not an iban')).toBe(false);
  });

  it('bucle con semilla de IBAN ES → el módulo 97 cuadra', () => {
    let state = 20261031;
    for (let i = 0; i < 30; i += 1) {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      const bban = String(state).padStart(10, '0').slice(0, 10) + String(state).padStart(10, '0').slice(0, 10);
      const iban = makeIban('ES', bban);
      expect(isValidIban(iban)).toBe(true);
      expect(ibanLast4(iban)).toBe(iban.slice(-4));
      expect(isValidIban(`${iban.slice(0, 2)}00${iban.slice(4)}`)).toBe(false);
    }
  });
});

describe('ibanLast4', () => {
  it('últimos 4 del IBAN normalizado → cuatro caracteres', () => {
    expect(ibanLast4('DE89 3704 0044 0532 0130 00')).toBe('3000');
    expect(ibanLast4('')).toBe('');
    const iban = makeIban('ES', '00000000000000000000');
    expect(ibanLast4(`  ${iban.toLowerCase()}  `)).toBe(iban.slice(-4));
  });
});
