import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { newId } from '../ids';

const ACTOR = { type: 'migration' as const, id: '019c0000-0000-7000-8000-0000000000ac', requestId: 'reconcile-catalog' };
const REPAIR = 'catalog-bodega-2026-11';

/**
 * Pares de vinos, por código de ficha. XPO-2016 entra en XPO-INTERACTION.
 * O1 se une por código de vino. LEM2023 es el lote y el SKU, no la ficha que se apaga.
 */
const WINE_PAIRS: { keep: string; drop: string; why: string }[] = [
  { keep: 'ARCAL', drop: 'ARCAL-2023', why: 'ARCAL-2023 no tiene formato. Se queda ARCAL.' },
  { keep: 'XPO-INTERACTION', drop: 'XPO-2016', why: 'Una sola XPO: XPO-2016 entra en XPO-INTERACTION.' },
  { keep: 'O1', drop: 'LA-GRAN-OXIDACION-O1-2023-B050', why: 'O1 se une por código de vino, no por el lote LEM2023.' },
];

/** SKU concreto de cada línea que no casó. No se elige el primer producto parecido. */
const STOCK_LINES = [
  { sku: 'ARCAL-2023', lot: '2023', where: 'TFRP', bottles: 1254, ml: 750 },
  { sku: 'ARCAL-2023', lot: '2023', where: 'BOD', bottles: 912, ml: 750 },
  { sku: 'XPO-2016', lot: 'L2021/E1001', where: 'BOD', bottles: 27, ml: 750 },
  { sku: 'LEM2023', lot: 'LEM2023', where: 'BOD', bottles: 70, ml: 500 },
];

const NOTE_B12 = 'La copia tenía 150 L en B12 y B13. La hoja dice 300 L. Se usa la hoja: la reversa anula lo que se abrió en B12 y B13, y BAR-12 y BAR-13 conservan el aforo de la hoja.';

export type ReconcileReport = {
  mode: 'dry-run' | 'apply' | 'revert';
  merges: { keep: string; drop: string; why: string; refs: number }[];
  detected: { keep: string; drop: string; why: string }[];
  entredicho: string[];
  locations: string[];
  stock: string[];
  notes: string[];
  skipped: string[];
};

type WineRow = { id: string; code: string; name: string; active: boolean };

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function stem(code: string): string {
  return code.replace(/-\d{2,4}$/, '').replace(/\d{4}$/, '');
}

