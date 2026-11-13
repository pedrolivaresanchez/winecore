import type { Actor, Writer } from '../../db/writer';
import { sql } from '../../db/sql';
import { domainError } from '../../errors';
import { businessDate } from '../../time';
import {
  chooseStoredPrice,
  compareWarehouses,
  currentVersion,
  exVatUnit,
  isValuationList,
  litresValue,
  previousPriceNote,
  sumMoney,
  unitsValue,
  valuationListLabel,
  type TariffPrice,
  type TariffVersion,
  type ValuationListCode,
} from '../valuation';

export type PriceOrigin = 'override' | 'current' | 'previous' | 'worthless';

export type ValuationLine = {
  kind: 'packaged' | 'demijohn' | 'bulk';
  wine_id: string | null;
  wine_name: string;
  location_code: string;
  location_name: string;
  reference: string;
  sku: string | null;
  product_id: string | null;
  lot_id: string | null;
  lot_code: string | null;
  vessel_code: string | null;
  vessel_name: string | null;
  bottles: number | null;
  litres: string;
  unit_price: string | null;
  price_unit: 'bottle' | 'litre';
  price_origin: PriceOrigin | null;
  price_note: string | null;
  price_version: number | null;
  price_valid_from: string | null;
  value: string | null;
  missing_price: boolean;
};

export type ValuationGroup = {
  wine_id: string | null;
  wine_name: string;
  bottles: number;
  litres: string;
  value: string | null;
  partial: boolean;
  lines: ValuationLine[];
};

export type ValuationBody = {
  as_of: string;
  list: {
    code: ValuationListCode;
    label: string;
    name: string | null;
    tax_included: boolean;
    available: boolean;
    version: number | null;
    valid_from: string | null;
  };
  lists: { code: ValuationListCode; label: string }[];
  rates: {
    demijohn_eur_per_litre: string;
    bulk_eur_per_litre: string;
    bulk_wines: { wine_id: string; wine_name: string | null; eur_per_litre: string }[];
    updated_at: string | null;
  };
  worthless: { subject: 'vessel' | 'lot'; subject_key: string }[];
  groups: ValuationGroup[];
  packaged: SectionTotal & { bottles: number; missing: number; previous: number; overrides: number };
  demijohns: SectionTotal & { vessels: number };
  bulk: SectionTotal & { vessels: number };
  total: { value: string | null; partial: boolean };
};

type SectionTotal = { litres: string; value: string | null; partial: boolean };

type RawPack = {
  location_code: string;
  location_name: string;
  product_id: string | null;
  sku: string | null;
  reference: string;
  tax_code: string | null;
  lot_id: string | null;
  lot_code: string | null;
  wine_id: string | null;
  wine_name: string | null;
  bottles: number;
  volume_ml: number;
  bottle_ml: number | null;
};

type RawVessel = {
  code: string;
  name: string;
  kind: string;
  location_code: string;
  location_name: string;
  lot_id: string | null;
  lot_code: string | null;
  wine_id: string | null;
  wine_name: string | null;
  volume_ml: number;
};

const DEFAULT_DEMIJOHN = '50.00';
const DEFAULT_BULK = '3.00';
const UNASSIGNED = 'Sin asignar';

