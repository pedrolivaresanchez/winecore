import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { newId } from '../ids';
import { CATALOG_WINES } from '../catalog/catalog-snapshot';
import { matchBottledLine, type LotRef, type ProductRef, type WineRef } from './bottled-match';
import {
  BARRELS,
  DEMIJOHNS,
  LEES,
  OPENING_AT,
  PHOTO_DATE,
  TFRP_STORAGE,
  bottledLines,
  fold,
  sumLines,
  type BottledLine,
} from './bottled-snapshot';

const ACTOR = { type: 'migration' as const, id: '019c0000-0000-7000-8000-0000000000aa', requestId: 'load-bottled-stock' };

type Report = {
  already_loaded: boolean;
  matched: number;
  unmatched: { wine: string; lot: string | null; where: string; note: string | null }[];
  totals: Record<string, { bottles: number; litres: string }>;
  barrels: { loaded: number; full_litres: string; gap: string };
  pallets: { counted: number; billed: number; price_eur: string };
  assumptions: string[];
};

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

function litres(ml: number): string {
  const negative = ml < 0;
  const [whole, frac] = (Math.abs(ml) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '').split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const text = frac ? `${grouped},${frac}` : grouped;
  return `${negative ? '-' : ''}${text}`;
}

/** Sustituye el envasado del libro (una fila por hueco y estado) por litros por producto y lote. */
export async function rebuildPackagedBook(writer: Writer): Promise<{ lines: number; unmatched: Report['unmatched'] }> {
  const rows = await writer.read<{
    location: string; owner: string; lot: string; product: string; units: string; volume: string;
    label: string; lot_code: string | null; slot: string;
  }>(`
    SELECT p.location_id::VARCHAR AS location, p.owner_entity_id::VARCHAR AS owner,
           p.lot_id::VARCHAR AS lot, p.product_id::VARCHAR AS product,
           coalesce(sum(m.qty_units), 0)::VARCHAR AS units,
           coalesce(sum(m.volume_ml), 0)::VARCHAR AS volume,
           p.wine_label AS label, l.code AS lot_code, p.slot_code AS slot
    FROM cellar.bottled_placement p
    LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
    LEFT JOIN inventory.lot l ON l.id = p.lot_id
    WHERE p.slot_kind IN ('caja', 'nicho', 'jaulon', 'palet')
    GROUP BY p.id, p.location_id, p.owner_entity_id, p.lot_id, p.product_id, p.wine_label, l.code, p.slot_code
  `);
  const unmatched: Report['unmatched'] = [];
  const grouped = new Map<string, { location: string; owner: string; lot: string; product: string; units: number; volume: number }>();
  for (const row of rows) {
    const units = Number(row.units);
    const volume = Number(row.volume);
    if (units <= 0 && volume <= 0) continue;
    if (!row.lot || !row.product) {
      unmatched.push({ wine: row.label, lot: row.lot_code, where: row.slot, note: 'Sin producto o sin lote. No entra en el libro.' });
      continue;
    }
    const key = `${row.location}|${row.owner}|${row.lot}|${row.product}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      location: row.location,
      owner: row.owner,
      lot: row.lot,
      product: row.product,
      units: (prev?.units ?? 0) + units,
      volume: (prev?.volume ?? 0) + volume,
    });
  }
  await writer.withWrite(ACTOR, async (tx) => {
    tx.write(`
      DELETE FROM inventory.stock_move
      WHERE move_type = 'opening'
        AND vessel_id IS NULL
        AND product_state IN ('packaged_labeled', 'packaged_unlabeled')
        AND created_by = 'load-bottled-stock'
    `);
    for (const row of grouped.values()) {
      tx.write(openingMove(row.location, row.owner, null, row.lot, row.product, 'packaged_labeled', row.units, row.volume, newId()));
    }
  });
  return { lines: grouped.size, unmatched };
}

/** Vuelve a enlazar las líneas ya cargadas con el catálogo actual. */
export async function rematchBottledPlacements(writer: Writer): Promise<{ updated: number; unmatched: Report['unmatched'] }> {
  const wines = await writer.read<Record<string, unknown>>(`SELECT id::VARCHAR AS id, code, name, color, is_organic FROM catalog.wine WHERE is_active`);
  const lots = await writer.read<Record<string, unknown>>(`SELECT id::VARCHAR AS id, code, wine_id::VARCHAR AS wine_id FROM inventory.lot WHERE status <> 'closed'`);
  const products = await writer.read<Record<string, unknown>>(`
    SELECT p.id::VARCHAR AS id, p.sku, p.name, p.wine_id::VARCHAR AS wine_id, p.vintage::VARCHAR AS vintage, p.kind,
           f.nominal_volume_ml::VARCHAR AS nominal
    FROM catalog.product p
    LEFT JOIN catalog.format f ON f.id = p.format_id
    WHERE p.is_active
  `);
  const wineRefs: WineRef[] = wines.map((row) => ({
    id: idOf(row.id), code: String(row.code), name: String(row.name), color: String(row.color), organic: row.is_organic === true,
  }));
  const lotRefs: LotRef[] = lots.map((row) => ({ id: idOf(row.id), code: String(row.code), wineId: row.wine_id == null ? null : idOf(row.wine_id) }));
  const lotBySku = new Map(CATALOG_WINES.flatMap((row) => row.lot ? [[row.sku, row.lot] as const] : []));
  const productRefs: ProductRef[] = products.map((row) => ({
    id: idOf(row.id),
    name: String(row.name),
    wineId: row.wine_id == null ? null : idOf(row.wine_id),
    vintage: row.vintage == null || row.vintage === '' ? null : Number(row.vintage),
    nominalMl: row.nominal == null || row.nominal === '' ? null : Number(row.nominal),
    kind: String(row.kind),
    lotCode: lotBySku.get(String(row.sku)) ?? null,
  }));
  const placements = await writer.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, location_id::VARCHAR AS location_id, owner_entity_id::VARCHAR AS owner_id,
           wine_label, lot_code_raw, bottle_ml::VARCHAR AS bottle_ml,
           opened_bottles::VARCHAR AS bottles, opened_volume_ml::VARCHAR AS volume,
           slot_kind, slot_code, niche_number::VARCHAR AS niche_number, color, not_for_sale, note
    FROM cellar.bottled_placement
    WHERE source_sheet <> 'verify.local' AND slot_code <> 'JAU-XPO'
  `);
  const unmatched: Report['unmatched'] = [];
  let updated = 0;
  await writer.withWrite(ACTOR, async (tx) => {
    for (const row of placements) {
      const bottle = row.bottle_ml == null || row.bottle_ml === '' ? null : Number(row.bottle_ml);
      const line: BottledLine = {
        slot_kind: String(row.slot_kind) as BottledLine['slot_kind'],
        slot_code: String(row.slot_code),
        niche_number: null,
        pallet_count: null,
        line_no: 1,
        lot_code: row.lot_code_raw == null ? null : String(row.lot_code_raw),
        wine_label: String(row.wine_label),
        bottles: Number(row.bottles),
        volume_ml: Number(row.volume),
        bottle_ml: bottle,
        abv: null,
        organic: null,
        color: row.color == null ? null : String(row.color) as BottledLine['color'],
        state: 'packaged_labeled',
        note: row.note == null ? null : String(row.note),
        source_sheet: 'rematch',
        source_row: 1,
        not_for_sale: row.not_for_sale === true,
      };
      const splitAplatinao = line.wine_label === 'APLATINAO +APMG 3' && line.bottle_ml == null && line.bottles === 54;
      if (splitAplatinao) {
        line.bottles = 48;
        line.volume_ml = 36_000;
        line.bottle_ml = 750;
        line.note = 'Reparto para cuadrar 54 botellas y 45 L: 48 de 0,75 L';
        const magnumId = newId();
        const magnum = matchBottledLine({
          ...line,
          wine_label: 'Aplatinao magnum',
          bottles: 6,
          volume_ml: 9_000,
          bottle_ml: 1500,
          lot_code: 'LAT2025',
        }, wineRefs, lotRefs, productRefs);
        tx.write(sql`
          INSERT INTO cellar.bottled_move (
            id, occurred_at, placement_id, qty_units, volume_ml, move_type, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${OPENING_AT} AS TIMESTAMPTZ), CAST(${String(row.id)} AS UUID),
            -6, -9000, 'cellar_out', 'cellar.bottled_placement', CAST(${String(row.id)} AS UUID), 'load-bottled-stock'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.bottled_placement (
            id, location_id, slot_kind, slot_code, niche_number, line_no, wine_label, lot_code_raw,
            wine_id, product_id, lot_id, owner_entity_id, opened_bottles, bottle_ml, opened_volume_ml,
            product_state, not_for_sale, match_status, match_note, note, source_sheet, source_row, photo_date
          ) VALUES (
            CAST(${magnumId} AS UUID), CAST(${String(row.location_id)} AS UUID), 'nicho', 'NIC-08',
            ${row.niche_number == null ? 8 : Number(row.niche_number)}, 2, 'Aplatinao magnum', 'LAT2025',
            CASE WHEN ${magnum.wineId} IS NULL THEN NULL ELSE CAST(${magnum.wineId} AS UUID) END,
            CASE WHEN ${magnum.productId} IS NULL THEN NULL ELSE CAST(${magnum.productId} AS UUID) END,
            CASE WHEN ${magnum.lotId} IS NULL THEN NULL ELSE CAST(${magnum.lotId} AS UUID) END,
            CAST(${String(row.owner_id)} AS UUID), 6, 1500, 9000, 'packaged_labeled', FALSE,
            ${magnum.status}, ${magnum.note}, 'Reparto para cuadrar 54 botellas y 45 L: 6 magnum de 1,50 L',
            'ENVASADO NICHOS NUMERADOS', 1011, DATE '2026-11-09'
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.bottled_move (
            id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id, source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${OPENING_AT} AS TIMESTAMPTZ), CAST(${magnumId} AS UUID),
            6, 9000, 'opening',
            CASE WHEN ${magnum.lotId} IS NULL THEN NULL ELSE CAST(${magnum.lotId} AS UUID) END,
            'cellar.bottled_placement', CAST(${magnumId} AS UUID), 'load-bottled-stock'
          )
        `);
      }
      const linked = matchBottledLine(line, wineRefs, lotRefs, productRefs);
      if (linked.status !== 'matched' && line.bottles > 0) {
        unmatched.push({ wine: line.wine_label, lot: line.lot_code, where: line.slot_code, note: linked.note });
      } else {
        updated += 1;
      }
      tx.write(sql`
        UPDATE cellar.bottled_placement SET
          wine_id = CASE WHEN ${linked.wineId} IS NULL THEN NULL ELSE CAST(${linked.wineId} AS UUID) END,
          product_id = CASE WHEN ${linked.productId} IS NULL THEN NULL ELSE CAST(${linked.productId} AS UUID) END,
          lot_id = CASE WHEN ${linked.lotId} IS NULL THEN NULL ELSE CAST(${linked.lotId} AS UUID) END,
          bottle_ml = ${line.bottle_ml},
          opened_bottles = ${line.bottles},
          opened_volume_ml = ${line.volume_ml},
          not_for_sale = ${linked.notForSale},
          match_status = ${linked.status},
          match_note = ${linked.note},
          note = ${line.note},
          wine_label = ${fold(line.wine_label) === 'bobal xpo' ? 'Las Virginias 2025' : line.wine_label}
        WHERE id = CAST(${String(row.id)} AS UUID)
      `);
    }
  });
  return { updated, unmatched };
}