export async function reconcileCatalog(writer: Writer, mode: ReconcileReport['mode']): Promise<ReconcileReport> {
  if (mode === 'revert') return revert(writer);
  const report = await plan(writer);
  report.mode = mode;
  if (mode === 'dry-run') return report;
  const prior = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM ops.data_repair WHERE code = ${REPAIR} AND reverted_at IS NULL
  `);
  if (prior.length > 0) {
    report.skipped.push('Ya está aplicada. Para deshacerla: bun run db/reconcile-catalog.ts --revert');
    return report;
  }
  // Cada withWrite es una transacción. DuckDB mira las FK contra el estado
  // anterior, así que un UPDATE y el repunte de sus hijas no pueden ir juntos.
  // Aquí no hay UPDATE de filas referenciadas: solo inserciones en tablas laterales
  // y movimientos nuevos.
  const journal: unknown[] = [];
  await writer.withWrite(ACTOR, async (tx) => {
    for (const pair of report.merges) journal.push(await mergeWine(tx, pair.keep, pair.drop));
    journal.push(await splitEntredicho(tx, report));
    journal.push(await repairLocations(tx, report));
  });
  await writer.withWrite(ACTOR, async (tx) => {
    journal.push(await topUpStock(tx, report));
  });
  await writer.withWrite(ACTOR, async (tx) => {
    tx.write(sql`
      INSERT INTO ops.data_repair (id, code, payload)
      VALUES (CAST(${newId()} AS UUID), ${REPAIR}, ${sql.json({ steps: journal, notes: report.notes })})
    `);
  });
  return report;
}

async function plan(writer: Writer): Promise<ReconcileReport> {
  const wines = await loadWines(writer);
  const byCode = new Map(wines.map((row) => [row.code, row]));
  const report: ReconcileReport = {
    mode: 'dry-run',
    merges: [],
    detected: [],
    entredicho: [],
    locations: [],
    stock: [],
    notes: [NOTE_B12, 'Granel objetivo tras la reversa de B10, B12, B13, B18 y B19: 12.354,35 L.'],
    skipped: [],
  };
  const seen = new Set<string>();
  for (const pair of WINE_PAIRS) {
    const keep = byCode.get(pair.keep);
    const drop = byCode.get(pair.drop);
    if (!keep || !drop) {
      report.skipped.push(`No está el par ${pair.keep} / ${pair.drop}`);
      continue;
    }
    if (!drop.active && drop.id) {
      report.skipped.push(`${pair.drop} ya está inactiva`);
      continue;
    }
    seen.add(pair.drop);
    report.merges.push({ ...pair, refs: await refCount(writer, drop.id) });
  }
  for (const drop of wines) {
    if (!drop.active || seen.has(drop.code)) continue;
    const base = stem(drop.code);
    if (base === drop.code) continue;
    const keep = byCode.get(base);
    if (!keep || !keep.active || keep.id === drop.id) continue;
    seen.add(drop.code);
    const why = `${drop.code} repite la ficha ${base}.`;
    report.detected.push({ keep: keep.code, drop: drop.code, why });
    report.merges.push({ keep: keep.code, drop: drop.code, why, refs: await refCount(writer, drop.id) });
  }
  const entredicho = wines.filter((row) => fold(row.name).includes('entredicho') && !fold(row.name).includes('bobastrell') && row.active);
  if (entredicho.length > 0) {
    report.entredicho.push('enTreDicho 2020-2022 se queda el lote E202122. enTreDicho 2023-2024 se queda el lote 202324.');
    report.entredicho.push('Bobastrell etiquetado desde jaulones de enTreDicho conserva el lote de enTreDicho.');
  } else {
    report.skipped.push('No hay un vino enTreDicho activo');
  }
  return report;
}

async function loadWines(writer: Writer): Promise<WineRow[]> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT w.id::VARCHAR AS id, w.code, COALESCE(o.name, w.name) AS name,
           (w.is_active AND NOT COALESCE(o.hidden, FALSE)) AS is_active
    FROM catalog.wine w
    LEFT JOIN catalog.wine_overlay o ON o.wine_id = w.id
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    code: String(row.code),
    name: String(row.name),
    active: row.is_active === true || row.is_active === 'true',
  }));
}

async function refCount(writer: Writer, wineId: string): Promise<number> {
  const rows = await writer.read<{ n: unknown }>(sql`
    SELECT count(*) AS n FROM inventory.lot WHERE wine_id = CAST(${wineId} AS UUID)
  `);
  return Number(rows[0]?.n ?? 0);
}


type Tx = Parameters<Parameters<Writer['withWrite']>[1]>[0];

async function mergeWine(tx: Tx, keepCode: string, dropCode: string): Promise<unknown> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code FROM catalog.wine WHERE code IN (${keepCode}, ${dropCode})
  `);
  const keep = rows.find((row) => row.code === keepCode);
  const drop = rows.find((row) => row.code === dropCode);
  if (!keep || !drop) return { keep: keepCode, drop: dropCode, skipped: true };
  const keepId = idOf(keep.id);
  const dropId = idOf(drop.id);
  tx.write(sql`
    INSERT INTO catalog.wine_overlay (wine_id, merged_into_id, hidden)
    SELECT CAST(${dropId} AS UUID), CAST(${keepId} AS UUID), TRUE
    WHERE NOT EXISTS (SELECT 1 FROM catalog.wine_overlay WHERE wine_id = CAST(${dropId} AS UUID))
  `);
  const products = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, sku, format_id::VARCHAR AS format_id, vintage::VARCHAR AS vintage
    FROM catalog.product WHERE wine_id = CAST(${dropId} AS UUID)
  `);
  const kept = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, format_id::VARCHAR AS format_id, vintage::VARCHAR AS vintage
    FROM catalog.product WHERE wine_id = CAST(${keepId} AS UUID)
  `);
  const hidden: string[] = [];
  for (const product of products) {
    const twin = kept.find((row) => row.format_id && row.format_id === product.format_id && row.vintage === product.vintage);
    const productId = idOf(product.id);
    if (twin) {
      tx.write(sql`
        INSERT INTO catalog.product_overlay (product_id, merged_into_id, wine_id, hidden, for_sale)
        SELECT CAST(${productId} AS UUID), CAST(${idOf(twin.id)} AS UUID), CAST(${keepId} AS UUID), TRUE, FALSE
        WHERE NOT EXISTS (SELECT 1 FROM catalog.product_overlay WHERE product_id = CAST(${productId} AS UUID))
      `);
      hidden.push(String(product.sku));
    } else {
      tx.write(sql`
        INSERT INTO catalog.product_overlay (product_id, wine_id, hidden)
        SELECT CAST(${productId} AS UUID), CAST(${keepId} AS UUID), FALSE
        WHERE NOT EXISTS (SELECT 1 FROM catalog.product_overlay WHERE product_id = CAST(${productId} AS UUID))
      `);
    }
  }
  const lots = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM inventory.lot WHERE wine_id = CAST(${dropId} AS UUID)
  `);
  for (const lot of lots) {
    const lotId = idOf(lot.id);
    tx.write(sql`
      INSERT INTO inventory.lot_overlay (lot_id, wine_id)
      SELECT CAST(${lotId} AS UUID), CAST(${keepId} AS UUID)
      WHERE NOT EXISTS (SELECT 1 FROM inventory.lot_overlay WHERE lot_id = CAST(${lotId} AS UUID))
    `);
  }
  return { keep: keepCode, drop: dropCode, hidden };
}

async function splitEntredicho(tx: Tx, report: ReconcileReport): Promise<unknown> {
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT w.id::VARCHAR AS id, w.code, COALESCE(o.name, w.name) AS name, w.color
    FROM catalog.wine w
    LEFT JOIN catalog.wine_overlay o ON o.wine_id = w.id
    WHERE w.is_active AND NOT COALESCE(o.hidden, FALSE)
      AND lower(w.name) LIKE '%entredicho%' AND lower(w.name) NOT LIKE '%bobastrell%'
  `);
  const canonical = rows.find((row) => String(row.code) === 'ENTREDICHO') ?? rows[0];
  if (!canonical) return { skipped: true };
  const earlyId = idOf(canonical.id);
  tx.write(sql`
    INSERT INTO catalog.wine_overlay (wine_id, name, hidden)
    SELECT CAST(${earlyId} AS UUID), 'enTreDicho 2020-2022', FALSE
    WHERE NOT EXISTS (SELECT 1 FROM catalog.wine_overlay WHERE wine_id = CAST(${earlyId} AS UUID))
  `);
  const existing = await tx.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM catalog.wine WHERE code = 'ENTREDICHO-2324'`);
  let lateId = existing[0] ? idOf(existing[0].id) : '';
  if (!lateId) {
    lateId = newId();
    tx.write(sql`
      INSERT INTO catalog.wine (id, code, name, color, category, is_organic, is_active)
      VALUES (
        CAST(${lateId} AS UUID), 'ENTREDICHO-2324', 'enTreDicho 2023-2024',
        ${String(canonical.color ?? 'red')}, 'wine', TRUE, TRUE
      )
    `);
  }
  const lateProducts = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM catalog.product
    WHERE wine_id = CAST(${earlyId} AS UUID)
      AND (vintage IN (2023, 2024) OR lower(name) LIKE '%2023-2024%' OR lower(name) LIKE '%23-24%')
  `);
  for (const product of lateProducts) {
    tx.write(sql`
      INSERT INTO catalog.product_overlay (product_id, wine_id, hidden)
      SELECT CAST(${idOf(product.id)} AS UUID), CAST(${lateId} AS UUID), FALSE
      WHERE NOT EXISTS (SELECT 1 FROM catalog.product_overlay WHERE product_id = CAST(${idOf(product.id)} AS UUID))
    `);
  }
  const lateLots = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM inventory.lot
    WHERE code = '202324' OR code LIKE '%202324%'
  `);
  for (const lot of lateLots) {
    tx.write(sql`
      INSERT INTO inventory.lot_overlay (lot_id, wine_id)
      SELECT CAST(${idOf(lot.id)} AS UUID), CAST(${lateId} AS UUID)
      WHERE NOT EXISTS (SELECT 1 FROM inventory.lot_overlay WHERE lot_id = CAST(${idOf(lot.id)} AS UUID))
    `);
  }
  report.entredicho.push('El nombre nuevo vive en catalog.wine_overlay. El lote 202324 apunta al vino nuevo desde inventory.lot_overlay. Bobastrell no cambia de lote.');
  return { earlyId, lateId, created: !existing[0] };
}

const BARREL_CODES = ['BAR-01', 'BAR-02', 'BAR-03', 'BAR-04', 'BAR-05', 'BAR-06', 'BAR-07', 'BAR-08', 'BAR-10', 'BAR-11', 'BAR-12', 'BAR-13', 'BAR-15', 'BAR-17', 'BAR-18', 'BAR-19'];
const REVERSE_CODES = ['B10', 'B12', 'B13', 'B18', 'B19'];

function barrelSlot(index: number): { x: number; y: number; width: number; height: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 48 + col * 118, y: 96 + row * 112, width: 108, height: 64 };
}

async function repairLocations(tx: Tx, report: ReconcileReport): Promise<unknown> {
  const zones = await tx.read<Record<string, unknown>>(`SELECT id::VARCHAR AS id, code FROM cellar.zone`);
  const zoneByCode = new Map(zones.map((row) => [String(row.code), idOf(row.id)]));
  const rename: [string, string][] = [['BARR', 'Barricas'], ['DAMA', 'Damajuanas (exterior)']];
  for (const [code, name] of rename) {
    const id = zoneByCode.get(code);
    if (!id) continue;
    tx.write(sql`
      INSERT INTO cellar.zone_overlay (zone_id, name, hidden)
      SELECT CAST(${id} AS UUID), ${name}, FALSE
      WHERE NOT EXISTS (SELECT 1 FROM cellar.zone_overlay WHERE zone_id = CAST(${id} AS UUID))
    `);
  }
  for (const code of ['SALA', 'EXT', 'ELAB', 'BOT']) {
    const id = zoneByCode.get(code);
    if (!id) continue;
    tx.write(sql`
      INSERT INTO cellar.zone_overlay (zone_id, hidden)
      SELECT CAST(${id} AS UUID), TRUE
      WHERE NOT EXISTS (SELECT 1 FROM cellar.zone_overlay WHERE zone_id = CAST(${id} AS UUID))
    `);
  }
  report.locations.push('BARR se lee como Barricas y DAMA como Damajuanas (exterior). SALA, EXT, ELAB y BOT quedan ocultas. La fila original no se actualiza.');
  report.notes.push(NOTE_B12);

  const vessels = await tx.read<Record<string, unknown>>(`SELECT id::VARCHAR AS id, code FROM cellar.vessel`);
  const byCode = new Map(vessels.map((row) => [String(row.code), row]));
  for (const code of REVERSE_CODES) {
    const vessel = byCode.get(code);
    if (!vessel) {
      report.skipped.push(`No está el recipiente ${code}`);
      continue;
    }
    const vesselId = idOf(vessel.id);
    tx.write(sql`
      INSERT INTO cellar.vessel_overlay (vessel_id, status)
      SELECT CAST(${vesselId} AS UUID), 'retired'
      WHERE NOT EXISTS (SELECT 1 FROM cellar.vessel_overlay WHERE vessel_id = CAST(${vesselId} AS UUID))
    `);
    const moves = await tx.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, volume_ml::VARCHAR AS volume_ml, qty_units::VARCHAR AS qty_units,
             location_id::VARCHAR AS location_id, owner_entity_id::VARCHAR AS owner_entity_id,
             lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id, product_state
      FROM inventory.stock_move
      WHERE vessel_id = CAST(${vesselId} AS UUID)
        AND move_type = 'opening' AND volume_ml > 0
        AND NOT EXISTS (SELECT 1 FROM inventory.stock_move rev WHERE rev.reverses_move_id = inventory.stock_move.id)
    `);
    for (const move of moves) {
      const volume = -Number(move.volume_ml ?? 0);
      const units = -Number(move.qty_units ?? 0);
      tx.write(sql`
        INSERT INTO inventory.stock_move (
          id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
          product_state, qty_units, volume_ml, mass_g, source_table, source_id, reverses_move_id, created_by
        ) VALUES (
          CAST(${newId()} AS UUID), now(), 'reversal',
          CAST(${idOf(move.location_id)} AS UUID), CAST(${vesselId} AS UUID),
          CAST(${idOf(move.owner_entity_id)} AS UUID),
          CASE WHEN ${move.lot_id == null ? null : idOf(move.lot_id)} IS NULL THEN NULL ELSE CAST(${move.lot_id == null ? null : idOf(move.lot_id)} AS UUID) END,
          CASE WHEN ${move.product_id == null ? null : idOf(move.product_id)} IS NULL THEN NULL ELSE CAST(${move.product_id == null ? null : idOf(move.product_id)} AS UUID) END,
          ${String(move.product_state)}, ${units}, ${volume}, 0,
          'ops.data_repair', CAST(${newId()} AS UUID), CAST(${idOf(move.id)} AS UUID), 'reconcile-catalog'
        )
      `);
      report.locations.push(`Reversa de la apertura de ${code}: ${(volume / 1000).toFixed(2)} L. No se envía a SILICIE.`);
    }
  }
  const legacy = vessels.filter((row) => /^B\d+$/.test(String(row.code)) || /^DAMAJUANA-\d+$/.test(String(row.code)));
  for (const row of legacy) {
    const id = idOf(row.id);
    tx.write(sql`
      INSERT INTO cellar.vessel_overlay (vessel_id, status)
      SELECT CAST(${id} AS UUID), 'retired'
      WHERE NOT EXISTS (SELECT 1 FROM cellar.vessel_overlay WHERE vessel_id = CAST(${id} AS UUID))
    `);
  }
  if (legacy.length > 0) report.locations.push(`${legacy.length} recipientes B o DAMAJUANA-n se leen como baja, sin actualizar la fila.`);

  const zoneId = zoneByCode.get('BARR') ?? '';
  if (!zoneId) {
    report.skipped.push('No hay zona BARR para colocar las barricas');
    return { placements: 0 };
  }
  let placed = 0;
  for (const [index, code] of BARREL_CODES.entries()) {
    const vessel = byCode.get(code);
    if (!vessel) continue;
    const slot = barrelSlot(index);
    tx.write(sql`
      INSERT INTO cellar.plan_position (id, zone_id, vessel_id, x, y, width, height, rotation)
      SELECT CAST(${newId()} AS UUID), CAST(${zoneId} AS UUID), CAST(${idOf(vessel.id)} AS UUID),
             ${slot.x}, ${slot.y}, ${slot.width}, ${slot.height}, 0
      WHERE NOT EXISTS (SELECT 1 FROM cellar.plan_position WHERE vessel_id = CAST(${idOf(vessel.id)} AS UUID))
    `);
    placed += 1;
  }
  report.locations.push(`${placed} barricas BAR quedan en el plano de Barricas si aún no tenían posición.`);
  return { placed };
}

