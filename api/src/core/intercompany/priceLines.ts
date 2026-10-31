import type { Decimal } from 'decimal.js';
import type { Exemption, Qualification, TaxCode, TaxKind } from '../billing/taxCodes';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { money } from '../money';
import { coversDate, intercompanyUnitPrice } from './calendar';
import type { EntityPair } from './entities';
import type { IntercompanyTransfer } from './movements';
import { asDecimal, dateText, uuidIn, uuidText } from './numbers';
import { loadActiveTariffs, tariffForDate, type TariffRecord } from './tariff';

export interface PricedLine {
  sourceTable: IntercompanyTransfer['sourceTable'];
  sourceId: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  requiresLot: boolean;
  lotId: string | null;
  lotCode: string | null;
  nominalVolumeMl: number | null;
  quantity: Decimal;
  baseUnitPrice: Decimal;
  discountPct: Decimal;
  unitPrice: Decimal;
  unitCost: Decimal | null;
  belowCost: boolean;
  costUnknown: boolean;
  occurredAt: string;
  occurredOn: string;
  documentNumber: string | null;
  tariffId: string;
  tax: TaxCode;
}

export interface MissingTariff {
  productId: string;
  productName: string;
  occurredOn: string;
  reason: 'tariff' | 'base_price';
}

export interface MissingLot {
  productId: string;
  productName: string;
  sourceId: string;
}

export async function priceTransfers(
  tx: Tx,
  pair: EntityPair,
  transfers: readonly IntercompanyTransfer[],
): Promise<{ lines: PricedLine[]; missingTariff: MissingTariff[]; missingLot: MissingLot[] }> {
  if (transfers.length === 0) return { lines: [], missingTariff: [], missingLot: [] };
  const productIds = [...new Set(transfers.map((row) => row.productId))];
  const products = await loadProducts(tx, productIds);
  const lots = await loadLots(tx, transfers.map((row) => row.lotId).filter((id): id is string => id !== null));
  const tariffs = await loadActiveTariffs(tx, pair.seller.id, pair.buyer.id);
  const prices = await loadBasePrices(tx, tariffs);
  const costs = await loadCosts(tx, productIds);
  const taxCodes = await readTaxCodes(tx, [...products.values()].map((product) => product.taxCode));
  const lines: PricedLine[] = [];
  const missingTariff: MissingTariff[] = [];
  const missingLot: MissingLot[] = [];

  for (const transfer of transfers) {
    const product = products.get(transfer.productId);
    if (!product) throw domainError('WC_VALIDATION', { product_id: 'Producto desconocido' });
    const tariff = tariffForDate(tariffs, transfer.occurredOn);
    const base = tariff
      ? selectBase(prices, tariff, transfer.productId, transfer.occurredOn, transfer.quantity)
      : null;
    if (!tariff || !base) {
      missingTariff.push({
        productId: product.id,
        productName: product.name,
        occurredOn: transfer.occurredOn,
        reason: tariff ? 'base_price' : 'tariff',
      });
      continue;
    }
    if (product.requiresLot && transfer.lotId === null) {
      missingLot.push({ productId: product.id, productName: product.name, sourceId: transfer.sourceId });
      continue;
    }
    const discount = money.fromString(tariff.discountPct);
    const unitPrice = intercompanyUnitPrice(base.unitPrice, discount);
    const cost = selectCost(costs, product.id, transfer.occurredOn);
    const tax = taxCodes.get(product.taxCode) ?? taxCodes.get('IVA21');
    if (!tax) throw domainError('WC_VALIDATION', { tax_code: 'Código de impuesto desconocido' });
    lines.push({
      sourceTable: transfer.sourceTable,
      sourceId: transfer.sourceId,
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      unit: product.unit,
      requiresLot: product.requiresLot,
      lotId: transfer.lotId,
      lotCode: transfer.lotId ? lots.get(transfer.lotId) ?? null : null,
      nominalVolumeMl: product.nominalVolumeMl,
      quantity: transfer.quantity,
      baseUnitPrice: base.unitPrice,
      discountPct: discount,
      unitPrice,
      unitCost: cost,
      belowCost: cost !== null && unitPrice.lt(cost),
      costUnknown: cost === null,
      occurredAt: transfer.occurredAt,
      occurredOn: transfer.occurredOn,
      documentNumber: transfer.documentNumber,
      tariffId: tariff.id,
      tax,
    });
  }
  return { lines, missingTariff, missingLot };
}

interface ProductInfo {
  id: string;
  sku: string;
  name: string;
  unit: string;
  requiresLot: boolean;
  taxCode: string;
  nominalVolumeMl: number | null;
}

async function loadProducts(tx: Tx, ids: readonly string[]): Promise<Map<string, ProductInfo>> {
  const rows = await tx.read<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    requires_lot: boolean;
    default_tax_code: string | null;
    nominal_volume_ml: number | null;
  }>(`
    SELECT p.id, p.sku, p.name, p.unit, p.requires_lot, p.default_tax_code, f.nominal_volume_ml
    FROM catalog.product p
    LEFT JOIN catalog.format f ON f.id = p.format_id
    WHERE ${uuidIn('p.id', ids)}
  `);
  const map = new Map<string, ProductInfo>();
  for (const row of rows) {
    map.set(uuidText(row.id), {
      id: uuidText(row.id),
      sku: row.sku,
      name: row.name,
      unit: row.unit,
      requiresLot: row.requires_lot === true,
      taxCode: row.default_tax_code ?? 'IVA21',
      nominalVolumeMl: row.nominal_volume_ml == null ? null : Number(row.nominal_volume_ml),
    });
  }
  return map;
}

