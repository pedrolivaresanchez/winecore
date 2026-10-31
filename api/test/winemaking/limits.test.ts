import { describe, expect, it } from 'bun:test';
import { organicCategory, outsideLimit, outsidePhysical, sugarBand } from '../../src/core/winemaking/rules';

describe('límites de analítica', () => {
  it('rechaza el pH por encima del rango físico y no un pH de vino', () => {
    expect(outsidePhysical('5.1', { min: '2.5', max: '4.5' })).toBe('high');
    expect(outsidePhysical('5', { min: '2.5', max: '4.5' })).toBe('high');
    expect(outsidePhysical('3.6', { min: '2.5', max: '4.5' })).toBeNull();
    expect(outsidePhysical('2.5', { min: '2.5', max: '4.5' })).toBeNull();
  });

  it('marca el SO₂ ecológico según color y azúcar, y la volátil por categoría', () => {
    expect(sugarBand('1.5')).toBe('dry');
    expect(sugarBand('3')).toBe('mid');
    expect(sugarBand('6')).toBe('high');
    expect(sugarBand(null)).toBe('dry');
    expect(organicCategory('red', 'dry')).toBe('organic_red_dry');
    expect(organicCategory('white', 'mid')).toBe('organic_white_mid');
    expect(organicCategory('red', 'high')).toBeNull();
    expect(outsideLimit('110', { min: null, max: '100' })).toBe('max');
    expect(outsideLimit('100', { min: null, max: '100' })).toBeNull();
    expect(outsideLimit('90', { min: null, max: '100' })).toBeNull();
    expect(outsideLimit('1.5', { min: null, max: '1.20' })).toBe('max');
    expect(outsideLimit('0.80', { min: null, max: '1.20' })).toBeNull();
  });
});