async function topUpStock(tx: Tx, report: ReconcileReport): Promise<unknown> {
  const already = await tx.read<{ n: unknown }>(`
    SELECT count(*) AS n FROM inventory.stock_move WHERE created_by = 'reconcile-catalog-stock'
  `);
  if (Number(already[0]?.n ?? 0) > 0) {
    report.stock.push('Las líneas que no casaron ya están cargadas.');
    return { skipped: true };
  }
  const entities = await tx.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM core.legal_entity`);
  const po = entities.find((row) => row.code === 'PO');
  const cvpo = entities.find((row) => row.code === 'CVPO');
  const locations = await tx.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM inventory.location`);
  let loaded = 0;
  for (const line of STOCK_LINES) {
    const product = await tx.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM catalog.product WHERE sku = ${line.sku} LIMIT 1
    `);
    const place = locations.find((row) => row.code === line.where);
    const owner = line.where === 'TFRP' ? cvpo : po;
    const lot = await tx.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM inventory.lot WHERE code = ${line.lot} LIMIT 1
    `);
    if (!product[0] || !place || !owner || !lot[0]) {
      report.stock.push(`Sin SKU ${line.sku}, lote ${line.lot} o ubicación ${line.where}. No se inventa la línea.`);
      continue;
    }
    tx.write(sql`
      INSERT INTO inventory.stock_move (
        id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id,
        product_state, qty_units, volume_ml, mass_g, source_table, source_id, created_by
      ) VALUES (
        CAST(${newId()} AS UUID), now(), 'opening',
        CAST(${idOf(place.id)} AS UUID), CAST(${idOf(owner.id)} AS UUID),
        CAST(${idOf(lot[0].id)} AS UUID), CAST(${idOf(product[0].id)} AS UUID),
        'packaged_labeled', ${line.bottles}, ${line.bottles * line.ml}, 0,
        'ops.data_repair', CAST(${newId()} AS UUID), 'reconcile-catalog-stock'
      )
    `);
    loaded += 1;
    report.stock.push(`${line.sku} lote ${line.lot}: ${line.bottles} bot. en ${line.where}.`);
  }
  report.stock.push('Objetivo de la hoja: bodega 14.094 bot. / 10.652,00 L; TFRP 8.394 bot. / 6.295,50 L.');
  return { loaded };
}

