import type { KbClient } from '../../src/core/db/client';
import type { Writer } from '../../src/core/db/writer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Cellar {
  po: string;
  cvpo: string;
  ownerUser: string;
  warehouse: string;
  bod: string;
  vlc: string;
  tankPo: string;
  tankCvpo: string;
  barrel: string;
  tankVlc: string;
  lotPo: string;
  lotCvpo: string;
  lotBarrel: string;
  lotVlc: string;
  lotPack: string;
  wine: string;
  format: string;
  product: string;
}

const IDS = {
  warehouse: '019a1000-0000-7000-8000-000000000001',
  bod: '019a1000-0000-7000-8000-000000000010',
  vlc: '019a1000-0000-7000-8000-000000000011',
  tankPo: '019a1000-0000-7000-8000-000000000020',
  tankCvpo: '019a1000-0000-7000-8000-000000000021',
  barrel: '019a1000-0000-7000-8000-000000000022',
  tankVlc: '019a1000-0000-7000-8000-000000000023',
  lotPo: '019a1000-0000-7000-8000-000000000030',
  lotCvpo: '019a1000-0000-7000-8000-000000000031',
  lotBarrel: '019a1000-0000-7000-8000-000000000032',
  lotVlc: '019a1000-0000-7000-8000-000000000033',
  lotPack: '019a1000-0000-7000-8000-000000000034',
  wine: '019a1000-0000-7000-8000-000000000040',
  format: '019a1000-0000-7000-8000-000000000041',
  product: '019a1000-0000-7000-8000-000000000042',
} as const;

function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error(`uuid ${value}`);
  return `CAST('${value.toLowerCase()}' AS UUID)`;
}

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function seedCellar(client: KbClient): Promise<Cellar> {
  const entities = await client.query<{ id: string; code: string }>(
    `SELECT id, code FROM core.legal_entity WHERE code IN ('PO', 'CVPO')`,
  );
  const po = entities.find((row) => row.code === 'PO')?.id;
  const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
  const users = await client.query<{ id: string }>(
    `SELECT id FROM core.app_user WHERE email = 'owner@winecore.test'`,
  );
  const ownerUser = users[0]?.id;
  if (!po || !cvpo || !ownerUser) throw new Error('semilla incompleta');
  await client.query(`
    INSERT INTO catalog.wine (id, code, name, color, category, is_organic)
    VALUES (${uuid(IDS.wine)}, 'TINTO', 'Tinto Ejemplo', 'red', 'wine', TRUE);
    INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml)
    VALUES (${uuid(IDS.format)}, 'B075', 'Botella 0,75 L', 'bottle', 750);
    INSERT INTO catalog.product (
      id, sku, name, kind, wine_id, vintage, format_id, unit, nc_code, excise_product_key, alcohol_pct, requires_lot
    ) VALUES (
      ${uuid(IDS.product)}, 'TB-2025-075', 'Tinto Ejemplo 2025 0,75', 'wine',
      ${uuid(IDS.wine)}, 2025, ${uuid(IDS.format)}, 'ud', '22042138', 'B075-TINTO', 13.50, TRUE
    );
    INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test, is_active)
    VALUES (${uuid(IDS.warehouse)}, ${uuid(po)}, 'ES00TEST00001', 'V1', 'Fábrica Ejemplo', TRUE, TRUE);
    INSERT INTO inventory.location (id, code, name, kind, tax_warehouse_id, controlling_entity_id, is_virtual, is_active)
    VALUES
      (${uuid(IDS.bod)}, 'BOD', 'Bodega', 'cellar', ${uuid(IDS.warehouse)}, ${uuid(po)}, FALSE, TRUE),
      (${uuid(IDS.vlc)}, 'VLC', 'Valencia', 'own_warehouse', NULL, ${uuid(cvpo)}, FALSE, TRUE);
    INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, has_cooling_jacket, material, location_id, status)
    VALUES
      (${uuid(IDS.tankPo)}, 'INOX-01', 'Inox 1', 'tank_storage', 20000000, FALSE, 'stainless_steel', ${uuid(IDS.bod)}, 'in_service'),
      (${uuid(IDS.tankCvpo)}, 'INOX-02', 'Inox 2', 'tank_storage', 20000000, FALSE, 'stainless_steel', ${uuid(IDS.bod)}, 'in_service'),
      (${uuid(IDS.barrel)}, 'BAR-001', 'Barrica 1', 'barrel', 300000, FALSE, 'oak', ${uuid(IDS.bod)}, 'in_service'),
      (${uuid(IDS.tankVlc)}, 'INOX-V1', 'Inox Valencia', 'tank_storage', 20000000, FALSE, 'stainless_steel', ${uuid(IDS.vlc)}, 'in_service');
    INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin, status)
    VALUES
      (${uuid(IDS.lotPo)}, ${uuid(po)}, 'L25-T01', 'wine', ${uuid(IDS.wine)}, 2025, 'reception', 'active'),
      (${uuid(IDS.lotCvpo)}, ${uuid(po)}, 'L25-T02', 'wine', ${uuid(IDS.wine)}, 2025, 'reception', 'active'),
      (${uuid(IDS.lotBarrel)}, ${uuid(po)}, 'L24-C01', 'wine', ${uuid(IDS.wine)}, 2024, 'reception', 'active'),
      (${uuid(IDS.lotVlc)}, ${uuid(po)}, 'L25-V01', 'wine', ${uuid(IDS.wine)}, 2025, 'reception', 'active'),
      (${uuid(IDS.lotPack)}, ${uuid(po)}, 'L25-B075', 'bottled', ${uuid(IDS.wine)}, 2025, 'reception', 'active');
  `);
  return {
    po: po.toLowerCase(),
    cvpo: cvpo.toLowerCase(),
    ownerUser: ownerUser.toLowerCase(),
    warehouse: IDS.warehouse,
    bod: IDS.bod,
    vlc: IDS.vlc,
    tankPo: IDS.tankPo,
    tankCvpo: IDS.tankCvpo,
    barrel: IDS.barrel,
    tankVlc: IDS.tankVlc,
    lotPo: IDS.lotPo,
    lotCvpo: IDS.lotCvpo,
    lotBarrel: IDS.lotBarrel,
    lotVlc: IDS.lotVlc,
    lotPack: IDS.lotPack,
    wine: IDS.wine,
    format: IDS.format,
    product: IDS.product,
  };
}