export async function loadBottledStock(writer: Writer): Promise<Report> {
  const existing = await writer.read<{ n: string }>(`SELECT count(*)::VARCHAR AS n FROM cellar.bottled_placement`);
  if (Number(existing[0]?.n ?? 0) > 0) {
    return report(true, bottledLines(), []);
  }
  const entities = await writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM core.legal_entity`);
  const po = entities.find((row) => row.code === 'PO');
  const cvpo = entities.find((row) => row.code === 'CVPO');
  if (!po || !cvpo) throw new Error('Faltan las entidades PO y CVPO. Ejecuta antes la semilla.');
  const poId = idOf(po.id);
  const cvpoId = idOf(cvpo.id);
  const locations = await writer.read<{ id: string; code: string }>(`SELECT id::VARCHAR AS id, code FROM inventory.location`);
  const byCode = new Map(locations.map((row) => [row.code, idOf(row.id)]));
  const wines = await writer.read<Record<string, unknown>>(`SELECT id::VARCHAR AS id, code, name, color, is_organic FROM catalog.wine WHERE is_active`);
  const lots = await writer.read<Record<string, unknown>>(`SELECT id::VARCHAR AS id, code, wine_id::VARCHAR AS wine_id FROM inventory.lot WHERE status <> 'closed'`);
  const products = await writer.read<Record<string, unknown>>(`
    SELECT p.id::VARCHAR AS id, p.sku, p.name, p.wine_id::VARCHAR AS wine_id, p.vintage::VARCHAR AS vintage, p.kind,
           f.nominal_volume_ml::VARCHAR AS nominal
    FROM catalog.product p
    LEFT JOIN catalog.format f ON f.id = p.format_id
    WHERE p.is_active
  `);
  const wineRefs: WineRef[] = wines.map((row) => ({
    id: idOf(row.id), code: String(row.code), name: String(row.name), color: String(row.color), organic: row.is_organic === true,
  }));
  const lotRefs: LotRef[] = lots.map((row) => ({ id: idOf(row.id), code: String(row.code), wineId: row.wine_id == null ? null : idOf(row.wine_id) }));
  const lotBySku = new Map(CATALOG_WINES.flatMap((row) => row.lot ? [[row.sku, row.lot] as const] : []));
  const productRefs: ProductRef[] = products.map((row) => ({
    id: idOf(row.id),
    name: String(row.name),
    wineId: row.wine_id == null ? null : idOf(row.wine_id),
    vintage: row.vintage == null || row.vintage === '' ? null : Number(row.vintage),
    nominalMl: row.nominal == null || row.nominal === '' ? null : Number(row.nominal),
    kind: String(row.kind),
    lotCode: lotBySku.get(String(row.sku)) ?? null,
  }));
  const contact = await writer.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM party.contact WHERE tax_id = ${TFRP_STORAGE.taxId} AND archived_at IS NULL LIMIT 1`);
  const operatorId = contact[0] ? idOf(contact[0].id) : newId();
  const bodId = byCode.get('BOD') ?? newId();
  const tfrpId = byCode.get('TFRP') ?? newId();
  const zone = (code: string) => newId();
  const zones = {
    ELAB: zone('ELAB'), BARR: zone('BARR'), NICH: zone('NICH'), CAJA: zone('CAJA'), JAUL: zone('JAUL'), DAMA: zone('DAMA'), PAL: zone('PAL'),
  };
  const lines = bottledLines();
  const unmatched: Report['unmatched'] = [];
  let matched = 0;
  const statements: string[] = [];
  const write = (statement: string) => statements.push(statement);

  if (!contact[0]) {
    write(sql`
      INSERT INTO party.contact (
        id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code,
        is_supplier, is_carrier, is_logistics_operator, notes, created_by
      ) VALUES (
        CAST(${operatorId} AS UUID), 'company', ${TFRP_STORAGE.operator}, ${TFRP_STORAGE.taxId}, 'nif', 'ES', 'ES',
        TRUE, TRUE, TRUE, 'Operador logístico del almacén TFRP', 'load-bottled-stock'
      )
    `);
  }
  if (!byCode.has('BOD')) {
    write(sql`
      INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id, is_virtual)
      VALUES (CAST(${bodId} AS UUID), 'BOD', 'Bodega Pedro Olivares', 'cellar', CAST(${poId} AS UUID), FALSE)
    `);
  }
  if (!byCode.has('TFRP')) {
    write(sql`
      INSERT INTO inventory.location (
        id, code, name, kind, operator_contact_id, controlling_entity_id, is_virtual
      ) VALUES (
        CAST(${tfrpId} AS UUID), 'TFRP', 'Almacén TFRP', 'third_party_warehouse',
        CAST(${operatorId} AS UUID), CAST(${cvpoId} AS UUID), FALSE
      )
    `);
  }
  const zoneRows: [string, string, string, string, string][] = [
    [zones.ELAB, bodId, 'ELAB', 'Nave de depósitos', 'elaboration'],
    [zones.BARR, bodId, 'BARR', 'Zona barricas', 'barrel_room'],
    [zones.NICH, bodId, 'NICH', 'Nichos', 'bottle_store'],
    [zones.CAJA, bodId, 'CAJA', 'Envasado en cajas', 'bottle_store'],
    [zones.JAUL, bodId, 'JAUL', 'Jaulones', 'bottle_store'],
    [zones.DAMA, bodId, 'DAMA', 'Damajuanas', 'outdoor'],
    [zones.PAL, tfrpId, 'PALETS', 'Palets TFRP', 'bottle_store'],
  ];
  for (const [id, location, code, name, kind] of zoneRows) {
    write(sql`
      INSERT INTO cellar.zone (id, location_id, code, name, kind)
      SELECT CAST(${id} AS UUID), CAST(${location} AS UUID), ${code}, ${name}, ${kind}
      WHERE NOT EXISTS (SELECT 1 FROM cellar.zone WHERE code = ${code})
    `);
  }

  const vessels = await writer.read<{ id: string; code: string; volume: string }>(`
    SELECT v.id::VARCHAR AS id, v.code, coalesce(sum(m.volume_ml), 0)::VARCHAR AS volume
    FROM cellar.vessel v
    LEFT JOIN inventory.stock_move m ON m.vessel_id = v.id
    GROUP BY v.id, v.code
  `);
  const vesselByCode = new Map(vessels.map((row) => [row.code, { id: idOf(row.id), volume: Number(row.volume) }]));
  for (const barrel of BARRELS) {
    const code = `BAR-${String(barrel.number).padStart(2, '0')}`;
    const found = vesselByCode.get(code);
    const id = found?.id ?? newId();
    if (!found) {
      write(sql`
        INSERT INTO cellar.vessel (
          id, code, name, kind, capacity_ml, has_cooling_jacket, material, location_id, zone, status, notes
        ) VALUES (
          CAST(${id} AS UUID), ${code}, ${`Barrica ${barrel.number}`}, 'barrel', ${barrel.capacity_ml},
          FALSE, 'oak', CAST(${bodId} AS UUID), 'BARR', 'in_service', ${barrel.wine}
        )
      `);
    }
    if (barrel.fill_ml > 0 && (found?.volume ?? 0) === 0) {
      const lot = matchLotLoose(barrel.wine, lotRefs);
      const product = matchProductLoose(barrel.wine, productRefs, lotRefs, lot);
      if (!lot || !product) {
        unmatched.push({
          wine: barrel.wine ?? `Barrica ${barrel.number}`,
          lot: lotRefs.find((row) => row.id === lot)?.code ?? null,
          where: code,
          note: 'Granel sin producto o sin lote en el catálogo. El libro no lo agrupa.',
        });
      }
      write(openingMove(bodId, poId, id, lot, product, 'wine', 0, barrel.fill_ml, id));
    }
  }
  const demijohns = vessels.filter((row) => row.code.startsWith('DAM-')).length;
  if (demijohns === 0) {
    for (let index = 1; index <= DEMIJOHNS.units; index += 1) {
      const id = newId();
      const code = `DAM-${String(index).padStart(2, '0')}`;
      write(sql`
        INSERT INTO cellar.vessel (
          id, code, name, kind, capacity_ml, has_cooling_jacket, material, location_id, zone, status
        ) VALUES (
          CAST(${id} AS UUID), ${code}, ${`Damajuana ${index}`}, 'demijohn', ${DEMIJOHNS.capacity_ml},
          FALSE, 'glass', CAST(${bodId} AS UUID), 'DAMA', 'in_service'
        )
      `);
      write(sql`
        INSERT INTO cellar.demijohn (vessel_id, outdoor_aging) VALUES (CAST(${id} AS UUID), TRUE)
      `);
      write(openingMove(bodId, poId, id, null, null, 'wine', 0, DEMIJOHNS.fill_ml, id));
    }
  }
  if (!vesselByCode.has(LEES.code)) {
    const id = newId();
    write(sql`
      INSERT INTO cellar.vessel (
        id, code, name, kind, capacity_ml, has_cooling_jacket, material, location_id, zone, status, notes
      ) VALUES (
        CAST(${id} AS UUID), ${LEES.code}, ${LEES.name}, 'other', ${LEES.capacity_ml},
        FALSE, 'plastic', CAST(${bodId} AS UUID), 'ELAB', 'in_service', 'Lías, foto DEPÓSITOS'
      )
    `);
    write(openingMove(bodId, poId, id, null, null, 'wine', 0, LEES.fill_ml, id));
  }

  const holders = await writer.read<{ code: string; id: string }>(`SELECT id::VARCHAR AS id, code FROM cellar.holder`);
  const holderByCode = new Map(holders.map((row) => [row.code, idOf(row.id)]));
  const nicheNumbers = [...new Set(lines.filter((line) => line.slot_kind === 'nicho' && line.niche_number).map((line) => line.niche_number as number))];
  for (const number of nicheNumbers) {
    const code = `NIC-${String(number).padStart(2, '0')}`;
    if (holderByCode.has(code)) continue;
    const id = newId();
    holderByCode.set(code, id);
    const note = lines.filter((line) => line.slot_code === code).map((line) => line.note).filter(Boolean).join(' · ') || null;
    write(sql`
      INSERT INTO cellar.holder (id, location_id, zone_id, code, kind, name, notes)
      SELECT CAST(${id} AS UUID), CAST(${bodId} AS UUID), z.id, ${code}, 'nicho', ${`Nicho ${number}`}, ${note}
      FROM cellar.zone z WHERE z.code = 'NICH'
    `);
  }
  for (const line of lines.filter((item) => item.slot_kind === 'jaulon' && item.bottles > 0)) {
    if (holderByCode.has(line.slot_code) || !line.bottle_ml) continue;
    const id = newId();
    holderByCode.set(line.slot_code, id);
    write(sql`
      INSERT INTO cellar.holder (
        id, location_id, zone_id, code, kind, name, cage_number, capacity_units, nominal_volume_ml, notes
      )
      SELECT CAST(${id} AS UUID), CAST(${bodId} AS UUID), z.id, ${line.slot_code}, 'jaulon', ${line.wine_label},
             ${line.line_no}, ${line.bottles}, ${line.bottle_ml}, 'Jaulón sin numerar en la hoja; número de línea'
      FROM cellar.zone z WHERE z.code = 'JAUL'
    `);
  }

  const hide = new Set<string>();
  const bottledBook = new Map<string, { location: string; owner: string; lot: string; product: string; units: number; volume: number }>();
  for (const line of lines) {
    const where = line.slot_kind === 'palet' ? tfrpId : bodId;
    const owner = line.slot_kind === 'palet' ? cvpoId : poId;
    const linked = matchBottledLine(line, wineRefs, lotRefs, productRefs);
    if (linked.status === 'matched') matched += 1;
    else if (line.bottles > 0) unmatched.push({ wine: line.wine_label, lot: line.lot_code, where: line.slot_code, note: linked.note });
    const id = newId();
    const holder = holderByCode.get(line.slot_code) ?? null;
    const zoneCode = line.slot_kind === 'nicho' ? 'NICH' : line.slot_kind === 'jaulon' ? 'JAUL' : line.slot_kind === 'caja' ? 'CAJA' : 'PALETS';
    write(sql`
      INSERT INTO cellar.bottled_placement (
        id, location_id, zone_id, holder_id, slot_kind, slot_code, niche_number, pallet_count, line_no,
        wine_label, lot_code_raw, wine_id, product_id, lot_id, owner_entity_id, opened_bottles, bottle_ml,
        opened_volume_ml, abv_pct, is_organic, color, product_state, not_for_sale, note, match_status,
        match_note, source_sheet, source_row, photo_date
      )
      SELECT CAST(${id} AS UUID), CAST(${where} AS UUID), z.id,
             CASE WHEN ${holder} IS NULL THEN NULL ELSE CAST(${holder} AS UUID) END,
             ${line.slot_kind}, ${line.slot_code}, ${line.niche_number}, ${line.pallet_count}, ${line.line_no},
             ${fold(line.wine_label) === 'bobal xpo' ? 'Las Virginias 2025' : line.wine_label}, ${line.lot_code},
             CASE WHEN ${linked.wineId} IS NULL THEN NULL ELSE CAST(${linked.wineId} AS UUID) END,
             CASE WHEN ${linked.productId} IS NULL THEN NULL ELSE CAST(${linked.productId} AS UUID) END,
             CASE WHEN ${linked.lotId} IS NULL THEN NULL ELSE CAST(${linked.lotId} AS UUID) END,
             CAST(${owner} AS UUID), ${line.bottles}, ${line.bottle_ml}, ${line.volume_ml},
             CASE WHEN ${line.abv} IS NULL THEN NULL ELSE CAST(${line.abv} AS DECIMAL(5,2)) END,
             ${line.organic}, ${line.color}, ${line.state === 'empty' ? 'empty' : line.state}, ${linked.notForSale},
             ${line.note}, ${linked.status}, ${linked.note}, ${line.source_sheet}, ${line.source_row},
             CAST(${PHOTO_DATE} AS DATE)
      FROM cellar.zone z WHERE z.code = ${zoneCode}
    `);
    if (line.bottles > 0) {
      write(sql`
        INSERT INTO cellar.bottled_move (
          id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id, source_table, source_id, created_by
        ) VALUES (
          CAST(${newId()} AS UUID), CAST(${OPENING_AT} AS TIMESTAMPTZ), CAST(${id} AS UUID),
          ${line.bottles}, ${line.volume_ml}, 'opening',
          CASE WHEN ${linked.lotId} IS NULL THEN NULL ELSE CAST(${linked.lotId} AS UUID) END,
          'cellar.bottled_placement', CAST(${id} AS UUID), 'load-bottled-stock'
        )
      `);
    }
    if (line.bottles > 0 && linked.lotId && linked.productId) {
      const key = `${where}|${owner}|${linked.lotId}|${linked.productId}`;
      const prev = bottledBook.get(key);
      bottledBook.set(key, {
        location: where,
        owner,
        lot: linked.lotId,
        product: linked.productId,
        units: (prev?.units ?? 0) + line.bottles,
        volume: (prev?.volume ?? 0) + line.volume_ml,
      });
    }
    if (linked.notForSale && linked.productId) hide.add(linked.productId);
  }
  for (const row of bottledBook.values()) {
    write(openingMove(row.location, row.owner, null, row.lot, row.product, 'packaged_labeled', row.units, row.volume, newId()));
  }
  for (const productId of hide) {
    write(sql`UPDATE catalog.product SET for_sale = FALSE WHERE id = CAST(${productId} AS UUID)`);
  }
  const storageId = newId();
  write(sql`
    INSERT INTO inventory.pallet_storage (
      id, location_id, operator_name, operator_tax_id, price_eur_per_pallet_month, counted_pallets, notes
    ) VALUES (
      CAST(${storageId} AS UUID), CAST(${tfrpId} AS UUID), ${TFRP_STORAGE.operator}, ${TFRP_STORAGE.taxId},
      CAST(${TFRP_STORAGE.price} AS DECIMAL(12,2)), ${TFRP_STORAGE.countedPallets},
      'La hoja CVPO TFRP suma 13 palets. Agosto y septiembre facturan 12 a 7,20 €.'
    )
  `);
  for (const invoice of TFRP_STORAGE.invoices) {
    write(sql`
      INSERT INTO inventory.pallet_storage_invoice (
        id, storage_id, invoice_number, invoice_date, billed_pallets, line_amount_eur, mismatch, notes
      ) VALUES (
        CAST(${newId()} AS UUID), CAST(${storageId} AS UUID), ${invoice.number}, CAST(${invoice.date} AS DATE),
        ${invoice.billed}, CAST(${invoice.amount} AS DECIMAL(12,2)), TRUE,
        ${`${invoice.billed} palets facturados y 13 en la hoja de stock.`}
      )
    `);
  }

  await writer.withWrite(ACTOR, async (tx) => {
    for (const statement of statements) tx.write(statement);
  });
  return report(false, lines, unmatched, matched);
}