const FICHAS = 'catalog-fichas-2026-11';
const FORMATLESS_SKUS = ['ECLO-2022', 'ENTREDICHO-2122', 'MOLINERA-2023', 'NEBBIA-2022'];

export type FichasReport = {
  mode: 'dry-run' | 'apply' | 'revert';
  xpo: string[];
  o1: string[];
  hidden: string[];
  kept: string[];
  notes: string[];
  skipped: string[];
};

type OverlayBefore = {
  merged_into_id: string | null;
  name: string | null;
  wine_id: string | null;
  hidden: boolean;
  for_sale: boolean | null;
};

type FichasChange = {
  kind: 'wine' | 'product' | 'lot';
  id: string;
  before: OverlayBefore | null;
};

type FichasOp =
  | { op: 'hide-wine'; id: string; into: string }
  | { op: 'point-product'; id: string; wineId: string }
  | { op: 'point-lot'; id: string; wineId: string }
  | { op: 'hide-product'; id: string; into: string | null };

function emptyFichas(mode: FichasReport['mode']): FichasReport {
  return { mode, xpo: [], o1: [], hidden: [], kept: [], notes: [], skipped: [] };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Segundo paso, con su propio código. No repite catalog-bodega-2026-11.
 * XPO entra en XPO-INTERACTION. O1 no une vinos: OXIDACION también lleva el O2.
 */
export async function reconcileFichas(writer: Writer, mode: FichasReport['mode']): Promise<FichasReport> {
  if (mode === 'revert') return revertFichas(writer);
  const prior = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM ops.data_repair WHERE code = ${FICHAS} AND reverted_at IS NULL
  `);
  if (prior.length > 0) {
    const report = emptyFichas(mode);
    report.skipped.push('Ya está aplicada. Para deshacerla: bun run db/reconcile-catalog.ts --fichas --revert');
    return report;
  }
  const planned = await planFichas(writer);
  planned.report.mode = mode;
  if (mode === 'dry-run') return planned.report;
  const changes: FichasChange[] = [];
  await writer.withWrite(ACTOR, async (tx) => {
    for (const op of planned.ops) changes.push(...await runFichasOp(tx, op));
    tx.write(sql`
      INSERT INTO ops.data_repair (id, code, payload)
      VALUES (CAST(${newId()} AS UUID), ${FICHAS}, ${sql.json({ changes })})
    `);
  });
  return planned.report;
}

async function planFichas(writer: Writer): Promise<{ report: FichasReport; ops: FichasOp[] }> {
  const report = emptyFichas('dry-run');
  const ops: FichasOp[] = [];
  report.notes.push('No se actualiza ninguna fila referenciada. Solo tablas laterales.');
  report.notes.push('OXIDACION no se une: ese vino también lleva el O2 (LEO22023).');
  const wines = await writer.read<{ id: string; code: string }>(sql`
    SELECT id::VARCHAR AS id, code FROM catalog.wine WHERE code IN ('XPO-INTERACTION', 'XPO', 'LA-GRAN-OXIDACION-O1', 'OXIDACION')
  `);
  const wineByCode = new Map(wines.map((row) => [row.code, idOf(row.id)]));
  const keep = wineByCode.get('XPO-INTERACTION');
  const drop = wineByCode.get('XPO');
  if (!keep || !drop) {
    report.skipped.push('No está el par XPO-INTERACTION / XPO');
  } else {
    report.xpo.push('XPO entra en XPO-INTERACTION. La ficha XPO se oculta.');
    ops.push({ op: 'hide-wine', id: drop, into: keep });
    const products = await writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, sku, format_id::VARCHAR AS format_id, vintage::VARCHAR AS vintage
      FROM catalog.product WHERE wine_id = CAST(${drop} AS UUID)
    `);
    const kept = await writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, format_id::VARCHAR AS format_id, vintage::VARCHAR AS vintage
      FROM catalog.product WHERE wine_id = CAST(${keep} AS UUID)
    `);
    for (const product of products) {
      const twin = kept.find((row) => row.format_id && row.format_id === product.format_id && row.vintage === product.vintage);
      if (twin) {
        report.hidden.push(`${String(product.sku)} se oculta dentro del producto de XPO-INTERACTION.`);
        ops.push({ op: 'hide-product', id: idOf(product.id), into: idOf(twin.id) });
      } else {
        report.xpo.push(`${String(product.sku)} pasa a leerse como XPO-INTERACTION.`);
        ops.push({ op: 'point-product', id: idOf(product.id), wineId: keep });
      }
    }
    const lots = await writer.read<{ id: string; code: string }>(sql`
      SELECT id::VARCHAR AS id, code FROM inventory.lot WHERE wine_id = CAST(${drop} AS UUID)
    `);
    for (const lot of lots) {
      report.xpo.push(`El lote ${lot.code} pasa a leerse como XPO-INTERACTION.`);
      ops.push({ op: 'point-lot', id: idOf(lot.id), wineId: keep });
    }
  }
  const o1 = wineByCode.get('LA-GRAN-OXIDACION-O1');
  const lem = await productBySku(writer, 'LEM2023');
  if (!o1 || !lem) {
    report.skipped.push('No está el vino LA-GRAN-OXIDACION-O1 o el producto LEM2023');
  } else {
    report.o1.push('LEM2023 se lee como LA-GRAN-OXIDACION-O1. OXIDACION y LEO22023 no se tocan.');
    ops.push({ op: 'point-product', id: lem.id, wineId: o1 });
    const lots = await writer.read<{ id: string; code: string }>(sql`
      SELECT id::VARCHAR AS id, code FROM inventory.lot WHERE code = 'LEM2023'
    `);
    if (lots.length === 0) report.skipped.push('No está el lote LEM2023');
    for (const lot of lots) {
      report.o1.push('El lote LEM2023 se lee como LA-GRAN-OXIDACION-O1.');
      ops.push({ op: 'point-lot', id: idOf(lot.id), wineId: o1 });
    }
    const duplicate = await productBySku(writer, 'LA-GRAN-OXIDACION-O1-2023-B050');
    if (!duplicate) {
      report.skipped.push('No está el producto LA-GRAN-OXIDACION-O1-2023-B050');
    } else {
      await hideIfNoStock(writer, report, ops, duplicate.id, 'LA-GRAN-OXIDACION-O1-2023-B050', lem.id);
    }
  }
  for (const sku of FORMATLESS_SKUS) {
    const product = await productBySku(writer, sku);
    if (!product) {
      report.skipped.push(`No está el producto ${sku}`);
      continue;
    }
    await hideIfNoStock(writer, report, ops, product.id, sku, null);
  }
  return { report, ops };
}

async function hideIfNoStock(
  writer: Writer,
  report: FichasReport,
  ops: FichasOp[],
  productId: string,
  sku: string,
  into: string | null,
): Promise<void> {
  const stock = await writer.read<{ units: string; ml: string }>(sql`
    SELECT COALESCE(SUM(qty_units), 0)::VARCHAR AS units, COALESCE(SUM(volume_ml), 0)::VARCHAR AS ml
    FROM inventory.stock_move WHERE product_id = CAST(${productId} AS UUID)
  `);
  const units = Number(stock[0]?.units ?? 0);
  const ml = Number(stock[0]?.ml ?? 0);
  if (units !== 0 || ml !== 0) {
    report.kept.push(`${sku} tiene stock propio (${units} bot., ${(ml / 1000).toFixed(2)} L). No se oculta.`);
    return;
  }
  report.hidden.push(`${sku} queda oculta. No tiene stock propio.`);
  ops.push({ op: 'hide-product', id: productId, into });
}

async function productBySku(writer: Writer, sku: string): Promise<{ id: string } | null> {
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM catalog.product WHERE sku = ${sku} LIMIT 1
  `);
  const row = rows[0];
  return row ? { id: idOf(row.id) } : null;
}

