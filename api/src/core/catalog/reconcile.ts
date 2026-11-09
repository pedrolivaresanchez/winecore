import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { newId } from '../ids';

const ACTOR = { type: 'migration' as const, id: '019c0000-0000-7000-8000-0000000000ac', requestId: 'reconcile-catalog' };
const REPAIR = 'catalog-bodega-2026-11';

/** Pares que Pedro ya ha visto. La ficha corta, sin formato o de añada suelta, se apaga. */
const WINE_PAIRS: { keep: string; drop: string; why: string }[] = [
  { keep: 'ARCAL', drop: 'ARCAL-2023', why: 'ARCAL-2023 no tiene formato. Se queda ARCAL.' },
  { keep: 'XPO-INTERACTION', drop: 'XPO-2016', why: 'XPO-2016 es la misma ficha que XPO Interaction.' },
  { keep: 'LA-GRAN-OXIDACION-O1-2023-B050', drop: 'LEM2023', why: 'LEM2023 es el lote de O1, no otra ficha.' },
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
  await writer.withWrite(ACTOR, async (tx) => {
    const journal: unknown[] = [];
    for (const pair of report.merges) {
      journal.push(await mergeWine(tx, pair.keep, pair.drop));
    }
    journal.push(await splitEntredicho(tx, report));
    journal.push(await repairLocations(tx, report));
    journal.push(await topUpStock(tx, report));
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
    SELECT id::VARCHAR AS id, code, name, is_active
    FROM catalog.wine
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
    SELECT id::VARCHAR AS id, code, is_active FROM catalog.wine WHERE code IN (${keepCode}, ${dropCode})
  `);
  const keep = rows.find((row) => row.code === keepCode);
  const drop = rows.find((row) => row.code === dropCode);
  if (!keep || !drop) return { keep: keepCode, drop: dropCode, skipped: true };
  const keepId = idOf(keep.id);
  const dropId = idOf(drop.id);
  const products = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, sku, format_id::VARCHAR AS format_id, vintage::VARCHAR AS vintage
    FROM catalog.product WHERE wine_id = CAST(${dropId} AS UUID)
  `);
  const keptProducts = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, format_id::VARCHAR AS format_id, vintage::VARCHAR AS vintage
    FROM catalog.product WHERE wine_id = CAST(${keepId} AS UUID) AND is_active
  `);
  const retired: string[] = [];
  const moves: Move[] = [];
  for (const product of products) {
    const twin = keptProducts.find((row) => row.format_id && row.format_id === product.format_id && row.vintage === product.vintage);
    if (twin) {
      await retarget(tx, 'product_id', idOf(product.id), idOf(twin.id));
      tx.write(sql`
        UPDATE catalog.product
        SET is_active = FALSE, for_sale = FALSE, merged_into_id = CAST(${idOf(twin.id)} AS UUID)
        WHERE id = CAST(${idOf(product.id)} AS UUID)
      `);
      retired.push(String(product.sku));
    } else {
      tx.write(sql`
        UPDATE catalog.product SET wine_id = CAST(${keepId} AS UUID) WHERE id = CAST(${idOf(product.id)} AS UUID)
      `);
      moves.push({ rel: 'catalog.product', column: 'wine_id', ids: [idOf(product.id)], from: dropId, to: keepId });
    }
  }
  moves.push(...await retarget(tx, 'wine_id', dropId, keepId));
  tx.write(sql`
    UPDATE catalog.wine
    SET is_active = FALSE, merged_into_id = CAST(${keepId} AS UUID)
    WHERE id = CAST(${dropId} AS UUID)
  `);
  return { keep: keepCode, drop: dropCode, moves, retired };
}

type Move = { rel: string; column: string; ids: string[]; from: string; to: string };

async function retarget(tx: Tx, column: 'wine_id' | 'product_id', from: string, to: string): Promise<Move[]> {
  const moves: Move[] = [];
  const columns = await tx.read<{ rel: string }>(`
    SELECT table_schema || '.' || table_name AS rel
    FROM information_schema.columns
    WHERE column_name = '${column}'
      AND table_schema NOT IN ('information_schema')
  `);
  for (const row of columns) {
    const rel = String(row.rel);
    if (!/^[a-z_]+\.[a-z_]+$/.test(rel)) continue;
    if (rel === 'catalog.wine') continue;
    if (rel === 'catalog.product' && column === 'wine_id') continue;
    const hasId = await tx.read<{ n: unknown }>(`
      SELECT count(*) AS n FROM information_schema.columns
      WHERE table_schema || '.' || table_name = '${rel}' AND column_name = 'id'
    `);
    if (Number(hasId[0]?.n ?? 0) === 0) continue;
    const ids = await tx.read<{ id: string }>(`
      SELECT id::VARCHAR AS id FROM ${rel} WHERE ${column} = CAST('${from}' AS UUID)
    `);
    if (ids.length === 0) continue;
    tx.write(`UPDATE ${rel} SET ${column} = CAST('${to}' AS UUID) WHERE ${column} = CAST('${from}' AS UUID)`);
    moves.push({ rel, column, ids: ids.map((item) => idOf(item.id)), from, to });
  }
  return moves;
}

async function splitEntredicho(tx: Tx, report: ReconcileReport): Promise<unknown> {
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, code, name FROM catalog.wine
    WHERE is_active AND lower(name) LIKE '%entredicho%' AND lower(name) NOT LIKE '%bobastrell%'
  `);
  const early = rows.find((row) => fold(String(row.name)).includes('20202022') || fold(String(row.name)).includes('2022'));
  const late = rows.find((row) => fold(String(row.name)).includes('20232024'));
  const canonical = early ?? rows.find((row) => String(row.code) === 'ENTREDICHO') ?? rows[0];
  if (!canonical) return { skipped: true };
  const earlyId = idOf(canonical.id);
  if (!early) {
    tx.write(sql`
      UPDATE catalog.wine SET name = ${'enTreDicho 2020-2022'} WHERE id = CAST(${earlyId} AS UUID)
    `);
  }
  let lateId = late ? idOf(late.id) : '';
  if (!late) {
    lateId = newId();
    const color = await tx.read<{ color: string }>(sql`SELECT color FROM catalog.wine WHERE id = CAST(${earlyId} AS UUID)`);
    tx.write(sql`
      INSERT INTO catalog.wine (id, code, name, color, category, is_organic, is_active)
      VALUES (
        CAST(${lateId} AS UUID), 'ENTREDICHO-2324', 'enTreDicho 2023-2024',
        ${color[0]?.color ?? 'red'}, 'wine', TRUE, TRUE
      )
    `);
  }
  tx.write(sql`
    UPDATE inventory.lot SET wine_id = CAST(${lateId} AS UUID)
    WHERE wine_id = CAST(${earlyId} AS UUID)
      AND (code = '202324' OR code LIKE '%202324%')
  `);
  tx.write(sql`
    UPDATE catalog.product SET wine_id = CAST(${lateId} AS UUID)
    WHERE wine_id = CAST(${earlyId} AS UUID)
      AND (vintage IN (2023, 2024) OR lower(name) LIKE '%2023-2024%' OR lower(name) LIKE '%23-24%')
  `);
  report.entredicho.push(`Lote E202122 sigue en ${String(canonical.code)}. Lote 202324 pasa a ENTREDICHO-2324.`);
  return { earlyId, lateId };
}

