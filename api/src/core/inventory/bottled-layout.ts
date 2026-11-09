import type { Writer } from '../db/writer';
import { BARREL_GAP, BARRELS, DEMIJOHNS, PHOTO_DATE, TFRP_STORAGE } from './bottled-snapshot';
import { DEMORADO, MANUAL_PRICE, NOT_FOR_SALE } from '../catalog/tariff-rules';

function intOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/** Botellas sin etiquetar del mapa: primero jaulones, luego la parte sin etiqueta de un nicho. */
export async function unlabeledMap(writer: Writer): Promise<{ items: Record<string, unknown>[] }> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT loc.id::VARCHAR AS location_id, loc.code AS location_code, loc.name AS location_name,
           p.owner_entity_id::VARCHAR AS owner_entity_id,
           p.lot_id::VARCHAR AS lot_id, l.code AS lot_code,
           p.product_id::VARCHAR AS product_id, pr.name AS product_name,
           coalesce(sum(m.qty_units), 0)::VARCHAR AS qty_units,
           coalesce(sum(m.volume_ml), 0)::VARCHAR AS volume_ml,
           max(CASE WHEN p.slot_kind = 'jaulon' THEN 1 ELSE 0 END)::VARCHAR AS from_cage
    FROM cellar.bottled_placement p
    JOIN inventory.location loc ON loc.id = p.location_id
    JOIN inventory.lot l ON l.id = p.lot_id
    JOIN catalog.product pr ON pr.id = p.product_id
    LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
    WHERE p.product_state = 'packaged_unlabeled'
      AND p.slot_kind IN ('jaulon', 'nicho')
    GROUP BY loc.id, loc.code, loc.name, p.owner_entity_id, p.lot_id, l.code, p.product_id, pr.name
    HAVING coalesce(sum(m.qty_units), 0) > 0
    ORDER BY from_cage DESC, l.code
  `);
  return {
    items: rows.map((row) => ({
      location_id: String(row.location_id),
      location_code: String(row.location_code),
      location_name: String(row.location_name),
      owner_entity_id: String(row.owner_entity_id),
      lot_id: String(row.lot_id),
      lot_code: String(row.lot_code),
      product_id: String(row.product_id),
      product_name: String(row.product_name),
      qty_units: intOf(row.qty_units),
      volume_ml: intOf(row.volume_ml),
      nominal_volume_ml: null,
    })),
  };
}

export async function warehouseLayout(writer: Writer): Promise<Record<string, unknown>> {
  const placements = await writer.read<Record<string, unknown>>(`
    SELECT p.slot_kind, p.slot_code, p.niche_number::VARCHAR AS niche_number, p.pallet_count::VARCHAR AS pallet_count,
           p.line_no::VARCHAR AS line_no, p.wine_label, p.lot_code_raw, p.color, p.product_state,
           p.opened_bottles::VARCHAR AS opened_bottles, p.opened_volume_ml::VARCHAR AS opened_volume_ml,
           p.bottle_ml::VARCHAR AS bottle_ml, p.abv_pct::VARCHAR AS abv_pct, p.is_organic, p.not_for_sale,
           p.note, p.match_status, p.match_note, l.code AS lot_code, w.name AS wine_name,
           loc.code AS location_code,
           coalesce(sum(m.qty_units), 0)::VARCHAR AS bottles,
           coalesce(sum(m.volume_ml), 0)::VARCHAR AS volume_ml
    FROM cellar.bottled_placement p
    JOIN inventory.location loc ON loc.id = p.location_id
    LEFT JOIN inventory.lot l ON l.id = p.lot_id
    LEFT JOIN catalog.wine w ON w.id = p.wine_id
    LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
    GROUP BY p.id, p.slot_kind, p.slot_code, p.niche_number, p.pallet_count, p.line_no, p.wine_label,
             p.lot_code_raw, p.color, p.product_state, p.opened_bottles, p.opened_volume_ml, p.bottle_ml,
             p.abv_pct, p.is_organic, p.not_for_sale, p.note, p.match_status, p.match_note, l.code, w.name, loc.code
    ORDER BY loc.code, p.slot_kind, p.niche_number NULLS LAST, p.line_no
  `);
  const vessels = await writer.read<Record<string, unknown>>(`
    SELECT v.code, v.name, v.kind, v.capacity_ml::VARCHAR AS capacity_ml, v.zone, v.notes,
           coalesce(sum(m.volume_ml), 0)::VARCHAR AS volume_ml
    FROM cellar.vessel v
    LEFT JOIN inventory.stock_move m ON m.vessel_id = v.id
    WHERE v.kind IN ('barrel', 'demijohn', 'tank_storage', 'tank_fermenter', 'other')
    GROUP BY v.id, v.code, v.name, v.kind, v.capacity_ml, v.zone, v.notes
    ORDER BY v.code
  `);
  const storage = await writer.read<Record<string, unknown>>(`
    SELECT s.counted_pallets::VARCHAR AS counted_pallets, s.price_eur_per_pallet_month::VARCHAR AS price,
           s.operator_name, i.invoice_number, CAST(i.invoice_date AS VARCHAR) AS invoice_date,
           i.billed_pallets::VARCHAR AS billed_pallets, i.line_amount_eur::VARCHAR AS amount, i.mismatch, i.notes
    FROM inventory.pallet_storage s
    LEFT JOIN inventory.pallet_storage_invoice i ON i.storage_id = s.id
    ORDER BY i.invoice_date
  `);
  const lineOf = (row: Record<string, unknown>) => ({
    slot_code: String(row.slot_code),
    niche_number: row.niche_number == null ? null : intOf(row.niche_number),
    pallet_count: row.pallet_count == null ? null : intOf(row.pallet_count),
    line_no: intOf(row.line_no),
    wine_label: String(row.wine_label),
    lot_code: row.lot_code == null ? row.lot_code_raw : String(row.lot_code),
    wine_name: row.wine_name == null ? null : String(row.wine_name),
    color: row.color == null ? null : String(row.color),
    state: String(row.product_state),
    bottles: intOf(row.bottles),
    opened_bottles: intOf(row.opened_bottles),
    volume_ml: intOf(row.volume_ml),
    opened_volume_ml: intOf(row.opened_volume_ml),
    bottle_ml: row.bottle_ml == null ? null : intOf(row.bottle_ml),
    abv_pct: row.abv_pct == null ? null : String(row.abv_pct),
    organic: row.is_organic == null ? null : row.is_organic === true,
    not_for_sale: row.not_for_sale === true,
    note: row.note == null ? null : String(row.note),
    match_status: String(row.match_status),
    match_note: row.match_note == null ? null : String(row.match_note),
  });
  const of = (code: string, kind: string) => placements.filter((row) => row.location_code === code && row.slot_kind === kind).map(lineOf);
  const barrels = vessels.filter((row) => row.kind === 'barrel').map((row) => {
    const volume = intOf(row.volume_ml);
    const capacity = intOf(row.capacity_ml);
    return {
      code: String(row.code),
      name: String(row.name),
      capacity_ml: capacity,
      volume_ml: volume,
      fill_pct: capacity > 0 ? Math.round((volume / capacity) * 1000) / 10 : 0,
      wine: row.notes == null ? null : String(row.notes),
      empty: volume <= 0,
    };
  });
  const demijohns = vessels.filter((row) => row.kind === 'demijohn');
  const tanks = vessels.filter((row) => row.kind === 'tank_storage' || row.kind === 'tank_fermenter');
  const lees = vessels.find((row) => row.code === 'LIAS');
  return {
    photo_date: PHOTO_DATE,
    loaded: placements.length > 0,
    commercial: {
      demorado: DEMORADO,
      manual_price: MANUAL_PRICE,
      not_for_sale: NOT_FOR_SALE,
    },
    barrel_gap: BARREL_GAP,
    expected_barrels: BARRELS.length,
    bodega: {
      code: 'BOD',
      name: 'Bodega Pedro Olivares',
      boxes: of('BOD', 'caja'),
      cages: of('BOD', 'jaulon'),
      niches: nicheGrid(of('BOD', 'nicho')),
      barrels,
      demijohns: {
        count: demijohns.length,
        capacity_ml: demijohns.reduce((sum, row) => sum + intOf(row.capacity_ml), 0),
        volume_ml: demijohns.reduce((sum, row) => sum + intOf(row.volume_ml), 0),
        expected_units: DEMIJOHNS.units,
      },
      deposits: {
        count: tanks.length,
        volume_ml: tanks.reduce((sum, row) => sum + intOf(row.volume_ml), 0),
      },
      lees: lees ? { capacity_ml: intOf(lees.capacity_ml), volume_ml: intOf(lees.volume_ml) } : null,
    },
    tfrp: {
      code: 'TFRP',
      name: 'Almacén TFRP',
      lines: of('TFRP', 'palet'),
      counted_pallets: storage[0] ? intOf(storage[0].counted_pallets) : TFRP_STORAGE.countedPallets,
      price_eur_per_pallet_month: TFRP_STORAGE.price,
      operator: TFRP_STORAGE.operator,
      invoices: storage.filter((row) => row.invoice_number).map((row) => ({
        number: String(row.invoice_number),
        date: String(row.invoice_date),
        billed_pallets: intOf(row.billed_pallets),
        amount_eur: String(row.amount),
        mismatch: row.mismatch === true,
        notes: String(row.notes ?? ''),
      })),
    },
  };
}

function nicheGrid(lines: ReturnType<typeof Array.prototype.map>) {
  const byNumber = new Map<number, unknown[]>();
  for (const line of lines as { niche_number: number | null }[]) {
    if (line.niche_number == null) continue;
    const list = byNumber.get(line.niche_number) ?? [];
    list.push(line);
    byNumber.set(line.niche_number, list);
  }
  return Array.from({ length: 26 }, (_, index) => {
    const number = index + 1;
    const contents = (byNumber.get(number) ?? []) as { bottles: number; note: string | null; wine_label: string }[];
    const bottles = contents.reduce((sum, line) => sum + line.bottles, 0);
    return {
      number,
      empty: bottles === 0,
      bottles,
      note: contents.map((line) => line.note).filter(Boolean).join(' · ') || null,
      lines: contents,
    };
  });
}