async function runFichasOp(tx: Tx, op: FichasOp): Promise<FichasChange[]> {
  if (op.op === 'hide-wine') return [await writeWineHide(tx, op.id, op.into)].filter((row): row is FichasChange => row !== null);
  if (op.op === 'point-product') return [await writeProductWine(tx, op.id, op.wineId)].filter((row): row is FichasChange => row !== null);
  if (op.op === 'point-lot') return [await writeLotWine(tx, op.id, op.wineId)].filter((row): row is FichasChange => row !== null);
  return [await writeProductHide(tx, op.id, op.into)].filter((row): row is FichasChange => row !== null);
}

async function wineBefore(tx: Tx, id: string): Promise<OverlayBefore | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT merged_into_id::VARCHAR AS merged_into_id, name, hidden
    FROM catalog.wine_overlay WHERE wine_id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    merged_into_id: row.merged_into_id == null ? null : idOf(row.merged_into_id),
    name: row.name == null ? null : String(row.name),
    wine_id: null,
    hidden: row.hidden === true,
    for_sale: null,
  };
}

async function productBefore(tx: Tx, id: string): Promise<OverlayBefore | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT merged_into_id::VARCHAR AS merged_into_id, wine_id::VARCHAR AS wine_id, hidden, for_sale
    FROM catalog.product_overlay WHERE product_id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    merged_into_id: row.merged_into_id == null ? null : idOf(row.merged_into_id),
    name: null,
    wine_id: row.wine_id == null ? null : idOf(row.wine_id),
    hidden: row.hidden === true,
    for_sale: row.for_sale == null ? null : row.for_sale === true,
  };
}