const BARREL_CODES = ['BAR-01', 'BAR-02', 'BAR-03', 'BAR-04', 'BAR-05', 'BAR-06', 'BAR-07', 'BAR-08', 'BAR-10', 'BAR-11', 'BAR-12', 'BAR-13', 'BAR-15', 'BAR-17', 'BAR-18', 'BAR-19'];
const REVERSE_CODES = ['B10', 'B12', 'B13', 'B18', 'B19'];

function barrelSlot(index: number): { x: number; y: number; width: number; height: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 48 + col * 118, y: 96 + row * 112, width: 108, height: 64 };
}

async function repairLocations(tx: Tx, report: ReconcileReport): Promise<unknown> {
  tx.write(sql`
    UPDATE cellar.zone SET name = 'Barricas' WHERE code = 'BARR'
  `);
  tx.write(sql`
    UPDATE cellar.zone SET name = 'Damajuanas (exterior)' WHERE code = 'DAMA'
  `);
  tx.write(`
    UPDATE cellar.zone SET is_active = FALSE
    WHERE code IN ('SALA', 'EXT', 'ELAB', 'BOT')
  `);
  report.locations.push('BARR pasa a llamarse Barricas. DAMA pasa a llamarse Damajuanas (exterior).');
  report.locations.push('Zonas SALA, EXT, ELAB y BOT desactivadas, sin borrarlas.');
  report.notes.push(NOTE_B12);

  const vessels = await tx.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, code, status FROM cellar.vessel
  `);
  const byCode = new Map(vessels.map((row) => [String(row.code), row]));
  for (const code of REVERSE_CODES) {
    const vessel = byCode.get(code);
    if (!vessel) {
      report.skipped.push(`No está el recipiente ${code}`);
      continue;
    }
    const moves = await tx.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, volume_ml::VARCHAR AS volume_ml, qty_units::VARCHAR AS qty_units,
             location_id::VARCHAR AS location_id, owner_entity_id::VARCHAR AS owner_entity_id,
             lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id, product_state
      FROM inventory.stock_move
      WHERE vessel_id = CAST(${idOf(vessel.id)} AS UUID)
        AND move_type = 'opening'
        AND volume_ml > 0
        AND NOT EXISTS (
          SELECT 1 FROM inventory.stock_move rev WHERE rev.reverses_move_id = inventory.stock_move.id
        )
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
          CAST(${idOf(move.location_id)} AS UUID),
          CAST(${idOf(vessel.id)} AS UUID),
          CAST(${idOf(move.owner_entity_id)} AS UUID),
          CASE WHEN ${move.lot_id == null ? null : idOf(move.lot_id)} IS NULL THEN NULL ELSE CAST(${move.lot_id == null ? null : idOf(move.lot_id)} AS UUID) END,
          CASE WHEN ${move.product_id == null ? null : idOf(move.product_id)} IS NULL THEN NULL ELSE CAST(${move.product_id == null ? null : idOf(move.product_id)} AS UUID) END,
          ${String(move.product_state)}, ${units}, ${volume}, 0,
          'ops.data_repair', CAST(${newId()} AS UUID), CAST(${idOf(move.id)} AS UUID), 'reconcile-catalog'
        )
      `);
      report.locations.push(`Reversa de la apertura de ${code}: ${volume / 1000} L. No se envía a SILICIE.`);
    }
    tx.write(sql`UPDATE cellar.vessel SET status = 'retired' WHERE id = CAST(${idOf(vessel.id)} AS UUID)`);
  }
  const legacy = vessels.filter((row) => /^B\d+$/.test(String(row.code)) || /^DAMAJUANA-\d+$/.test(String(row.code)));
  for (const row of legacy) {
    tx.write(sql`UPDATE cellar.vessel SET status = 'retired' WHERE id = CAST(${idOf(row.id)} AS UUID) AND status <> 'retired'`);
  }
  if (legacy.length > 0) report.locations.push(`${legacy.length} recipientes B o DAMAJUANA-n quedan en baja, sin borrarlos.`);

  const zone = await tx.read<{ id: string }>(`SELECT id::VARCHAR AS id FROM cellar.zone WHERE code = 'BARR'`);
  const zoneId = zone[0] ? idOf(zone[0].id) : '';
  if (!zoneId) {
    report.skipped.push('No hay zona BARR para colocar las barricas');
    return { placements: 0 };
  }
  let placed = 0;
  BARREL_CODES.forEach((code, index) => {
    const vessel = byCode.get(code);
    if (!vessel) return;
    const slot = barrelSlot(index);
    tx.write(sql`
      INSERT INTO cellar.plan_position (id, zone_id, vessel_id, x, y, width, height, rotation)
      SELECT CAST(${newId()} AS UUID), CAST(${zoneId} AS UUID), CAST(${idOf(vessel.id)} AS UUID),
             ${slot.x}, ${slot.y}, ${slot.width}, ${slot.height}, 0
      WHERE NOT EXISTS (
        SELECT 1 FROM cellar.plan_position WHERE vessel_id = CAST(${idOf(vessel.id)} AS UUID)
      )
    `);
    placed += 1;
  });
  report.locations.push(`${placed} barricas BAR quedan apuntadas al plano de Barricas.`);
  await copyLegacyPositions(tx, byCode, report);
  return { placed };
}