export async function buildValuation(writer: Writer, listCode: ValuationListCode, now = new Date()): Promise<ValuationBody> {
  const today = businessDate(now);
  const [list, prices, overrides, rates, worthless, taxes, packaged, vessels] = await Promise.all([
    loadList(writer, listCode, today),
    loadPrices(writer, listCode),
    loadOverrides(writer, listCode),
    loadRates(writer),
    loadWorthless(writer),
    loadTaxes(writer),
    loadPackaged(writer),
    loadVessels(writer),
  ]);
  const lines: ValuationLine[] = [];
  for (const row of packaged) {
    lines.push(packagedLine(row, list, prices, overrides, worthless, taxes, today));
  }
  for (const row of vessels) {
    if (row.kind === 'demijohn') lines.push(vesselLine(row, 'demijohn', rates.demijohn, null, worthless));
    else lines.push(vesselLine(row, 'bulk', rates.bulk, rates.wines, worthless));
  }
  const groups = groupLines(lines);
  const packagedLines = lines.filter((line) => line.kind === 'packaged');
  const demijohnLines = lines.filter((line) => line.kind === 'demijohn');
  const bulkLines = lines.filter((line) => line.kind === 'bulk');
  return {
    as_of: today,
    list: {
      code: listCode,
      label: valuationListLabel(listCode),
      name: list?.name ?? null,
      tax_included: list?.taxIncluded ?? false,
      available: list != null,
      version: list?.current?.version ?? null,
      valid_from: list?.current?.validFrom ?? null,
    },
    lists: [
      { code: 'distributor', label: 'Distribución' },
      { code: 'shop', label: 'Tienda' },
      { code: 'custom-horeca', label: 'Restaurante' },
      { code: 'final', label: 'PVP' },
    ],
    rates: {
      demijohn_eur_per_litre: rates.demijohn,
      bulk_eur_per_litre: rates.bulk,
      bulk_wines: rates.wineRows,
      updated_at: rates.updatedAt,
    },
    worthless: worthless.rows,
    groups,
    packaged: {
      ...sectionOf(packagedLines),
      bottles: packagedLines.reduce((sum, line) => sum + (line.bottles ?? 0), 0),
      missing: packagedLines.filter((line) => line.missing_price).length,
      previous: packagedLines.filter((line) => line.price_origin === 'previous').length,
      overrides: packagedLines.filter((line) => line.price_origin === 'override').length,
    },
    demijohns: { ...sectionOf(demijohnLines), vessels: demijohnLines.length },
    bulk: { ...sectionOf(bulkLines), vessels: bulkLines.length },
    total: totalOf(lines),
  };
}

export type SettingsPatch = {
  demijohnEurPerLitre?: string;
  bulkEurPerLitre?: string;
  bulkWines?: { wineId: string; eurPerLitre: string }[];
  price?: { productId: string; list: ValuationListCode; unitPrice: string | null };
  worthless?: { subject: 'vessel' | 'lot'; subjectKey: string; enabled: boolean };
};

export async function applySettings(writer: Writer, actor: Actor, patch: SettingsPatch): Promise<void> {
  if (patch.bulkWines) await assertWines(writer, patch.bulkWines.map((row) => row.wineId));
  if (patch.price) await assertProduct(writer, patch.price.productId);
  await writer.withWrite(actor, async (tx) => {
    if (patch.demijohnEurPerLitre) writeRate(tx, 'demijohn', '', patch.demijohnEurPerLitre, actor.id);
    if (patch.bulkEurPerLitre) writeRate(tx, 'bulk', '', patch.bulkEurPerLitre, actor.id);
    if (patch.bulkWines) {
      tx.write(`DELETE FROM inventory.valuation_rate WHERE scope = 'bulk' AND wine_key <> ''`);
      for (const row of patch.bulkWines) writeRate(tx, 'bulk', row.wineId, row.eurPerLitre, actor.id);
      tx.audit({
        table: 'inventory.valuation_rate',
        rowId: null,
        action: 'UPDATE',
        before: null,
        after: { scope: 'bulk', wines: patch.bulkWines },
      });
    }
    if (patch.price) {
      const { productId, list, unitPrice } = patch.price;
      if (unitPrice == null) {
        tx.write(sql`
          DELETE FROM inventory.valuation_price
          WHERE product_id = CAST(${productId} AS UUID) AND list_code = ${list}
        `);
      } else {
        tx.write(sql`
          DELETE FROM inventory.valuation_price
          WHERE product_id = CAST(${productId} AS UUID) AND list_code = ${list}
        `);
        tx.write(sql`
          INSERT INTO inventory.valuation_price (product_id, list_code, unit_price, updated_by)
          VALUES (CAST(${productId} AS UUID), ${list}, CAST(${unitPrice} AS DECIMAL(14,2)), ${actor.id})
        `);
      }
      tx.audit({
        table: 'inventory.valuation_price',
        rowId: productId,
        action: unitPrice == null ? 'DELETE' : 'UPDATE',
        before: null,
        after: { list, unit_price: unitPrice },
      });
    }
    if (patch.worthless) {
      const { subject, subjectKey, enabled } = patch.worthless;
      tx.write(sql`
        DELETE FROM inventory.valuation_worthless
        WHERE subject = ${subject} AND subject_key = ${subjectKey}
      `);
      if (enabled) {
        tx.write(sql`
          INSERT INTO inventory.valuation_worthless (subject, subject_key, created_by)
          VALUES (${subject}, ${subjectKey}, ${actor.id})
        `);
      }
      tx.audit({
        table: 'inventory.valuation_worthless',
        rowId: null,
        action: enabled ? 'INSERT' : 'DELETE',
        before: null,
        after: { subject, subject_key: subjectKey, enabled },
      });
    }
  });
}