async function lotBefore(tx: Tx, id: string): Promise<OverlayBefore | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT wine_id::VARCHAR AS wine_id FROM inventory.lot_overlay WHERE lot_id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    merged_into_id: null,
    name: null,
    wine_id: row.wine_id == null ? null : idOf(row.wine_id),
    hidden: false,
    for_sale: null,
  };
}

async function writeWineHide(tx: Tx, id: string, into: string): Promise<FichasChange | null> {
  const before = await wineBefore(tx, id);
  if (before && before.hidden && before.merged_into_id === into) return null;
  if (!before) {
    tx.write(sql`
      INSERT INTO catalog.wine_overlay (wine_id, merged_into_id, hidden)
      VALUES (CAST(${id} AS UUID), CAST(${into} AS UUID), TRUE)
    `);
  } else {
    tx.write(sql`
      UPDATE catalog.wine_overlay
      SET merged_into_id = CAST(${into} AS UUID), hidden = TRUE
      WHERE wine_id = CAST(${id} AS UUID)
    `);
  }
  return { kind: 'wine', id, before };
}

async function writeProductWine(tx: Tx, id: string, wineId: string): Promise<FichasChange | null> {
  const before = await productBefore(tx, id);
  if (before && before.wine_id === wineId) return null;
  if (!before) {
    tx.write(sql`
      INSERT INTO catalog.product_overlay (product_id, wine_id, hidden)
      VALUES (CAST(${id} AS UUID), CAST(${wineId} AS UUID), FALSE)
    `);
  } else {
    tx.write(sql`
      UPDATE catalog.product_overlay SET wine_id = CAST(${wineId} AS UUID)
      WHERE product_id = CAST(${id} AS UUID)
    `);
  }
  return { kind: 'product', id, before };
}