async function loadLots(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.read<{ id: string; code: string }>(`
    SELECT id, code FROM inventory.lot WHERE ${uuidIn('id', unique)}
  `);
  return new Map(rows.map((row) => [uuidText(row.id), row.code]));
}

interface BaseRow {
  priceListId: string;
  versionId: string;
  validFrom: string;
  validTo: string | null;
  productId: string;
  minQty: Decimal;
  unitPrice: Decimal;
}

async function loadBasePrices(tx: Tx, tariffs: readonly TariffRecord[]): Promise<BaseRow[]> {
  const listIds = [...new Set(tariffs.map((tariff) => tariff.basePriceListId))];
  if (listIds.length === 0) return [];
  const rows = await tx.read<{
    price_list_id: string;
    version_id: string;
    valid_from: string;
    valid_to: string | null;
    product_id: string;
    min_qty: string;
    unit_price: string;
  }>(`
    SELECT v.price_list_id, v.id AS version_id, v.valid_from, v.valid_to,
           i.product_id, i.min_qty, i.unit_price
    FROM catalog.price_list_version v
    JOIN catalog.price_list_item i ON i.version_id = v.id
    WHERE v.status = 'active' AND ${uuidIn('v.price_list_id', listIds)}
  `);
  return rows.map((row) => ({
    priceListId: uuidText(row.price_list_id),
    versionId: uuidText(row.version_id),
    validFrom: dateText(row.valid_from),
    validTo: row.valid_to == null ? null : dateText(row.valid_to),
    productId: uuidText(row.product_id),
    minQty: asDecimal(row.min_qty),
    unitPrice: asDecimal(row.unit_price),
  }));
}

function selectBase(
  rows: readonly BaseRow[],
  tariff: TariffRecord,
  productId: string,
  day: string,
  quantity: Decimal,
): { unitPrice: Decimal } | null {
  const versions = new Map<string, { validFrom: string; validTo: string | null }>();
  for (const row of rows) {
    if (row.priceListId !== tariff.basePriceListId) continue;
    versions.set(row.versionId, { validFrom: row.validFrom, validTo: row.validTo });
  }
  const chosen = [...versions.entries()]
    .filter(([, version]) => coversDate(version.validFrom, version.validTo, day))
    .sort((left, right) => right[1].validFrom.localeCompare(left[1].validFrom))[0];
  if (!chosen) return null;
  const items = rows
    .filter((row) => row.versionId === chosen[0] && row.productId === productId && row.minQty.lte(quantity))
    .sort((left, right) => right.minQty.cmp(left.minQty));
  const item = items[0];
  return item ? { unitPrice: item.unitPrice } : null;
}

interface CostRow {
  productId: string;
  validFrom: string;
  unitCost: Decimal;
}

async function loadCosts(tx: Tx, productIds: readonly string[]): Promise<CostRow[]> {
  const rows = await tx.read<{ product_id: string; valid_from: string; unit_cost: string }>(`
    SELECT product_id, valid_from, unit_cost
    FROM catalog.standard_cost
    WHERE ${uuidIn('product_id', productIds)}
  `);
  return rows.map((row) => ({
    productId: uuidText(row.product_id),
    validFrom: dateText(row.valid_from),
    unitCost: asDecimal(row.unit_cost),
  }));
}

function selectCost(rows: readonly CostRow[], productId: string, day: string): Decimal | null {
  const matches = rows
    .filter((row) => row.productId === productId && row.validFrom <= day)
    .sort((left, right) => right.validFrom.localeCompare(left.validFrom));
  return matches[0]?.unitCost ?? null;
}

export async function readTaxCodes(tx: Tx, codes: readonly string[]): Promise<Map<string, TaxCode>> {
  const unique = [...new Set(codes)];
  if (!unique.includes('IVA21')) unique.push('IVA21');
  return loadTaxCodes(tx, unique);
}

async function loadTaxCodes(tx: Tx, codes: readonly string[]): Promise<Map<string, TaxCode>> {
  for (const code of codes) {
    if (!/^[A-Z0-9_]{2,20}$/.test(code)) {
      throw domainError('WC_VALIDATION', { tax_code: 'Código de impuesto no válido' });
    }
  }
  const list = codes.map((code) => `'${code}'`).join(', ');
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT code, name_es, tax, regime_key, qualification, exemption, rate, surcharge_rate,
           withholding_rate, legal_mention_es, legal_mention_en, requires_vat_id
    FROM billing.tax_code
    WHERE code IN (${list}) AND is_active
  `);
  const map = new Map<string, TaxCode>();
  for (const row of rows) map.set(String(row.code), taxFromRow(row));
  return map;
}

function taxFromRow(row: Record<string, unknown>): TaxCode {
  const qualification = row.qualification == null ? null : String(row.qualification) as Qualification;
  const exemption = row.exemption == null ? null : String(row.exemption) as Exemption;
  return {
    code: String(row.code),
    nameEs: String(row.name_es),
    tax: String(row.tax) as TaxKind,
    regimeKey: String(row.regime_key),
    qualification,
    exemption,
    rate: asDecimal(row.rate),
    surchargeRate: asDecimal(row.surcharge_rate),
    withholdingRate: asDecimal(row.withholding_rate),
    exempt: exemption !== null,
    notSubject: qualification === 'N1' || qualification === 'N2',
    legalMentionEs: row.legal_mention_es == null ? null : String(row.legal_mention_es),
    legalMentionEn: row.legal_mention_en == null ? null : String(row.legal_mention_en),
    requiresVatId: row.requires_vat_id === true,
  };
}