export function requireList(value: string | null): ValuationListCode {
  const code = (value ?? 'distributor').trim();
  if (!isValuationList(code)) {
    throw domainError('WC_VALIDATION', { list: 'La tarifa no es Distribución, Tienda, Restaurante ni PVP' });
  }
  return code;
}

function writeRate(tx: { write(statement: string): void }, scope: string, wineKey: string, price: string, actorId: string) {
  tx.write(sql`
    DELETE FROM inventory.valuation_rate WHERE scope = ${scope} AND wine_key = ${wineKey}
  `);
  tx.write(sql`
    INSERT INTO inventory.valuation_rate (scope, wine_key, eur_per_litre, updated_by)
    VALUES (${scope}, ${wineKey}, CAST(${price} AS DECIMAL(12,2)), ${actorId})
  `);
}

type ListContext = {
  name: string;
  taxIncluded: boolean;
  current: TariffVersion | null;
};

async function loadList(writer: Writer, code: ValuationListCode, today: string): Promise<ListContext | null> {
  const lists = await writer.read<Record<string, unknown>>(sql`
    SELECT name, tax_included
    FROM catalog.price_list
    WHERE code = ${code} AND is_active
  `);
  const list = lists[0];
  if (!list) return null;
  const versions = await writer.read<Record<string, unknown>>(sql`
    SELECT v.id::VARCHAR AS id, v.version::VARCHAR AS version, v.status,
           CAST(v.valid_from AS VARCHAR) AS valid_from, CAST(v.valid_to AS VARCHAR) AS valid_to
    FROM catalog.price_list_version v
    JOIN catalog.price_list l ON l.id = v.price_list_id
    WHERE l.code = ${code}
  `);
  const parsed: TariffVersion[] = versions.map((row) => ({
    id: idOf(row.id) ?? '',
    version: intOf(row.version),
    validFrom: dayOf(row.valid_from) ?? '',
    validTo: dayOf(row.valid_to),
    status: statusOf(row.status),
  }));
  return {
    name: String(list.name),
    taxIncluded: list.tax_included === true,
    current: currentVersion(parsed, today),
  };
}