async function writeLotWine(tx: Tx, id: string, wineId: string): Promise<FichasChange | null> {
  const before = await lotBefore(tx, id);
  if (before && before.wine_id === wineId) return null;
  if (!before) {
    tx.write(sql`
      INSERT INTO inventory.lot_overlay (lot_id, wine_id)
      VALUES (CAST(${id} AS UUID), CAST(${wineId} AS UUID))
    `);
  } else {
    tx.write(sql`
      UPDATE inventory.lot_overlay SET wine_id = CAST(${wineId} AS UUID)
      WHERE lot_id = CAST(${id} AS UUID)
    `);
  }
  return { kind: 'lot', id, before };
}

async function writeProductHide(tx: Tx, id: string, into: string | null): Promise<FichasChange | null> {
  const before = await productBefore(tx, id);
  const intoId = into;
  if (before && before.hidden && (intoId == null || before.merged_into_id === intoId)) return null;
  if (!before) {
    tx.write(sql`
      INSERT INTO catalog.product_overlay (product_id, merged_into_id, hidden, for_sale)
      VALUES (
        CAST(${id} AS UUID),
        CASE WHEN ${intoId} IS NULL THEN NULL ELSE CAST(${intoId} AS UUID) END,
        TRUE, FALSE
      )
    `);
  } else {
    tx.write(sql`
      UPDATE catalog.product_overlay
      SET hidden = TRUE, for_sale = FALSE,
          merged_into_id = CASE WHEN ${intoId} IS NULL THEN merged_into_id ELSE CAST(${intoId} AS UUID) END
      WHERE product_id = CAST(${id} AS UUID)
    `);
  }
  return { kind: 'product', id, before };
}

function changesOf(payload: unknown): FichasChange[] {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) as unknown : payload;
  if (!parsed || typeof parsed !== 'object' || !('changes' in parsed)) return [];
  const changes = (parsed as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const change = row as FichasChange;
    if (change.kind !== 'wine' && change.kind !== 'product' && change.kind !== 'lot') return [];
    if (typeof change.id !== 'string' || !isUuid(change.id)) return [];
    return [change];
  });
}

async function revertFichas(writer: Writer): Promise<FichasReport> {
  const rows = await writer.read<{ id: string; payload: unknown }>(sql`
    SELECT id::VARCHAR AS id, payload FROM ops.data_repair
    WHERE code = ${FICHAS} AND reverted_at IS NULL
    ORDER BY applied_at DESC LIMIT 1
  `);
  const report = emptyFichas('revert');
  const row = rows[0];
  if (!row) {
    report.skipped.push('No hay una reparación de fichas aplicada.');
    return report;
  }
  const changes = changesOf(row.payload);
  await writer.withWrite(ACTOR, async (tx) => {
    for (const change of [...changes].reverse()) await restoreChange(tx, change);
    tx.write(sql`UPDATE ops.data_repair SET reverted_at = now() WHERE id = CAST(${idOf(row.id)} AS UUID)`);
  });
  report.notes.push('Se deshacen solo las anotaciones de este paso. Las filas originales no se habían modificado.');
  return report;
}

