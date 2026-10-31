import { describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import { createLocalClient } from '../../src/core/db/local';
import { sql } from '../../src/core/db/sql';

describe('sql', () => {
  it("escapa comillas y neutraliza '); DROP TABLE x; --", async () => {
    const payload = "'); DROP TABLE x; --";
    expect(sql`SELECT ${payload} AS name`).toBe("SELECT '''); DROP TABLE x; --' AS name");

    const db = await createLocalClient(':memory:');
    try {
      await db.query('CREATE TABLE t (name VARCHAR)');
      await db.query('CREATE TABLE x (id INTEGER)');
      await db.query(sql`INSERT INTO t (name) VALUES (${payload})`);
      const stored = await db.query<{ name: string }>('SELECT name FROM t');
      const stillThere = await db.query('SELECT * FROM x');
      expect(stored[0]?.name).toBe(payload);
      expect(stillThere).toHaveLength(0);
    } finally {
      await db.close?.();
    }
  });

  it('rechaza un byte NUL en un texto', () => {
    expect(() => sql`SELECT ${'a\0b'}`).toThrow(/NUL/);
  });

  it('representa null, booleanos, números y bigint', () => {
    expect(sql`SELECT ${null}, ${undefined}, ${true}, ${false}, ${42}, ${1.5}, ${7n}`).toBe(
      'SELECT NULL, NULL, TRUE, FALSE, 42, 1.5, 7',
    );
  });

  it('rechaza números no finitos y notación científica', () => {
    expect(() => sql`SELECT ${Number.NaN}`).toThrow(/finito/);
    expect(() => sql`SELECT ${Number.POSITIVE_INFINITY}`).toThrow(/finito/);
    expect(() => sql`SELECT ${1e21}`).toThrow(/rango/);
  });

  it('representa fechas, decimales, bytes, listas y JSON', () => {
    const when = new Date('2027-01-01T18:20:30.000Z');
    expect(sql`SELECT ${when}`).toBe("SELECT TIMESTAMPTZ '2027-01-01T18:20:30.000Z'");
    expect(sql`SELECT ${new Decimal('1.005')}`).toBe("SELECT DECIMAL '1.005'");
    expect(sql`SELECT ${new Uint8Array([97])}`).toBe("SELECT from_base64('YQ==')");
    expect(sql`SELECT ${[1, 2, 3]}`).toBe('SELECT [1, 2, 3]');
    expect(sql`SELECT ${["a", "b'c"]}`).toBe("SELECT ['a', 'b''c']");
    expect(sql`SELECT ${sql.json({ b: 1, a: 'x' })}`).toBe(`SELECT '{"b":1,"a":"x"}'::JSON`);
  });

  it('solo acepta identificadores de confianza en sql.raw', () => {
    expect(sql`SELECT ${sql.raw('core.writer_lease')}.id`).toBe('SELECT core.writer_lease.id');
    expect(() => sql.raw('core.t; DROP TABLE x')).toThrow(/Identificador/);
    expect(() => sql`SELECT ${{ a: 1 }}`).toThrow(/no soportado/);
  });

  it('ejecuta literales de fecha, decimal, JSON y lista', async () => {
    const db = await createLocalClient(':memory:');
    try {
      const rows = await db.query<{
        d: string;
        j: { a: string };
        n: number[];
      }>(sql`
        SELECT ${new Decimal('12.50')} AS d,
               ${sql.json({ a: 'x' })} AS j,
               ${[1, 2]} AS n
      `);
      expect(new Decimal(String(rows[0]?.d)).eq('12.50')).toBe(true);
      expect(rows[0]?.j).toEqual({ a: 'x' });
      expect(rows[0]?.n).toEqual([1, 2]);
    } finally {
      await db.close?.();
    }
  });
});
