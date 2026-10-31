import { describe, expect, it } from 'bun:test';
import { gs1CheckDigit, isValidGln, isValidGtin } from '../../src/core/shared/gs1';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('gs1CheckDigit', () => {
  it('ejemplos GS1 → dígito publicado', () => {
    expect(gs1CheckDigit('629104150021')).toBe(3);
    expect(gs1CheckDigit('9638507')).toBe(4);
    expect(gs1CheckDigit('0')).toBe(0);
    expect(gs1CheckDigit('000000000000')).toBe(0);
  });

  it('entrada vacía o con letras → error', () => {
    expect(() => gs1CheckDigit('')).toThrow(RangeError);
    expect(() => gs1CheckDigit('12a')).toThrow(RangeError);
  });
});

describe('isValidGln', () => {
  it('13 dígitos con control → válido; otra longitud o control, no', () => {
    expect(isValidGln('6291041500213')).toBe(true);
    expect(isValidGln('0000000000000')).toBe(true);
    expect(isValidGln('6291041500214')).toBe(false);
    expect(isValidGln('629104150021')).toBe(false);
    expect(isValidGln('62910415002131')).toBe(false);
    expect(isValidGln('6291041500213 ')).toBe(false);
    expect(isValidGln('')).toBe(false);
  });
});

describe('isValidGtin', () => {
  it('GTIN-8, 12, 13 y 14 con control → válidos', () => {
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('00000000')).toBe(true);
    expect(isValidGtin('000000000000')).toBe(true);
    expect(isValidGtin('6291041500213')).toBe(true);
    expect(isValidGtin('00000000000000')).toBe(true);
    expect(isValidGln('96385074')).toBe(false);
    expect(isValidGtin('96385075')).toBe(false);
    expect(isValidGtin('1234567')).toBe(false);
    expect(isValidGtin('629104150021X')).toBe(false);
  });

  it('bucle con semilla → el dígito calculado valida y el siguiente no', () => {
    const rng = mulberry32(20261031);
    for (const bodyLength of [7, 11, 12, 13]) {
      for (let i = 0; i < 20; i += 1) {
        let body = '';
        for (let d = 0; d < bodyLength; d += 1) body += String(Math.floor(rng() * 10));
        const check = gs1CheckDigit(body);
        const full = `${body}${check}`;
        expect(isValidGtin(full)).toBe(true);
        if (full.length === 13) expect(isValidGln(full)).toBe(true);
        const bad = `${body}${(check + 1) % 10}`;
        expect(isValidGtin(bad)).toBe(false);
        if (bad.length === 13) expect(isValidGln(bad)).toBe(false);
      }
    }
  });
});