async function loadPrices(writer: Writer, code: ValuationListCode): Promise<TariffPrice[]> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT i.product_id::VARCHAR AS product_id, CAST(i.unit_price AS VARCHAR) AS unit_price,
           CAST(i.min_qty AS VARCHAR) AS min_qty, v.id::VARCHAR AS version_id,
           v.version::VARCHAR AS version, CAST(v.valid_from AS VARCHAR) AS valid_from, v.status
    FROM catalog.price_list_item i
    JOIN catalog.price_list_version v ON v.id = i.version_id
    JOIN catalog.price_list l ON l.id = v.price_list_id
    WHERE l.code = ${code}
  `);
  return rows.flatMap((row) => {
    const productId = idOf(row.product_id);
    const versionId = idOf(row.version_id);
    const validFrom = dayOf(row.valid_from);
    if (!productId || !versionId || !validFrom) return [];
    return [{
      productId,
      unitPrice: String(row.unit_price),
      minQty: String(row.min_qty),
      versionId,
      version: intOf(row.version),
      validFrom,
      status: statusOf(row.status),
    }];
  });
}

async function loadOverrides(writer: Writer, code: ValuationListCode): Promise<Map<string, string>> {
  const rows = await writer.read<{ product_id: string; unit_price: string }>(sql`
    SELECT product_id::VARCHAR AS product_id, CAST(unit_price AS VARCHAR) AS unit_price
    FROM inventory.valuation_price
    WHERE list_code = ${code}
  `);
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = idOf(row.product_id);
    if (id) map.set(id, money2(row.unit_price));
  }
  return map;
}

async function loadRates(writer: Writer): Promise<{
  demijohn: string;
  bulk: string;
  wines: Map<string, string>;
  wineRows: { wine_id: string; wine_name: string | null; eur_per_litre: string }[];
  updatedAt: string | null;
}> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT scope, wine_key, CAST(eur_per_litre AS VARCHAR) AS eur_per_litre
    FROM inventory.valuation_rate
  `);
  let demijohn = DEFAULT_DEMIJOHN;
  let bulk = DEFAULT_BULK;
  const wines = new Map<string, string>();
  for (const row of rows) {
    const price = money2(row.eur_per_litre);
    const key = String(row.wine_key ?? '');
    if (row.scope === 'demijohn' && key === '') demijohn = price;
    else if (row.scope === 'bulk' && key === '') bulk = price;
    else if (row.scope === 'bulk' && key !== '') wines.set(key.toLowerCase(), price);
  }
  const names = new Map<string, string>();
  if (wines.size > 0) {
    const ids = [...wines.keys()].map((id) => `CAST('${id}' AS UUID)`).join(', ');
    const wineRows = await writer.read<{ id: string; name: string }>(`
      SELECT id::VARCHAR AS id, name FROM catalog.wine_visible WHERE id IN (${ids})
    `);
    for (const row of wineRows) {
      const id = idOf(row.id);
      if (id) names.set(id, row.name);
    }
  }
  const stamp = await writer.read<{ updated_at: string | null }>(`
    SELECT CAST(max(updated_at) AS VARCHAR) AS updated_at FROM (
      SELECT updated_at FROM inventory.valuation_rate
      UNION ALL
      SELECT updated_at FROM inventory.valuation_price
      UNION ALL
      SELECT created_at AS updated_at FROM inventory.valuation_worthless
    )
  `);
  return {
    demijohn,
    bulk,
    wines,
    wineRows: [...wines.entries()].map(([wineId, price]) => ({
      wine_id: wineId,
      wine_name: names.get(wineId) ?? null,
      eur_per_litre: price,
    })),
    updatedAt: stamp[0]?.updated_at ?? null,
  };
}

async function loadWorthless(writer: Writer): Promise<{
  vessels: Set<string>;
  lots: Set<string>;
  rows: { subject: 'vessel' | 'lot'; subject_key: string }[];
}> {
  const rows = await writer.read<{ subject: string; subject_key: string }>(`
    SELECT subject, subject_key FROM inventory.valuation_worthless ORDER BY subject, subject_key
  `);
  const vessels = new Set<string>();
  const lots = new Set<string>();
  const listed: { subject: 'vessel' | 'lot'; subject_key: string }[] = [];
  for (const row of rows) {
    if (row.subject === 'vessel') {
      vessels.add(row.subject_key);
      listed.push({ subject: 'vessel', subject_key: row.subject_key });
    } else if (row.subject === 'lot') {
      const key = row.subject_key.toLowerCase();
      lots.add(key);
      listed.push({ subject: 'lot', subject_key: key });
    }
  }
  return { vessels, lots, rows: listed };
}

