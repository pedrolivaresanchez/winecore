import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { businessDate } from '../../src/core/time';
import type { createTestApp } from '../helpers';

const CIF_LETTERS = 'JABCDEFGHI';
let cifSeq = 1_000_000 + Math.floor(Math.random() * 5_000);

export function companyCif(): string {
  cifSeq = (cifSeq + 1) % 10_000_000;
  const digits = String(cifSeq).padStart(7, '0');
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = digits.charCodeAt(index) - 48;
    if (index % 2 === 0) {
      const doubled = digit * 2;
      sum += Math.trunc(doubled / 10) + (doubled % 10);
    } else {
      sum += digit;
    }
  }
  const control = (10 - (sum % 10)) % 10;
  const letter = CIF_LETTERS[control] ?? 'J';
  void letter;
  return `B${digits}${control}`;
}

export type SalesFixture = {
  po: string;
  cvpo: string;
  owner: string;
  year: number;
  warehouse: string;
  bod: string;
  vlc: string;
  tfrp: string;
  dev: string;
  cli: string;
  wine: string;
  format: string;
  product: string;
  lot: string;
  shortLot: string;
  priceList: string;
  customer: string;
  customerCif: string;
  other: string;
  otherCif: string;
  cvpoBuyer: string;
  cvpoBuyerCif: string;
  eci: string;
  eciCif: string;
  carrier: string;
};

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

export async function buildSalesFixture(
  ctx: Ctx,
  options: { rules?: boolean; series?: boolean } = {},
): Promise<SalesFixture> {
  const entities = await ctx.writer.read<{ id: string; code: string }>(
    `SELECT id, code FROM core.legal_entity`,
  );
  const po = idOf(entities.find((row) => row.code === 'PO')?.id);
  const cvpo = idOf(entities.find((row) => row.code === 'CVPO')?.id);
  const users = await ctx.writer.read<{ id: string; email: string }>(`SELECT id, email FROM core.app_user`);
  const owner = idOf(users.find((row) => row.email === 'owner@winecore.test')?.id);
  const year = Number(businessDate(new Date()).slice(0, 4));
  const yy = String(year).slice(2);
  const fx: SalesFixture = {
    po, cvpo, owner, year,
    warehouse: newId(),
    bod: newId(),
    vlc: newId(),
    tfrp: newId(),
    dev: newId(),
    cli: newId(),
    wine: newId(),
    format: newId(),
    product: newId(),
    lot: newId(),
    shortLot: newId(),
    priceList: newId(),
    customer: newId(),
    customerCif: companyCif(),
    other: newId(),
    otherCif: companyCif(),
    cvpoBuyer: newId(),
    cvpoBuyerCif: companyCif(),
    eci: newId(),
    eciCif: companyCif(),
    carrier: newId(),
  };
  const version = newId();
  const actor = { type: 'system' as const, id: 'sales-fixture', requestId: newId() };
  await ctx.writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
      VALUES (CAST(${fx.warehouse} AS UUID), CAST(${po} AS UUID), 'ES00000000000', 'V1', 'Fábrica ejemplo', TRUE)
    `);
    tx.write(sql`
      INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_logistics_operator, created_by)
      VALUES (CAST(${fx.carrier} AS UUID), 'company', 'Operador Logístico Ejemplo', ${companyCif()}, 'nif', 'ES', 'ES', TRUE, ${owner})
    `);
    const locations: [string, string, string, string, string | null, boolean][] = [
      [fx.bod, 'BOD', 'Bodega', 'cellar', fx.warehouse, false],
      [fx.vlc, 'VLC', 'Valencia', 'own_warehouse', null, false],
      [fx.tfrp, 'TFRP', 'Operador', 'third_party_warehouse', null, false],
      [fx.dev, 'DEV', 'Devoluciones', 'own_warehouse', null, false],
      [fx.cli, 'CLI', 'Cliente virtual', 'customer_virtual', null, true],
    ];
    for (const [id, code, name, kind, warehouse, virtual] of locations) {
      const controller = code === 'VLC' ? cvpo : po;
      tx.write(sql`
        INSERT INTO inventory.location (
          id, code, name, kind, tax_warehouse_id, operator_contact_id, controlling_entity_id, is_virtual
        ) VALUES (
          CAST(${id} AS UUID), ${code}, ${name}, ${kind},
          CASE WHEN ${warehouse} IS NULL THEN NULL ELSE CAST(${warehouse} AS UUID) END,
          CASE WHEN ${kind === 'third_party_warehouse' ? fx.carrier : null} IS NULL THEN NULL ELSE CAST(${fx.carrier} AS UUID) END,
          CAST(${controller} AS UUID), ${virtual}
        )
      `);
    }
    tx.write(sql`
      INSERT INTO catalog.wine (id, code, name, color) VALUES (CAST(${fx.wine} AS UUID), 'TINTOEX', 'Tinto Ejemplo', 'red')
    `);
    tx.write(sql`
      INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml)
      VALUES (CAST(${fx.format} AS UUID), 'B075', 'Botella 0,75 L', 'bottle', 750)
    `);
    tx.write(sql`
      INSERT INTO catalog.product (
        id, sku, name, kind, wine_id, vintage, format_id, gtin, default_tax_code, requires_lot, is_stock_tracked
      ) VALUES (
        CAST(${fx.product} AS UUID), 'TINTO2025B075', 'Tinto Ejemplo 2025 0,75', 'wine',
        CAST(${fx.wine} AS UUID), 2025, CAST(${fx.format} AS UUID), '8400000000017', 'IVA21', TRUE, TRUE
      )
    `);
    for (const [id, code] of [[fx.lot, 'L25T01B1'], [fx.shortLot, 'LSHORT01']] as const) {
      tx.write(sql`
        INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin)
        VALUES (CAST(${id} AS UUID), CAST(${po} AS UUID), ${code}, 'bottled', CAST(${fx.wine} AS UUID), 2025, 'opening_count')
      `);
    }
    const opening = (lot: string, qty: number) => {
      const id = newId();
      tx.write(sql`
        INSERT INTO inventory.stock_move (
          id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id, product_state,
          qty_units, volume_ml, mass_g, source_table, source_id, created_by
        ) VALUES (
          CAST(${id} AS UUID), TIMESTAMPTZ '2026-10-01 10:00:00+02', 'opening',
          CAST(${fx.bod} AS UUID), CAST(${po} AS UUID), CAST(${lot} AS UUID), CAST(${fx.product} AS UUID),
          'packaged_labeled', ${qty}, ${qty * 750}, 0, 'inventory.inventory_count', CAST(${newId()} AS UUID), 'fixture'
        )
      `);
    };
    opening(fx.lot, 10000);
    opening(fx.shortLot, 2);
    tx.write(sql`
      INSERT INTO catalog.price_list (id, code, name) VALUES (CAST(${fx.priceList} AS UUID), 'distributor', 'Distribuidor')
    `);
    tx.write(sql`
      INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by, activated_at)
      VALUES (CAST(${version} AS UUID), CAST(${fx.priceList} AS UUID), 1, DATE '2026-01-01', 'active', ${owner}, now())
    `);
    tx.write(sql`
      INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price) VALUES
        (CAST(${newId()} AS UUID), CAST(${version} AS UUID), CAST(${fx.product} AS UUID), 1, 9.5),
        (CAST(${newId()} AS UUID), CAST(${version} AS UUID), CAST(${fx.product} AS UUID), 24, 9)
    `);
    const people: [string, string, string, string, string][] = [
      [fx.customer, 'Cliente Ejemplo', fx.customerCif, 'horeca', fx.priceList],
      [fx.other, 'Cliente Canal', fx.otherCif, 'direct', fx.priceList],
      [fx.cvpoBuyer, 'Cliente CVPO', fx.cvpoBuyerCif, 'horeca', fx.priceList],
      [fx.eci, 'Cliente ECI Ejemplo', fx.eciCif, 'eci_edi', fx.priceList],
    ];
    for (const [id, name, cif, channel, list] of people) {
      tx.write(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code,
          is_customer, default_channel, default_price_list_id, created_by
        ) VALUES (
          CAST(${id} AS UUID), 'company', ${name}, ${cif}, 'nif', 'ES', 'ES', TRUE, ${channel},
          CAST(${list} AS UUID), ${owner}
        )
      `);
    }
    const docs: [string, string, string][] = options.series === false ? [] : [
      ['sales_order', 'PED', `P${yy}-`],
      ['delivery_note', 'ALB', `A${yy}-`],
      ['quote', 'PRE', `Q${yy}-`],
      ['proforma', 'PRO', `F${yy}-`],
    ];
    for (const entity of [po, cvpo]) {
      for (const [doc, code, prefix] of docs) {
        tx.write(sql`
          INSERT INTO core.number_series (
            id, legal_entity_id, doc_type, code, "year", prefix, padding, is_default, verifactu
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${entity} AS UUID), ${doc}, ${code}, ${year}, ${prefix}, 4, TRUE, FALSE
          )
        `);
      }
    }
  });
  if (options.rules !== false) await activateRules(ctx, fx);
  return fx;
}