async function restoreChange(tx: Tx, change: FichasChange): Promise<void> {
  const before = change.before;
  if (change.kind === 'wine') {
    if (!before) {
      tx.write(sql`DELETE FROM catalog.wine_overlay WHERE wine_id = CAST(${change.id} AS UUID)`);
      return;
    }
    tx.write(sql`
      UPDATE catalog.wine_overlay
      SET merged_into_id = CASE WHEN ${before.merged_into_id} IS NULL THEN NULL ELSE CAST(${before.merged_into_id} AS UUID) END,
          name = ${before.name}, hidden = ${before.hidden}
      WHERE wine_id = CAST(${change.id} AS UUID)
    `);
    return;
  }
  if (change.kind === 'lot') {
    if (!before) {
      tx.write(sql`DELETE FROM inventory.lot_overlay WHERE lot_id = CAST(${change.id} AS UUID)`);
      return;
    }
    tx.write(sql`
      UPDATE inventory.lot_overlay
      SET wine_id = CASE WHEN ${before.wine_id} IS NULL THEN NULL ELSE CAST(${before.wine_id} AS UUID) END
      WHERE lot_id = CAST(${change.id} AS UUID)
    `);
    return;
  }
  if (!before) {
    tx.write(sql`DELETE FROM catalog.product_overlay WHERE product_id = CAST(${change.id} AS UUID)`);
    return;
  }
  tx.write(sql`
    UPDATE catalog.product_overlay
    SET merged_into_id = CASE WHEN ${before.merged_into_id} IS NULL THEN NULL ELSE CAST(${before.merged_into_id} AS UUID) END,
        wine_id = CASE WHEN ${before.wine_id} IS NULL THEN NULL ELSE CAST(${before.wine_id} AS UUID) END,
        hidden = ${before.hidden},
        for_sale = ${before.for_sale}
    WHERE product_id = CAST(${change.id} AS UUID)
  `);
}

async function fichasKept(writer: Writer): Promise<{ wines: string[]; products: string[]; lots: string[] }> {
  const rows = await writer.read<{ payload: unknown }>(sql`
    SELECT payload FROM ops.data_repair WHERE code = ${FICHAS} AND reverted_at IS NULL
  `);
  const wines = new Set<string>();
  const products = new Set<string>();
  const lots = new Set<string>();
  for (const row of rows) {
    for (const change of changesOf(row.payload)) {
      if (change.kind === 'wine') wines.add(change.id.toLowerCase());
      if (change.kind === 'product') products.add(change.id.toLowerCase());
      if (change.kind === 'lot') lots.add(change.id.toLowerCase());
    }
  }
  return { wines: [...wines], products: [...products], lots: [...lots] };
}

function except(column: string, ids: string[]): string {
  if (ids.length === 0) return '';
  return ` WHERE ${column} NOT IN (${ids.map((id) => `CAST('${id}' AS UUID)`).join(', ')})`;
}

async function revert(writer: Writer): Promise<ReconcileReport> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id FROM ops.data_repair
    WHERE code = ${REPAIR} AND reverted_at IS NULL
    ORDER BY applied_at DESC LIMIT 1
  `);
  const report: ReconcileReport = {
    mode: 'revert',
    merges: [],
    detected: [],
    entredicho: [],
    locations: [],
    stock: [],
    notes: ['Se borran las anotaciones laterales. Las filas originales no se habían modificado.'],
    skipped: [],
  };
  const row = rows[0];
  if (!row) {
    report.skipped.push('No hay una reparación aplicada.');
    return report;
  }
  const kept = await fichasKept(writer);
  await writer.withWrite(ACTOR, async (tx) => {
    tx.write(`
      DELETE FROM inventory.stock_move
      WHERE created_by IN ('reconcile-catalog', 'reconcile-catalog-stock')
    `);
  });
  await writer.withWrite(ACTOR, async (tx) => {
    tx.write(`DELETE FROM catalog.wine_overlay${except('wine_id', kept.wines)}`);
    tx.write(`DELETE FROM catalog.product_overlay${except('product_id', kept.products)}`);
    tx.write(`DELETE FROM inventory.lot_overlay${except('lot_id', kept.lots)}`);
    tx.write(`DELETE FROM cellar.zone_overlay`);
    tx.write(`DELETE FROM cellar.vessel_overlay`);
    tx.write(sql`DELETE FROM catalog.wine WHERE code = 'ENTREDICHO-2324'`);
    tx.write(sql`UPDATE ops.data_repair SET reverted_at = now() WHERE id = CAST(${idOf(row.id)} AS UUID)`);
  });
  if (kept.wines.length + kept.products.length + kept.lots.length > 0) {
    report.notes.push('Se conservan las anotaciones de catalog-fichas-2026-11, que sigue aplicada.');
  }
  report.merges.push({ keep: '', drop: '', why: 'Quitadas las uniones, los nombres y las bajas anotados.', refs: 0 });
  return report;
}
