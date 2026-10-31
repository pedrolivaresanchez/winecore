import { describe, expect, it } from 'bun:test';
import { migrate } from '../../db/migrate';
import { DomainError } from '../../src/core/errors';
import { createLocalClient } from '../../src/core/db/local';
import { sql } from '../../src/core/db/sql';
import { createWriter, type Actor } from '../../src/core/db/writer';

const actor: Actor = { type: 'user', id: 'user-1', requestId: 'req-1' };

async function setup() {
  const client = await createLocalClient(':memory:');
  await migrate(client);
  await client.query('CREATE TABLE party.probe (id INTEGER PRIMARY KEY, name VARCHAR)');
  const writer = createWriter(client);
  if (!(await writer.tryAcquireLease())) throw new Error('No se ha adquirido el arrendamiento');
  return {
    client,
    writer,
    async close() {
      writer.stopMaintenance();
      await client.close?.();
    },
  };
}

describe('withWrite', () => {
  it('deshace la operación entera, auditoría incluida, si falla a mitad', async () => {
    const ctx = await setup();
    try {
      let caught: unknown;
      try {
        await ctx.writer.withWrite(actor, async (tx) => {
          tx.write(sql`INSERT INTO party.probe (id, name) VALUES (1, 'a')`);
          tx.audit({
            table: 'party.probe',
            rowId: '1',
            action: 'INSERT',
            before: null,
            after: { name: 'a' },
          });
          tx.write(`SELECT error('WC001: borrado prohibido')`);
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DomainError);
      expect((caught as DomainError).code).toBe('WC001');
      expect(await ctx.writer.read('SELECT * FROM party.probe')).toHaveLength(0);
      expect(await ctx.writer.read('SELECT * FROM audit.audit_log')).toHaveLength(0);

      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`INSERT INTO party.probe (id, name) VALUES (7, 'ok')`);
      });
      const rows = await ctx.writer.read<{ name: string }>('SELECT name FROM party.probe');
      expect(rows.map((row) => row.name)).toEqual(['ok']);
    } finally {
      await ctx.close();
    }
  });

  it('ejecuta las escrituras concurrentes una detrás de otra', async () => {
    const ctx = await setup();
    try {
      const order: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });

      const first = ctx.writer.withWrite(actor, async (tx) => {
        order.push('first-enter');
        entered();
        await gate;
        tx.write(sql`INSERT INTO party.probe (id, name) VALUES (1, 'first')`);
        order.push('first-leave');
      });
      await enteredPromise;

      const second = ctx.writer.withWrite(actor, async (tx) => {
        order.push('second-enter');
        const seen = await tx.read('SELECT id FROM party.probe');
        order.push(`seen-${seen.length}`);
        tx.write(sql`INSERT INTO party.probe (id, name) VALUES (2, 'second')`);
        order.push('second-leave');
      });

      await Promise.resolve();
      expect(order).toEqual(['first-enter']);
      release();
      await Promise.all([first, second]);
      expect(order).toEqual(['first-enter', 'first-leave', 'second-enter', 'seen-1', 'second-leave']);
    } finally {
      await ctx.close();
    }
  });

  it('no escribe nada si el arrendamiento lo tiene otro proceso', async () => {
    const ctx = await setup();
    try {
      await ctx.client.query(sql`
        UPDATE core.writer_lease
        SET holder = ${'other-holder'}, expires_at = now() + INTERVAL 120 SECOND
        WHERE id = 1
      `);
      let caught: unknown;
      try {
        await ctx.writer.withWrite(actor, async (tx) => {
          tx.write(sql`INSERT INTO party.probe (id, name) VALUES (1, 'no')`);
          tx.audit({
            table: 'party.probe',
            rowId: '1',
            action: 'INSERT',
            before: null,
            after: { name: 'no' },
          });
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DomainError);
      expect((caught as DomainError).code).toBe('WRITER_LEASE_LOST');
      expect(await ctx.writer.currentRole()).toBe('standby');
      expect(await ctx.client.query('SELECT * FROM party.probe')).toHaveLength(0);
      expect(await ctx.client.query('SELECT * FROM audit.audit_log')).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  it('verifica la cadena y detecta una manipulación', async () => {
    const ctx = await setup();
    try {
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.audit({
          table: 'party.probe',
          rowId: '1',
          action: 'INSERT',
          before: null,
          after: { name: 'uno' },
        });
      });
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.audit({
          table: 'party.probe',
          rowId: '2',
          action: 'UPDATE',
          before: { name: 'uno' },
          after: { name: 'dos' },
        });
      });
      expect(await ctx.writer.verifyAuditChain()).toEqual({ intact: true });
      await ctx.client.query(`UPDATE audit.audit_log SET reason = 'manipulado' WHERE id = 2`);
      expect(await ctx.writer.verifyAuditChain()).toEqual({ intact: false, firstBrokenId: 2 });
    } finally {
      await ctx.close();
    }
  });
});