async function loadTaxes(writer: Writer): Promise<Map<string, string>> {
  const rows = await writer.read<{ code: string; rate: string }>(`
    SELECT code, CAST(rate AS VARCHAR) AS rate FROM billing.tax_code
  `);
  return new Map(rows.map((row) => [row.code, String(row.rate)]));
}

async function loadPackaged(writer: Writer): Promise<RawPack[]> {
  const mapRows = await readPack(writer, 'map');
  const bookRows = await readPack(writer, 'book');
  const covered = new Set(mapRows.filter((row) => row.product_id).map(packKey));
  const extra = bookRows.filter((row) => !row.product_id || !covered.has(packKey(row)));
  return [...mapRows, ...extra].sort((left, right) =>
    compareWarehouses(left.location_code, right.location_code)
    || left.reference.localeCompare(right.reference, 'es')
    || (left.lot_code ?? '').localeCompare(right.lot_code ?? '', 'es'),
  );
}

function packKey(row: RawPack): string {
  return `${row.location_code}|${row.product_id ?? ''}|${row.lot_id ?? ''}`;
}

async function readPack(writer: Writer, source: 'map' | 'book'): Promise<RawPack[]> {
  const statement = source === 'map' ? `
    SELECT loc.code AS location_code, any_value(loc.name) AS location_name,
           lower(p.product_id::VARCHAR) AS product_id, any_value(pr.sku) AS sku,
           any_value(coalesce(pr.name, p.wine_label)) AS reference_name,
           any_value(pr.default_tax_code) AS tax_code,
           lower(p.lot_id::VARCHAR) AS lot_id, any_value(coalesce(l.code, p.lot_code_raw)) AS lot_code,
           lower(any_value(coalesce(po.wine_id, lo.wine_id, pr.wine_id, l.wine_id, p.wine_id)::VARCHAR)) AS wine_id,
           any_value(w.name) AS wine_name,
           CAST(any_value(p.bottle_ml) AS VARCHAR) AS bottle_ml,
           CAST(coalesce(sum(m.qty_units), 0) AS VARCHAR) AS bottles,
           CAST(coalesce(sum(m.volume_ml), 0) AS VARCHAR) AS volume_ml
    FROM cellar.bottled_placement p
    JOIN inventory.location loc ON loc.id = p.location_id
    LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
    LEFT JOIN catalog.product pr ON pr.id = p.product_id
    LEFT JOIN catalog.product_overlay po ON po.product_id = pr.id
    LEFT JOIN inventory.lot l ON l.id = p.lot_id
    LEFT JOIN inventory.lot_overlay lo ON lo.lot_id = l.id
    LEFT JOIN catalog.wine_visible w ON w.id = coalesce(po.wine_id, lo.wine_id, pr.wine_id, l.wine_id, p.wine_id)
    WHERE p.product_state IN ('packaged_unlabeled', 'packaged_labeled')
    GROUP BY loc.code, p.product_id, p.lot_id, coalesce(p.product_id::VARCHAR, p.wine_label)
    HAVING coalesce(sum(m.qty_units), 0) > 0
  ` : `
    SELECT loc.code AS location_code, any_value(loc.name) AS location_name,
           lower(m.product_id::VARCHAR) AS product_id, any_value(pr.sku) AS sku,
           any_value(coalesce(pr.name, w.name, 'Envasado')) AS reference_name,
           any_value(pr.default_tax_code) AS tax_code,
           lower(m.lot_id::VARCHAR) AS lot_id, any_value(l.code) AS lot_code,
           lower(any_value(coalesce(po.wine_id, lo.wine_id, pr.wine_id, l.wine_id)::VARCHAR)) AS wine_id,
           any_value(w.name) AS wine_name,
           CAST(any_value(f.nominal_volume_ml) AS VARCHAR) AS bottle_ml,
           CAST(coalesce(sum(m.qty_units), 0) AS VARCHAR) AS bottles,
           CAST(coalesce(sum(m.volume_ml), 0) AS VARCHAR) AS volume_ml
    FROM inventory.stock_move m
    JOIN inventory.location loc ON loc.id = m.location_id
    LEFT JOIN catalog.product pr ON pr.id = m.product_id
    LEFT JOIN catalog.format f ON f.id = pr.format_id
    LEFT JOIN catalog.product_overlay po ON po.product_id = pr.id
    LEFT JOIN inventory.lot l ON l.id = m.lot_id
    LEFT JOIN inventory.lot_overlay lo ON lo.lot_id = l.id
    LEFT JOIN catalog.wine_visible w ON w.id = coalesce(po.wine_id, lo.wine_id, pr.wine_id, l.wine_id)
    WHERE m.product_state IN ('packaged_unlabeled', 'packaged_labeled')
      AND m.vessel_id IS NULL
    GROUP BY loc.code, m.product_id, m.lot_id
    HAVING coalesce(sum(m.qty_units), 0) > 0
  `;
  const rows = await writer.read<Record<string, unknown>>(statement);
  return rows.map((row) => {
    const bottles = intOf(row.bottles);
    const bottle = row.bottle_ml == null || row.bottle_ml === '' ? null : intOf(row.bottle_ml);
    const volume = intOf(row.volume_ml);
    return {
      location_code: String(row.location_code),
      location_name: String(row.location_name ?? row.location_code),
      product_id: idOf(row.product_id),
      sku: row.sku == null ? null : String(row.sku),
      reference: String(row.reference_name ?? 'Envasado'),
      tax_code: row.tax_code == null ? null : String(row.tax_code),
      lot_id: idOf(row.lot_id),
      lot_code: row.lot_code == null ? null : String(row.lot_code),
      wine_id: idOf(row.wine_id),
      wine_name: row.wine_name == null ? null : String(row.wine_name),
      bottles,
      volume_ml: volume > 0 ? volume : bottle && bottles > 0 ? bottles * bottle : 0,
      bottle_ml: bottle,
    };
  });
}

