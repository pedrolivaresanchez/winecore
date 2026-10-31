import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';

const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

function personTaxId(digits: string): string {
  const letter = LETTERS[Number(digits) % 23];
  if (!letter) throw new Error('letra');
  return `${digits}${letter}`;
}

function wrongTaxId(digits: string): string {
  const correct = LETTERS[Number(digits) % 23];
  return `${digits}${correct === 'A' ? 'B' : 'A'}`;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'company',
    legal_name: 'Bodega José Viñedo',
    trade_name: 'Casa Viñedo',
    tax_id: personTaxId('11111111'),
    country_code: 'ES',
    language: 'es',
    is_customer: true,
    is_supplier: false,
    is_carrier: false,
    is_logistics_operator: false,
    vat_regime: 'general',
    payment_terms_days: 30,
    email: 'jose@example.com',
    phone: '100200300',
    ...overrides,
  };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('contactos', () => {
  it('crea, busca sin tildes, advierte el control y no repite el NIF', async () => {
    const ctx = await createTestApp();
    try {
      const denied = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        headers: { 'X-Dev-User': 'bodega@winecore.test' },
      }));
      expect(denied.status).toBe(403);
      expect((await json(denied)).code).toBe('WC_FORBIDDEN');

      const created = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'contacto-nuevo-01' },
        body: JSON.stringify(input()),
      }));
      expect(created.status).toBe(201);
      const contact = await json(created);
      expect(contact.legal_name).toBe('Bodega José Viñedo');
      expect(contact.email).toBe('jose@example.com');
      const id = String(contact.id);

      const found = await ctx.app.handle(new Request('http://localhost/v1/contacts?q=jose%20vinedo'));
      expect(found.status).toBe(200);
      const page = await json(found);
      const items = page.items as { id: string }[];
      expect(items.some((item) => item.id === id)).toBe(true);
      expect(page.total).toBe(1);

      const advisor = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}?include=addresses,persons`, {
        headers: { 'X-Dev-User': 'asesor@winecore.test' },
      }));
      const hidden = await json(advisor);
      expect(hidden.email).toBeNull();
      expect(hidden.phone).toBeNull();
      const persons = hidden.persons as { email: string | null }[];
      expect(persons[0]?.email).toBeNull();

      const duplicate = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'contacto-nuevo-02' },
        body: JSON.stringify(input({ legal_name: 'Otra bodega' })),
      }));
      expect(duplicate.status).toBe(409);
      const dupBody = await json(duplicate);
      expect(dupBody.code).toBe('WC_CONTACT_DUPLICATE_TAX_ID');
      expect((dupBody.details as { existing_id: string }).existing_id).toBe(id);

      const warned = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'contacto-aviso-01' },
        body: JSON.stringify(input({ legal_name: 'Control malo', tax_id: wrongTaxId('22222222'), email: 'aviso@example.com' })),
      }));
      expect(warned.status).toBe(201);
      const warning = await json(warned);
      expect(warning.tax_id_type).toBe('none');
      expect(typeof warning.tax_id_warning).toBe('string');
    } finally {
      await ctx.close();
    }
  });

  it('repite la misma respuesta con la misma clave y rechaza otro cuerpo', async () => {
    const ctx = await createTestApp();
    try {
      const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'contacto-idem-01' };
      const first = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST', headers, body: JSON.stringify(input({ tax_id: personTaxId('33333333'), email: 'idem@example.com', legal_name: 'Idem SL' })),
      }));
      const again = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST', headers, body: JSON.stringify(input({ tax_id: personTaxId('33333333'), email: 'idem@example.com', legal_name: 'Idem SL' })),
      }));
      expect(again.status).toBe(201);
      expect((await json(again)).id).toBe((await json(first)).id);
      const clash = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST', headers, body: JSON.stringify(input({ tax_id: personTaxId('44444444'), email: 'otro@example.com', legal_name: 'Otra' })),
      }));
      expect(clash.status).toBe(409);
      expect((await json(clash)).code).toBe('WC_IDEMPOTENCY_MISMATCH');
    } finally {
      await ctx.close();
    }
  });

  it('exige la versión al editar, archiva y exporta CSV', async () => {
    const ctx = await createTestApp();
    try {
      const created = await json(await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'contacto-version-1' },
        body: JSON.stringify(input({ tax_id: personTaxId('55555555'), email: 'version@example.com', legal_name: 'Versión SL' })),
      })));
      const id = String(created.id);
      const stale = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': '2000-01-01T00:00:00.000Z' },
        body: JSON.stringify(input({ tax_id: personTaxId('55555555'), email: 'version@example.com', legal_name: 'Versión nueva' })),
      }));
      expect(stale.status).toBe(409);
      expect((await json(stale)).code).toBe('WC_STALE_VERSION');

      const current = await json(await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}`)));
      const patched = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': String(current.updated_at) },
        body: JSON.stringify(input({ tax_id: personTaxId('55555555'), email: 'version@example.com', legal_name: 'Versión nueva' })),
      }));
      expect(patched.status).toBe(200);
      expect((await json(patched)).legal_name).toBe('Versión nueva');

      const address = await json(await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'billing', line1: 'Calle Ejemplo 1', postal_code: '00000', city: 'Ejemplo',
          province: 'Ejemplo', country_code: 'ES', is_default: true,
        }),
      })));
      const second = await json(await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'billing', line1: 'Calle Ejemplo 2', postal_code: '00000', city: 'Otra',
          country_code: 'ES', is_default: true,
        }),
      })));
      const detail = await json(await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}?include=addresses,persons`)));
      const addresses = detail.addresses as { id: string; is_default: boolean; city: string }[];
      expect(addresses.filter((row) => row.is_default)).toHaveLength(1);
      expect(addresses.find((row) => row.id === String(second.id))?.is_default).toBe(true);
      expect(detail.city).toBe('Otra');
      expect(addresses.find((row) => row.id === String(address.id))?.is_default).toBe(false);

      const person = await json(await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/persons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Ana Ejemplo', role: 'Compras', email: 'ana@example.com', phone: '100200301',
          receives_invoices: false, receives_dunning: true,
        }),
      })));
      const archivedPerson = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/persons/${String(person.id)}/archive`, { method: 'POST' }));
      expect(archivedPerson.status).toBe(200);
      const afterPerson = await json(await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}`)));
      expect((afterPerson.persons as { id: string }[]).some((row) => row.id === String(person.id))).toBe(false);

      const archived = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/archive`, { method: 'POST' }));
      expect(archived.status).toBe(200);
      const visible = await json(await ctx.app.handle(new Request('http://localhost/v1/contacts?archived=false')));
      expect((visible.items as { id: string }[]).some((item) => item.id === id)).toBe(false);
      const onlyArchived = await json(await ctx.app.handle(new Request('http://localhost/v1/contacts?archived=true')));
      expect((onlyArchived.items as { id: string }[]).some((item) => item.id === id)).toBe(true);
      await ctx.app.handle(new Request(`http://localhost/v1/contacts/${id}/unarchive`, { method: 'POST' }));

      const csv = await ctx.app.handle(new Request('http://localhost/v1/contacts/export.csv?q=version'));
      expect(csv.status).toBe(200);
      const bytes = new Uint8Array(await csv.clone().arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = await csv.text();
      expect(text).toContain('Nombre fiscal;Nombre comercial;NIF');
      expect(text).toContain('Versión nueva');
      const advisorCsv = await (await ctx.app.handle(new Request('http://localhost/v1/contacts/export.csv?q=version', {
        headers: { 'X-Dev-User': 'asesor@winecore.test' },
      }))).text();
      expect(advisorCsv).not.toContain('version@example.com');

      const history = await json(await ctx.app.handle(new Request('http://localhost/v1/audit?table=party.contact&limit=5')));
      const events = history.items as { actor: { display_name: string }; changes: { field: string }[]; action: string }[];
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.actor.display_name).toBe('Propietario');
      expect(events.some((event) => event.changes.some((change) => change.field === 'legal_name'))).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