async function copyLegacyPositions(tx: Tx, byCode: Map<string, Record<string, unknown>>, report: ReconcileReport): Promise<void> {
  const positions = await tx.read<Record<string, unknown>>(`
    SELECT p.id::VARCHAR AS id, v.code AS code, p.zone_id::VARCHAR AS zone_id,
           p.x, p.y, p.width, p.height, p.rotation
    FROM cellar.plan_position p
    JOIN cellar.vessel v ON v.id = p.vessel_id
    WHERE v.code ~ '^B[0-9]+$' OR v.code ~ '^DAMAJUANA-[0-9]+$'
  `);
  for (const position of positions) {
    const code = String(position.code);
    const target = code.startsWith('DAMAJUANA-')
      ? `DAM-${code.slice('DAMAJUANA-'.length).padStart(2, '0')}`
      : `BAR-${code.slice(1).padStart(2, '0')}`;
    const vessel = byCode.get(target);
    if (!vessel) continue;
    tx.write(sql`
      UPDATE cellar.plan_position
      SET zone_id = CAST(${idOf(position.zone_id)} AS UUID),
          x = ${Number(position.x)}, y = ${Number(position.y)},
          width = ${Number(position.width)}, height = ${Number(position.height)},
          rotation = ${Number(position.rotation)}
      WHERE vessel_id = CAST(${idOf(vessel.id)} AS UUID)
    `);
  }
  if (positions.length > 0) report.locations.push('Las posiciones de B y de DAMAJUANA-n se copian a BAR-xx y DAM-xx.');
}