async function loadVessels(writer: Writer): Promise<RawVessel[]> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT v.code, v.name, v.kind, loc.code AS location_code, loc.name AS location_name,
           lower(m.lot_id::VARCHAR) AS lot_id, l.code AS lot_code,
           lower(coalesce(lo.wine_id, l.wine_id)::VARCHAR) AS wine_id, w.name AS wine_name,
           CAST(sum(m.volume_ml) AS VARCHAR) AS volume_ml
    FROM cellar.vessel v
    JOIN inventory.location loc ON loc.id = v.location_id
    JOIN inventory.stock_move m ON m.vessel_id = v.id
    LEFT JOIN inventory.lot l ON l.id = m.lot_id
    LEFT JOIN inventory.lot_overlay lo ON lo.lot_id = l.id
    LEFT JOIN catalog.wine_visible w ON w.id = coalesce(lo.wine_id, l.wine_id)
    WHERE v.status <> 'retired'
      AND (m.product_state IS NULL OR m.product_state NOT IN ('grape', 'goods'))
      AND (
        v.kind IN ('demijohn', 'tank_storage', 'tank_fermenter')
        OR v.code IN (SELECT subject_key FROM inventory.valuation_worthless WHERE subject = 'vessel')
      )
    GROUP BY v.code, v.name, v.kind, loc.code, loc.name, m.lot_id, l.code, lo.wine_id, l.wine_id, w.name
    HAVING sum(m.volume_ml) > 0
    ORDER BY v.code
  `);
  return rows.map((row) => ({
    code: String(row.code),
    name: String(row.name),
    kind: String(row.kind),
    location_code: String(row.location_code),
    location_name: String(row.location_name ?? row.location_code),
    lot_id: idOf(row.lot_id),
    lot_code: row.lot_code == null ? null : String(row.lot_code),
    wine_id: idOf(row.wine_id),
    wine_name: row.wine_name == null ? null : String(row.wine_name),
    volume_ml: intOf(row.volume_ml),
  }));
}

function packagedLine(
  row: RawPack,
  list: ListContext | null,
  prices: readonly TariffPrice[],
  overrides: Map<string, string>,
  worthless: { lots: Set<string> },
  taxes: Map<string, string>,
  today: string,
): ValuationLine {
  const litres = litresValue(row.volume_ml, '0.00').litres;
  const base = {
    kind: 'packaged' as const,
    wine_id: row.wine_id,
    wine_name: row.wine_name ?? row.reference,
    location_code: row.location_code,
    location_name: row.location_name,
    reference: row.reference,
    sku: row.sku,
    product_id: row.product_id,
    lot_id: row.lot_id,
    lot_code: row.lot_code,
    vessel_code: null,
    vessel_name: null,
    bottles: row.bottles,
    litres,
    price_unit: 'bottle' as const,
  };
  if (row.lot_id && worthless.lots.has(row.lot_id)) return worthlessLine(base);
  const override = row.product_id ? overrides.get(row.product_id) : undefined;
  if (override) {
    return priced(base, override, 'override', 'Precio de valoración', null, null, row.bottles);
  }
  const chosen = row.product_id
    ? chooseStoredPrice(prices, row.product_id, list?.current ?? null, today)
    : null;
  if (!chosen || !list) return missing(base);
  const rate = taxes.get(row.tax_code ?? '') ?? '21';
  const unit = exVatUnit(chosen.stored, list.taxIncluded, rate);
  const note = chosen.origin === 'previous' ? previousPriceNote(chosen.version, chosen.validFrom) : 'Tarifa vigente';
  return priced(base, unit, chosen.origin, note, chosen.version, chosen.validFrom, row.bottles);
}

function vesselLine(
  row: RawVessel,
  kind: 'demijohn' | 'bulk',
  defaultRate: string,
  wineRates: Map<string, string> | null,
  worthless: { vessels: Set<string>; lots: Set<string> },
): ValuationLine {
  const rate = (row.wine_id && wineRates?.get(row.wine_id)) || defaultRate;
  const valued = litresValue(row.volume_ml, rate);
  const base = {
    kind,
    wine_id: row.wine_id,
    wine_name: row.wine_name ?? (kind === 'demijohn' ? 'Damajuana' : row.name),
    location_code: row.location_code,
    location_name: row.location_name,
    reference: row.name,
    sku: null,
    product_id: null,
    lot_id: row.lot_id,
    lot_code: row.lot_code,
    vessel_code: row.code,
    vessel_name: row.name,
    bottles: null,
    litres: valued.litres,
    price_unit: 'litre' as const,
  };
  if (worthless.vessels.has(row.code) || (row.lot_id != null && worthless.lots.has(row.lot_id))) {
    return worthlessLine({ ...base, litres: litresValue(row.volume_ml, '0.00').litres });
  }
  const note = row.wine_id && wineRates?.has(row.wine_id) ? 'Precio del vino' : 'Precio por litro';
  return {
    ...base,
    unit_price: rate,
    price_origin: 'current',
    price_note: note,
    price_version: null,
    price_valid_from: null,
    value: valued.value,
    missing_price: false,
  };
}

function worthlessLine(base: Omit<ValuationLine, 'unit_price' | 'price_origin' | 'price_note' | 'price_version' | 'price_valid_from' | 'value' | 'missing_price'>): ValuationLine {
  return {
    ...base,
    unit_price: '0.00',
    price_origin: 'worthless',
    price_note: 'Sin valor',
    price_version: null,
    price_valid_from: null,
    value: '0.00',
    missing_price: false,
  };
}

function missing(base: Omit<ValuationLine, 'unit_price' | 'price_origin' | 'price_note' | 'price_version' | 'price_valid_from' | 'value' | 'missing_price'>): ValuationLine {
  return {
    ...base,
    unit_price: null,
    price_origin: null,
    price_note: 'Sin precio',
    price_version: null,
    price_valid_from: null,
    value: null,
    missing_price: true,
  };
}

function priced(
  base: Omit<ValuationLine, 'unit_price' | 'price_origin' | 'price_note' | 'price_version' | 'price_valid_from' | 'value' | 'missing_price'>,
  unit: string,
  origin: PriceOrigin,
  note: string,
  version: number | null,
  validFrom: string | null,
  bottles: number,
): ValuationLine {
  return {
    ...base,
    unit_price: unit,
    price_origin: origin,
    price_note: note,
    price_version: version,
    price_valid_from: validFrom,
    value: unitsValue(bottles, unit),
    missing_price: false,
  };
}

function groupLines(lines: readonly ValuationLine[]): ValuationGroup[] {
  const groups = new Map<string, ValuationLine[]>();
  for (const line of lines) {
    const key = line.wine_id ?? `name:${line.wine_name}`;
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }
  const built = [...groups.values()].map((groupLines) => {
    const first = groupLines[0];
    const wineName = first?.wine_id ? (first.wine_name || UNASSIGNED) : (first?.wine_name || UNASSIGNED);
    const sorted = [...groupLines].sort((left, right) =>
      kindOrder(left.kind) - kindOrder(right.kind)
      || compareWarehouses(left.location_code, right.location_code)
      || left.reference.localeCompare(right.reference, 'es')
      || (left.lot_code ?? '').localeCompare(right.lot_code ?? '', 'es')
      || (left.vessel_code ?? '').localeCompare(right.vessel_code ?? '', 'es'),
    );
    const section = sectionOf(sorted);
    return {
      wine_id: first?.wine_id ?? null,
      wine_name: wineName,
      bottles: sorted.reduce((sum, line) => sum + (line.bottles ?? 0), 0),
      litres: section.litres,
      value: section.value,
      partial: section.partial,
      lines: sorted,
    };
  });
  built.sort((left, right) => {
    if (left.wine_name === UNASSIGNED) return 1;
    if (right.wine_name === UNASSIGNED) return -1;
    return left.wine_name.localeCompare(right.wine_name, 'es');
  });
  return built;
}

function sectionOf(lines: readonly ValuationLine[]): SectionTotal {
  const known = lines.filter((line) => line.value != null).map((line) => line.value as string);
  const partial = lines.some((line) => line.missing_price);
  return {
    litres: sumMoney(lines.map((line) => line.litres)),
    value: known.length === 0 ? null : sumMoney(known),
    partial,
  };
}

function totalOf(lines: readonly ValuationLine[]): { value: string | null; partial: boolean } {
  const section = sectionOf(lines);
  return { value: section.value, partial: section.partial };
}

function kindOrder(kind: ValuationLine['kind']): number {
  if (kind === 'packaged') return 0;
  if (kind === 'demijohn') return 1;
  return 2;
}

async function assertWines(writer: Writer, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const list = unique.map((id) => `CAST('${id}' AS UUID)`).join(', ');
  const rows = await writer.read<{ id: string }>(`SELECT id::VARCHAR AS id FROM catalog.wine WHERE id IN (${list})`);
  const found = new Set(rows.map((row) => idOf(row.id)));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) throw domainError('WC_VALIDATION', { wine_id: 'El vino no existe' });
}

async function assertProduct(writer: Writer, id: string): Promise<void> {
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM catalog.product WHERE id = CAST(${id} AS UUID)
  `);
  if (!rows[0]) throw domainError('WC_VALIDATION', { product_id: 'La referencia no existe' });
}

function statusOf(value: unknown): TariffVersion['status'] {
  if (value === 'active' || value === 'retired' || value === 'draft') return value;
  return 'draft';
}

function idOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  const text = String(value).toLowerCase();
  return text === 'null' ? null : text;
}

function dayOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function intOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function money2(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
}
