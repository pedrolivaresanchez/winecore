import { describe, expect, it } from 'bun:test';
import { formatSigpac, parseSigpac } from '../../src/core/vineyard/sigpac';

describe('referencia SIGPAC', () => {
  it('acepta provincia:municipio:agregado:zona:polígono:parcela:recinto', () => {
    expect(parseSigpac('23:050:0:0:12:34:1')).toEqual({
      province: 23,
      municipality: 50,
      aggregate: 0,
      zone: 0,
      polygon: 12,
      parcel: 34,
      enclosure: 1,
    });
  });

  it('normaliza los ceros a la izquierda al componerla', () => {
    const parsed = parseSigpac('23:050:0:0:12:34:1');
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(formatSigpac(parsed)).toBe('23:50:0:0:12:34:1');
  });

  it('rechaza una parte de menos, una provincia imposible y un polígono vacío', () => {
    expect(parseSigpac('23:50:0:0:12:34')).toMatch(/7 partes/);
    expect(parseSigpac('99:1:0:0:1:1:1')).toMatch(/provincia/);
    expect(parseSigpac('23:50:0:0:0:1:1')).toMatch(/polígono/);
    expect(parseSigpac('23:50:0:0::1:1')).toMatch(/entero/);
  });
});