const STOCK_TOP_UP = [
  { wine: 'arcal', vintage: 2023, ml: 750, where: 'TFRP', bottles: 1254, state: 'packaged_labeled' },
  { wine: 'arcal', vintage: 2023, ml: 750, where: 'BOD', bottles: 912, state: 'packaged_labeled' },
  { wine: 'interaction', vintage: 2016, ml: 750, lot: 'L2021/E1001', where: 'BOD', bottles: 27, state: 'packaged_labeled' },
  { wine: 'oxidacion', vintage: 2023, ml: 500, lot: 'LEM2023', where: 'BOD', bottles: 70, state: 'packaged_labeled' },
];

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
  const products = await tx.read<Record<string, unknown>>(`
    SELECT p.id::VARCHAR AS id, p.vintage::VARCHAR AS vintage, w.name AS wine_name, f.nominal_volume_ml::VARCHAR AS nominal
    FROM catalog.product p
    LEFT JOIN catalog.wine w ON w.id = p.wine_id
    LEFT JOIN catalog.format f ON f.id = p.format_id
    WHERE p.is_active AND p.kind = 'wine'
  `);
  let loaded = 0;
  for (const line of STOCK_TOP_UP) {
    const product = products.find((row) => {
      const name = fold(String(row.wine_name ?? ''));
      const vintage = row.vintage == null || row.vintage === '' ? null : Number(row.vintage);
      const nominal = row.nominal == null || row.nominal === '' ? null : Number(row.nominal);
      return name.includes(line.wine) && vintage === line.vintage && (nominal == null || nominal === line.ml);
    });
    const place = locations.find((row) => row.code === line.where);
    const owner = line.where === 'TFRP' ? cvpo : po;
    if (!product || !place || !owner) {
      report.stock.push(`Sin producto o ubicación para ${line.wine} ${line.vintage} en ${line.where}.`);
      continue;
    }
    const lot = line.lot
      ? await tx.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM inventory.lot WHERE code = ${line.lot} LIMIT 1`)
      : [];
    const volume = line.bottles * line.ml;
    tx.write(sql`
      INSERT INTO inventory.stock_move (
        id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id,
        product_state, qty_units, volume_ml, mass_g, source_table, source_id, created_by
      ) VALUES (
        CAST(${newId()} AS UUID), now(), 'opening',
        CAST(${idOf(place.id)} AS UUID), CAST(${idOf(owner.id)} AS UUID),
        CASE WHEN ${lot[0] ? idOf(lot[0].id) : null} IS NULL THEN NULL ELSE CAST(${lot[0] ? idOf(lot[0].id) : null} AS UUID) END,
        CAST(${idOf(product.id)} AS UUID),
        ${line.state}, ${line.bottles}, ${volume}, 0,
        'ops.data_repair', CAST(${newId()} AS UUID), 'reconcile-catalog-stock'
      )
    `);
    loaded += 1;
    report.stock.push(`${line.wine} ${line.vintage}: ${line.bottles} bot. en ${line.where}.`);
  }
  report.stock.push('Objetivo de la hoja: bodega 14.094 bot. / 10.652,00 L; TFRP 8.394 bot. / 6.295,50 L.');
  return { loaded };
}

async function revert(writer: Writer): Promise<ReconcileReport> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, payload FROM ops.data_repair
    WHERE code = ${REPAIR} AND reverted_at IS NULL
    ORDER BY applied_at DESC LIMIT 1
  `);
  const report: ReconcileReport = {
    mode: 'revert',
    merges: [],
    detected: [],
    entredicho: [],
    locations: ['La reversa de stock no se borra: queda el movimiento de reversa. Reactivar a mano si hiciera falta.'],
    stock: [],
    notes: [],
    skipped: [],
  };
  const row = rows[0];
  if (!row) {
    report.skipped.push('No hay una reparación aplicada.');
    return report;
  }
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) as { steps?: { moves?: Move[] }[] } : row.payload as { steps?: { moves?: Move[] }[] };
  await writer.withWrite(ACTOR, async (tx) => {
    for (const step of [...(payload.steps ?? [])].reverse()) {
      for (const move of [...(step.moves ?? [])].reverse()) {
        if (!/^[a-z_]+\.[a-z_]+$/.test(move.rel) || (move.column !== 'wine_id' && move.column !== 'product_id')) continue;
        for (const id of move.ids) {
          tx.write(`UPDATE ${move.rel} SET ${move.column} = CAST('${move.from}' AS UUID) WHERE id = CAST('${id}' AS UUID)`);
        }
      }
    }
    tx.write(sql`
      UPDATE catalog.wine SET is_active = TRUE, merged_into_id = NULL
      WHERE merged_into_id IS NOT NULL
    `);
    tx.write(sql`
      UPDATE catalog.product SET is_active = TRUE, for_sale = TRUE, merged_into_id = NULL
      WHERE merged_into_id IS NOT NULL
    `);
    tx.write(sql`
      UPDATE cellar.zone SET is_active = TRUE WHERE code IN ('SALA', 'EXT', 'ELAB', 'BOT')
    `);
    tx.write(sql`UPDATE ops.data_repair SET reverted_at = now() WHERE id = CAST(${idOf(row.id)} AS UUID)`);
  });
  report.merges.push({ keep: '', drop: '', why: 'Fichas reactivadas. Las referencias no vuelven solas: el diario guarda el detalle.', refs: 0 });
  return report;
}