function matchProductLoose(
  wine: string | null,
  products: readonly ProductRef[],
  lots: readonly LotRef[],
  lotId: string | null,
): string | null {
  if (!wine || !lotId) return null;
  const lot = lots.find((row) => row.id === lotId);
  if (!lot?.wineId) return null;
  const hits = products.filter((product) => product.kind === 'wine' && product.wineId === lot.wineId);
  return hits.length === 1 ? hits[0]?.id ?? null : null;
}

function matchLotLoose(wine: string | null, lots: readonly LotRef[]): string | null {
  if (!wine) return null;
  const key = fold(wine);
  const hits = lots.filter((lot) => fold(lot.code).includes(key));
  return hits.length === 1 ? hits[0]?.id ?? null : null;
}

function openingMove(
  locationId: string,
  ownerId: string,
  vesselId: string | null,
  lotId: string | null,
  productId: string | null,
  state: string,
  units: number,
  volume: number,
  sourceId: string,
): string {
  return sql`
    INSERT INTO inventory.stock_move (
      id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
      product_state, qty_units, volume_ml, mass_g, source_table, source_id, created_by
    ) VALUES (
      CAST(${newId()} AS UUID), CAST(${OPENING_AT} AS TIMESTAMPTZ), 'opening',
      CAST(${locationId} AS UUID),
      CASE WHEN ${vesselId} IS NULL THEN NULL ELSE CAST(${vesselId} AS UUID) END,
      CAST(${ownerId} AS UUID),
      CASE WHEN ${lotId} IS NULL THEN NULL ELSE CAST(${lotId} AS UUID) END,
      CASE WHEN ${productId} IS NULL THEN NULL ELSE CAST(${productId} AS UUID) END,
      ${state}, ${units}, ${volume}, 0, 'cellar.bottled_placement', CAST(${sourceId} AS UUID), 'load-bottled-stock'
    )
  `;
}

