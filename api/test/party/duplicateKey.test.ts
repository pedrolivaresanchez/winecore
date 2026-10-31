import { describe, expect, it } from 'bun:test';
import { duplicateKey, normalizeName } from '../../src/core/party/duplicateKey';

describe('normalizeName', () => {
  it('minúsculas, sin tildes ni signos, espacios colapsados → tokens limpios', () => {
    expect(normalizeName('  JOSÉ   María Peña Íñiguez ')).toBe('jose maria pena iniguez');
    expect(normalizeName('Bodegas-Ejemplo')).toBe('bodegas ejemplo');
    expect(normalizeName("O'Brien Wines")).toBe('obrien wines');
    expect(normalizeName('Vinos & Quesos (n.º 2)')).toBe('vinos quesos n 2');
    expect(normalizeName('')).toBe('');
    expect(normalizeName('   ')).toBe('');
  });

  it('formas societarias como tokens, también en medio → se eliminan', () => {
    const forms = [
      'S.L.', 'SL', 'S.L.U.', 'SLU', 'S.A.', 'SA', 'S.A.U.', 'SAU',
      'S.COOP.', 'S.C.A.', 'SCA', 'C.B.', 'S.C.', 'SAT', 'S.L.L.',
      'S. L.', 'S. L. U.', 'S L', 'S. COOP.', 'S.C.O.O.P.',
      'S.L.P.', 'SLP', 'S.C.P.', 'S.L.N.E.', 'S.A.T.',
    ];
    for (const form of forms) {
      expect(normalizeName(`Bodegas Ejemplo ${form}`)).toBe('bodegas ejemplo');
      expect(normalizeName(`${form} Bodegas Ejemplo`)).toBe('bodegas ejemplo');
      expect(normalizeName(`Bodegas ${form} Ejemplo`)).toBe('bodegas ejemplo');
    }
    expect(normalizeName('S.L.')).toBe('');
    expect(normalizeName('Salamanca')).toBe('salamanca');
    expect(normalizeName('Bodegas del Sal')).toBe('bodegas del sal');
    expect(normalizeName('Cuba Libre')).toBe('cuba libre');
    expect(normalizeName('Example Wines Ltd')).toBe('example wines ltd');
  });

  it('normalizar dos veces → el mismo nombre', () => {
    const name = 'Bodegas Ejemplo, S.L.U.';
    expect(normalizeName(normalizeName(name))).toBe(normalizeName(name));
  });
});

describe('duplicateKey', () => {
  it('mismo nombre normalizado y mismo CP → la misma clave', () => {
    const left = duplicateKey({ name: 'Bodegas Ejemplo, S.L.', postalCode: '23001' });
    const right = duplicateKey({ name: 'BODEGAS EJEMPLO SL', postalCode: '23 001' });
    expect(left).toBe('bodegas ejemplo|23001');
    expect(right).toBe(left);
    expect(duplicateKey({ name: 'José Peña S.A.', postalCode: '08-001' })).toBe('jose pena|08001');
    expect(duplicateKey({ name: 'Bodegas Ejemplo', postalCode: '8001' })).toBe('bodegas ejemplo|08001');
  });

  it('sin código postal → la clave termina en separador vacío', () => {
    expect(duplicateKey({ name: 'Bodegas Ejemplo' })).toBe('bodegas ejemplo|');
    expect(duplicateKey({ name: 'Bodegas Ejemplo', postalCode: null })).toBe('bodegas ejemplo|');
    expect(duplicateKey({ name: 'Bodegas Ejemplo', postalCode: '  ' })).toBe('bodegas ejemplo|');
  });

  it('otro nombre u otro CP → otra clave', () => {
    const base = duplicateKey({ name: 'Bodegas Ejemplo', postalCode: '23001' });
    expect(duplicateKey({ name: 'Otra Bodega', postalCode: '23001' })).not.toBe(base);
    expect(duplicateKey({ name: 'Bodegas Ejemplo', postalCode: '23002' })).not.toBe(base);
  });

  it('CP alfanumérico o de más de 5 dígitos → no se rellena', () => {
    expect(duplicateKey({ name: 'Example Wines', postalCode: 'sw1a 1aa' })).toBe('example wines|SW1A1AA');
    expect(duplicateKey({ name: 'A', postalCode: '123456' })).toBe('a|123456');
  });
});