async function activateRules(ctx: Ctx, fx: SalesFixture): Promise<void> {
  const created = await json(ctx, 'POST', '/v1/billing-rules/sets', { notes: 'inicial' });
  const setId = String(created.id);
  const put = await ctx.app.handle(req('PUT', `/v1/billing-rules/sets/${setId}/rules`, {
    rules: [
      { scope: 'customer', customer_id: fx.customer, issuing_entity_id: fx.po, notes: 'cliente ejemplo' },
      { scope: 'customer', customer_id: fx.cvpoBuyer, issuing_entity_id: fx.cvpo },
      { scope: 'customer', customer_id: fx.eci, issuing_entity_id: fx.po },
      { scope: 'channel', channel: 'horeca', issuing_entity_id: fx.po },
      { scope: 'default', issuing_entity_id: fx.cvpo },
    ],
  }));
  if (put.status !== 200) throw new Error(await put.text());
  await approveSet(ctx, setId);
}

export async function approveSet(ctx: Ctx, setId: string): Promise<void> {
  const requested = await json(ctx, 'POST', `/v1/billing-rules/sets/${setId}/request-activation`, {});
  const approvalId = String(requested.approval_request_id);
  await ctx.client.query(sql`
    UPDATE ops.approval_request
    SET status = 'approved', approved_at = now()
    WHERE id = CAST(${approvalId} AS UUID)
  `);
  const activated = await ctx.app.handle(req('POST', `/v1/billing-rules/sets/${setId}/activate`));
  if (activated.status !== 200) throw new Error(await activated.text());
}

export function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function json(ctx: Ctx, method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const response = await ctx.app.handle(req(method, path, body, headers));
  const payload = await response.json() as Record<string, unknown>;
  if (response.status >= 400) {
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

export async function call(ctx: Ctx, method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const response = await ctx.app.handle(req(method, path, body, headers));
  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, body: payload, text };
}

function idOf(value: unknown): string {
  if (value == null) throw new Error('id ausente');
  return String(value).toLowerCase();
}