function report(already: boolean, lines: BottledLine[], unmatched: Report['unmatched'], matched = 0): Report {
  const caja = sumLines(lines, 'caja');
  const nicho = sumLines(lines, 'nicho');
  const jaulon = sumLines(lines, 'jaulon');
  const palet = sumLines(lines, 'palet');
  const full = BARRELS.reduce((sum, row) => sum + row.fill_ml, 0);
  return {
    already_loaded: already,
    matched,
    unmatched,
    totals: {
      cajas: { bottles: caja.bottles, litres: litres(caja.volume_ml) },
      nichos: { bottles: nicho.bottles, litres: litres(nicho.volume_ml) },
      jaulones: { bottles: jaulon.bottles, litres: litres(jaulon.volume_ml) },
      bodega: { bottles: caja.bottles + nicho.bottles + jaulon.bottles, litres: litres(caja.volume_ml + nicho.volume_ml + jaulon.volume_ml) },
      tfrp: { bottles: palet.bottles, litres: litres(palet.volume_ml) },
      barricas: { bottles: BARRELS.filter((row) => row.fill_ml > 0).length, litres: litres(full) },
    },
    barrels: { loaded: BARRELS.length, full_litres: litres(full), gap: '16 en la hoja; Pedro recuerda unas 17; 2024 numera 19 más dos tinajas.' },
    pallets: { counted: 13, billed: 12, price_eur: '7.20' },
    assumptions: [
      'El envasado de la bodega es de P.O. El de TFRP es de CVPO.',
      'El libro físico agrupa el envasado en litros por producto y lote, sin formato ni jaulón. El mapa guarda el hueco.',
      'Los jaulones de la hoja no traen número: se numeran por el orden de la línea.',
      'WINEOUT se queda en stock y no se vende.',
      'Melós queda ligado al lote 2019 y la Garnacha Pirotécnica al lote EGP2023 si existen. Si no, no se inventan.',
      'Demorado es añada 2024, lote L2024, aunque tres PDF de tarifa impriman 2023.',
      'Llueve Llueve, enTreDicho Ft, Bobal Plus y Aplatinao no tienen tarifa: el precio es manual.',
      'La celda TOTAL de TFRP dice 6.241,50 L y omite los 54 L de Llueve Llueve. Las líneas suman 6.295,50 L y 8.394 botellas.',
    ],
  };
}
