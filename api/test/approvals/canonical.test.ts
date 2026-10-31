import { describe, expect, test } from 'bun:test';

import { canonicalJson, payloadSha256 } from '../../src/core/approvals/canonical';
import { sha256Hex } from '../../src/core/hash';
import { expectError } from './helpers';

describe('canonical JSON', () => {
  test('sorts keys, drops whitespace and keeps array order', () => {
    const value = { b: 1, a: { d: true, c: [3, 1, null] } };
    expect(canonicalJson(value)).toBe('{"a":{"c":[3,1,null],"d":true},"b":1}');
    expect(canonicalJson({ a: { c: [3, 1, null], d: true }, b: 1 })).toBe(canonicalJson(value));
  });

  test('orders unicode keys by code unit and does not escape letters', () => {
    expect(canonicalJson({ viña: 'Árbol', año: 2026, a: 'España' })).toBe(
      '{"a":"España","año":2026,"viña":"Árbol"}',
    );
    expect(canonicalJson({ á: 2, a: 1 })).toBe('{"a":1,"á":2}');
    expect(canonicalJson('Cosecha\n2026 · Viña')).toBe('"Cosecha\\n2026 · Viña"');
  });

  test('serializes numbers stably and distinct from strings', () => {
    expect(canonicalJson({ n: 100, d: 10.5, z: -3, o: -0 })).toBe(
      '{"d":10.5,"n":100,"o":0,"z":-3}',
    );
    expect(canonicalJson({ n: 1 })).toBe(canonicalJson({ n: 1.0 }));
    expect(canonicalJson({ n: 1 })).not.toEqual(canonicalJson({ n: '1' }));
    expect(payloadSha256({ a: 1 })).toBe(
      '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
    );
    const body = canonicalJson({ b: 'ñ', a: 1 });
    expect(payloadSha256({ a: 1, b: 'ñ' })).toBe(sha256Hex(body));
    expect(payloadSha256({ a: 1, b: 'ñ' })).toHaveLength(64);
  });

  test('rejects values that are not canonical JSON', async () => {
    const bad: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date('2026-10-31T00:00:00.000Z'),
      () => 1,
      1n,
    ];
    for (const value of bad) {
      await expectError(Promise.resolve().then(() => canonicalJson(value)), 'WC_VALIDATION');
    }
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    await expectError(Promise.resolve().then(() => canonicalJson(cycle)), 'WC_VALIDATION');
    await expectError(
      Promise.resolve().then(() => canonicalJson({ ok: 1, missing: undefined })),
      'WC_VALIDATION',
    );
  });
});