export interface StockMoveInput {
  id: string;
  occurredAt: string;
  moveType: string;
  locationId: string;
  vesselId: string | null;
  ownerId: string;
  lotId: string | null;
  productId: string | null;
  productState: string;
  qtyUnits: number;
  volumeMl: number;
  massG?: number;
  lossKind?: string | null;
  sourceTable?: string;
  sourceId: string;
}

export async function insertStockMove(client: KbClient, move: StockMoveInput): Promise<void> {
  await client.query(`
    INSERT INTO inventory.stock_move (
      id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
      product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id, created_by
    ) VALUES (
      ${uuid(move.id)},
      CAST(${q(move.occurredAt)} AS TIMESTAMPTZ),
      ${q(move.moveType)},
      ${uuid(move.locationId)},
      ${move.vesselId ? uuid(move.vesselId) : 'NULL'},
      ${uuid(move.ownerId)},
      ${move.lotId ? uuid(move.lotId) : 'NULL'},
      ${move.productId ? uuid(move.productId) : 'NULL'},
      ${q(move.productState)},
      ${move.qtyUnits},
      ${move.volumeMl},
      ${move.massG ?? 0},
      ${move.lossKind ? q(move.lossKind) : 'NULL'},
      ${q(move.sourceTable ?? 'cellar.operation')},
      ${uuid(move.sourceId)},
      'test'
    )
  `);
}

export async function insertFiscalMove(client: KbClient, move: {
  id: string;
  warehouseId: string;
  fiscalDate: string;
  moveType: string;
  productClass: string;
  volumeMl: number;
  units?: number;
  lotId?: string | null;
  productId?: string | null;
  sourceId: string;
  reason?: string | null;
}): Promise<void> {
  await client.query(`
    INSERT INTO inventory.fiscal_move (
      id, tax_warehouse_id, fiscal_date, move_type, product_class, lot_id, product_id,
      volume_ml, units, justification_type, justification_ref, fiscal_trigger,
      source_table, source_id, reason, created_by
    ) VALUES (
      ${uuid(move.id)},
      ${uuid(move.warehouseId)},
      CAST(${q(move.fiscalDate)} AS DATE),
      ${q(move.moveType)},
      ${q(move.productClass)},
      ${move.lotId ? uuid(move.lotId) : 'NULL'},
      ${move.productId ? uuid(move.productId) : 'NULL'},
      ${move.volumeMl},
      ${move.units ?? 0},
      'internal',
      'TEST',
      'operation',
      'cellar.operation',
      ${uuid(move.sourceId)},
      ${move.reason ? q(move.reason) : 'NULL'},
      'test'
    )
  `);
}

export async function countTable(writer: Writer, table: 'inventory.stock_move' | 'inventory.fiscal_move'): Promise<number> {
  const rows = await writer.read<{ total: number }>(`SELECT count(*)::BIGINT AS total FROM ${table}`);
  return Number(rows[0]?.total ?? 0);
}

export function call(method: string, path: string, body?: unknown, user?: string): Request {
  const headers = new Headers();
  if (user) headers.set('x-dev-user', user);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function jsonOf<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}
