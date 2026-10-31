import { describe, expect, it } from 'bun:test';
import { migrate } from '../../db/migrate';
import { createTestApp } from '../helpers';
import { DomainError } from '../../src/core/errors';
import { emitEvent } from '../../src/core/events/emit';
import { createLocalClient } from '../../src/core/db/local';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createWriter, type Actor } from '../../src/core/db/writer';

const actor: Actor = { type: 'user', id: 'user-1', requestId: 'req-1' };
const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

function personTaxId(digits: string): string {
  const letter = LETTERS[Number(digits) % 23];
  if (!letter) throw new Error('letra');
  return `${digits}${letter}`;
}

function eventFor(id: string) {
  return {
    type: 'party.contact.created',
    aggregate: 'party.contact',
    aggregateId: id,
    payload: { contact_id: id, link: `/contactos/${id}` },
  };
}

async function setup() {
  const client = await createLocalClient(':memory:');
  await migrate(client);
  await client.query('CREATE TABLE party.probe (id INTEGER PRIMARY KEY, note VARCHAR)');
  const writer = createWriter(client);
  if (!(await writer.tryAcquireLease())) throw new Error('No se ha adquirido el arrendamiento');
  return {
    writer,
    async close() {
      writer.stopMaintenance();
      await client.close?.();
    },
  };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('emitEvent', () => {
  it('solo confirma el evento si el cambio confirma', async () => {
    const ctx = await setup();
    try {
      const rolled = newId();
      let caught: unknown;
      try {
        await ctx.writer.withWrite(actor, async (tx) => {
          tx.write(sql`INSERT INTO party.probe (id, note) VALUES (1, 'cambia')`);
          emitEvent(tx, eventFor(rolled));
          tx.write(`SELECT error('WC001: no')`);
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DomainError);
      expect((caught as DomainError).code).toBe('WC001');
      expect(await ctx.writer.read('SELECT * FROM party.probe')).toHaveLength(0);
      expect(await ctx.writer.read('SELECT * FROM ops.outbox_event')).toHaveLength(0);

      const aborted = newId();
      let thrown: unknown;
      try {
        await ctx.writer.withWrite(actor, async (tx) => {
          tx.write(sql`INSERT INTO party.probe (id, note) VALUES (2, 'no')`);
          emitEvent(tx, eventFor(aborted));
          throw new Error('abort');
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(await ctx.writer.read('SELECT * FROM party.probe')).toHaveLength(0);
      expect(await ctx.writer.read('SELECT * FROM ops.outbox_event')).toHaveLength(0);

      const id = newId();
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`INSERT INTO party.probe (id, note) VALUES (3, 'ok')`);
        emitEvent(tx, eventFor(id));
      });
      const probes = await ctx.writer.read<{ id: number }>('SELECT id FROM party.probe');
      const events = await ctx.writer.read<{ event_type: string; payload: { contact_id: string } }>(
        'SELECT event_type, payload FROM ops.outbox_event',
      );
      expect(probes.map((row) => Number(row.id))).toEqual([3]);
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe('party.contact.created');
      expect(events[0]?.payload.contact_id).toBe(id);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un payload con datos personales y no deja fila', async () => {
    const ctx = await setup();
    try {
      const id = newId();
      let caught: unknown;
      try {
        await ctx.writer.withWrite(actor, async (tx) => {
          emitEvent(tx, {
            ...eventFor(id),
            payload: { contact_id: id, email: 'secreto@example.com' },
          });
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DomainError);
      expect((caught as DomainError).code).toBe('WC_VALIDATION');
      expect(await ctx.writer.read('SELECT * FROM ops.outbox_event')).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });
});

describe('contactos como productor', () => {
  it('emite alta y archivo, sin repetir ni incluir datos personales', async () => {
    const ctx = await createTestApp();
    try {
      const name = 'Bodega Zznombre Unico';
      const email = 'zz-correo-unico@example.com';
      const phone = '100200302';
      const taxId = personTaxId('12345678');
      const before = await ctx.writer.read('SELECT id FROM ops.outbox_event');

      const invalid = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'contacto-malo-01' },
        body: JSON.stringify({ legal_name: name }),
      }));
      expect(invalid.status).toBe(422);
      expect(await ctx.writer.read('SELECT id FROM ops.outbox_event')).toHaveLength(before.length);

      const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'contacto-evento-01' };
      const body = JSON.stringify({
        kind: 'company',
        legal_name: name,
        tax_id: taxId,
        country_code: 'ES',
        language: 'es',
        is_customer: true,
        is_supplier: false,
        is_carrier: false,
        is_logistics_operator: false,
        vat_regime: 'general',
        payment_terms_days: 30,
        email,
        phone,
      });
      const created = await ctx.app.handle(new Request('http://localhost/v1/contacts', { method: 'POST', headers, body }));
      expect(created.status).toBe(201);
      const contact = await json(created);
      const id = String(contact.id);
      const replay = await ctx.app.handle(new Request('http://localhost/v1/contacts', { method: 'POST', headers, body }));
      expect(replay.status).toBe(201);

      const duplicate = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'contacto-evento-02' },
        body: JSON.stringify({
          kind: 'company',
          legal_name: 'Otra bodega',
          tax_id: taxId,
          country_code: 'ES',
          language: 'es',
          is_customer: true,
          is_supplier: false,
          is_carrier: false,
          is_logistics_operator: false,
          vat_regime: 'general',
          payment_terms_days: 30,
        }),
      }));
      expect(duplicate.status).toBe(409);

      const createdEvents = await ctx.writer.read<{ event_type: string; payload: unknown }>(sql`
        SELECT event_type, payload FROM ops.outbox_event
        WHERE aggregate_id = CAST(${id} AS UUID)
        ORDER BY id
      `);
      expect(createdEvents.map((row) => row.event_type)).toEqual(['party.contact.created']);
      const stored = JSON.stringify(createdEvents[0]?.payload);
      expect(stored).not.toContain(name);
      expect(stored).not.toContain(email);
      expect(stored).not.toContain(phone);
      expect(stored).not.toContain(taxId);
      expect(stored).toContain(id);

      const archived = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/archive`, { method: 'POST' }));
      expect(archived.status).toBe(200);
      const again = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/archive`, { method: 'POST' }));
      expect(again.status).toBe(200);
      await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/unarchive`, { method: 'POST' }));

      const events = await ctx.writer.read<{ event_type: string; payload: unknown }>(sql`
        SELECT event_type, payload FROM ops.outbox_event
        WHERE aggregate_id = CAST(${id} AS UUID)
        ORDER BY id
      `);
      expect(events.map((row) => row.event_type)).toEqual(['party.contact.created', 'party.contact.archived']);
      const archivedPayload = JSON.stringify(events[1]?.payload);
      expect(archivedPayload).not.toContain(name);
      expect(archivedPayload).not.toContain(email);
      expect(archivedPayload).not.toContain(phone);
      expect(archivedPayload).not.toContain(taxId);
    } finally {
      await ctx.close();
    }
  });
});
