import { loadConfig } from '../src/config';
import { sql } from '../src/core/db/sql';
import type { Writer } from '../src/core/db/writer';
import { createWriter } from '../src/core/db/writer';
import { openClient } from '../src/core/db/open';
import { migrate } from './migrate';
import { cellarOperationSeriesStatements } from './seed';
import { generateSynthetic, type SyntheticDataset, type SyntheticScale } from './synthetic';

const UUID_COLUMNS = new Set([
  'id', 'user_id', 'legal_entity_id', 'granted_by', 'contact_id', 'wine_id', 'format_id',
  'product_id', 'price_list_id', 'version_id', 'tax_warehouse_id', 'operator_contact_id',
  'controlling_entity_id', 'location_id', 'producer_entity_id', 'owner_entity_id', 'lot_id',
  'vessel_id', 'source_id', 'merged_into_id', 'created_by_operation_id', 'default_price_list_id',
]);
const TIME_COLUMNS = new Set([
  'created_at', 'updated_at', 'archived_at', 'last_login_at', 'granted_at', 'revoked_at',
  'occurred_at', 'marketing_consent_at', 'vat_id_validated_at', 'activated_at',
]);
const DATE_COLUMNS = new Set(['sepa_mandate_date', 'silicie_since', 'valid_from', 'valid_to']);
const JSON_COLUMNS = new Set(['legacy_refs', 'address']);
const DECIMAL_COLUMNS = new Set(['min_qty', 'unit_price', 'alcohol_pct', 'discount_pct', 'area_ha']);

export async function seedDemo(
  writer: Writer,
  config: { nodeEnv: string; dbMode: string },
  scale: SyntheticScale = 'demo',
): Promise<{ contacts: number }> {
  if (config.nodeEnv === 'production') throw new Error('seed:demo no está permitido cuando NODE_ENV=production');
  if (config.dbMode === 'timbal') throw new Error('seed:demo no está permitido cuando DB_MODE=timbal');
  const data = generateSynthetic({ seed: 2026, scale });
  await writeRows(writer, 'core.legal_entity', data.legal_entity.map(entityRow), 'code');
  const entities = await writer.read<{ id: string; code: string }>('SELECT id, code FROM core.legal_entity');
  const byCode = new Map(entities.map((row) => [row.code, row.id]));
  const entityMap = new Map(data.legal_entity.map((row) => [row.id, byCode.get(row.code) ?? row.id]));
  const remapEntity = (id: string): string => entityMap.get(id) ?? id;

  await writeRows(writer, 'core.app_user', data.app_user.map((row) => ({
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    locale: row.locale,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  })), 'email');
  const users = await writer.read<{ id: string; email: string }>('SELECT id, email FROM core.app_user');
  const byEmail = new Map(users.map((row) => [row.email, row.id]));
  const userMap = new Map(data.app_user.map((row) => [row.id, byEmail.get(row.email) ?? row.id]));
  const remapUser = (id: string | null): string | null => (id == null ? null : userMap.get(id) ?? id);

  await writeRows(writer, 'core.user_role', data.user_role
    .filter((row) => row.role_code !== 'agent' && row.role_code !== 'mcp_client')
    .map((row) => ({
      id: row.id,
      user_id: remapUser(row.user_id),
      role_code: row.role_code,
      legal_entity_id: row.legal_entity_id == null ? null : remapEntity(row.legal_entity_id),
      granted_by: remapUser(row.granted_by),
      granted_at: row.granted_at,
      revoked_at: row.revoked_at,
    })));
  await writeRows(writer, 'party.contact', data.contact.map(contactRow));
  await writeRows(writer, 'party.contact_address', data.contact_address);
  await writeRows(writer, 'party.contact_person', data.contact_person);
  await writeRows(writer, 'catalog.wine', data.wine);
  await writeRows(writer, 'catalog.format', data.format);
  await writeRows(writer, 'catalog.product', data.product);
  await writeRows(writer, 'catalog.price_list', data.price_list);
  await writeRows(writer, 'catalog.price_list_version', data.price_list_version);
  await writeRows(writer, 'catalog.price_list_item', data.price_list_item);
  await writeRows(writer, 'inventory.tax_warehouse', data.tax_warehouse.map((row) => ({
    ...row,
    legal_entity_id: remapEntity(row.legal_entity_id),
  })));
  await writeRows(writer, 'inventory.location', data.location.map((row) => ({
    ...row,
    controlling_entity_id: remapEntity(row.controlling_entity_id),
  })));
  await writeRows(writer, 'cellar.vessel', data.vessel);
  await writeRows(writer, 'inventory.lot', data.lot.map((row) => ({
    ...row,
    producer_entity_id: remapEntity(row.producer_entity_id),
  })));
  await writeRows(writer, 'inventory.stock_move', data.stock_move.map((row) => ({
    ...row,
    owner_entity_id: remapEntity(row.owner_entity_id),
  })));
  await writer.withWrite(
    { type: 'migration', id: 'seed-demo', requestId: 'seed-demo' },
    async (tx) => {
      tx.write(`
        DELETE FROM inventory.stock_move
        WHERE vessel_id = (SELECT id FROM cellar.vessel WHERE code = 'BAR-008')
      `);
      tx.write(`
        UPDATE cellar.vessel
        SET qr_token = 'wcqr_' || qr_token
        WHERE qr_token IS NOT NULL
          AND qr_token NOT LIKE 'wcqr_%'
          AND length('wcqr_' || qr_token) BETWEEN 16 AND 64
      `);
      tx.write(`
        INSERT INTO inventory.fiscal_move (
          id, tax_warehouse_id, fiscal_date, physical_date, move_type, product_class, lot_id,
          volume_ml, units, abv_pct, excise_product_key, justification_type, justification_ref,
          fiscal_trigger, source_table, source_id, created_by
        )
        SELECT
          gen_random_uuid(),
          loc.tax_warehouse_id,
          CAST(m.occurred_at AS DATE),
          CAST(m.occurred_at AS DATE),
          'opening',
          CASE
            WHEN v.kind = 'barrel' OR v.material = 'oak' THEN 'bulk_wood'
            ELSE 'bulk'
          END,
          m.lot_id,
          m.volume_ml,
          0,
          CAST(13.50 AS DECIMAL(5,2)),
          CASE w.color
            WHEN 'white' THEN 'GRANEL-BLANCO'
            WHEN 'rose' THEN 'GRANEL-ROSADO'
            ELSE 'GRANEL-TINTO'
          END,
          'count_record',
          'AFORO-DEMO',
          'count',
          'inventory.lot',
          m.lot_id,
          'seed-demo'
        FROM inventory.stock_move m
        JOIN inventory.location loc ON loc.id = m.location_id
        JOIN inventory.lot l ON l.id = m.lot_id
        LEFT JOIN cellar.vessel v ON v.id = m.vessel_id
        JOIN catalog.wine w ON w.id = l.wine_id
        WHERE m.move_type = 'opening'
          AND l.kind = 'wine'
          AND loc.tax_warehouse_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM inventory.fiscal_move f
            WHERE f.lot_id = m.lot_id AND f.move_type = 'opening'
          )
      `);
      tx.write(`
        INSERT INTO catalog.product (
          id, sku, name, kind, unit, is_stock_tracked, requires_lot, is_active, legacy_refs
        )
        SELECT
          gen_random_uuid(), 'METABI', 'Metabisulfito potásico', 'oenological_product', 'kg',
          TRUE, FALSE, TRUE, '{}'::JSON
        WHERE NOT EXISTS (SELECT 1 FROM catalog.product WHERE sku = 'METABI')
      `);
      for (const statement of cellarOperationSeriesStatements()) tx.write(statement);
    },
  );
  const counted = await writer.read<{ total: number }>('SELECT count(*)::INTEGER AS total FROM party.contact');
  return { contacts: Number(counted[0]?.total ?? 0) };
}

function entityRow(row: SyntheticDataset['legal_entity'][number]) {
  return {
    id: row.id,
    code: row.code,
    legal_name: row.legal_name,
    trade_name: row.trade_name,
    tax_id: row.tax_id,
    person_type: row.person_type,
    income_tax: row.income_tax,
    vat_id: row.vat_id,
    eori: row.eori,
    gln: row.gln,
    gs1_company_prefix: row.gs1_company_prefix,
    registry_data: row.registry_data,
    address_line: row.address_line,
    postal_code: row.postal_code,
    city: row.city,
    province: row.province,
    country_code: row.country_code,
    default_currency: row.default_currency,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function contactRow(row: SyntheticDataset['contact'][number]) {
  return {
    id: row.id,
    kind: row.kind,
    legal_name: row.legal_name,
    trade_name: row.trade_name,
    tax_id: row.tax_id,
    tax_id_type: row.tax_id_type,
    tax_id_country: row.tax_id_country,
    vat_id_validated_at: row.vat_id_validated_at,
    country_code: row.country_code,
    language: row.language,
    currency: row.currency,
    is_customer: row.is_customer,
    is_supplier: row.is_supplier,
    is_carrier: row.is_carrier,
    is_logistics_operator: row.is_logistics_operator,
    vat_regime: row.vat_regime,
    payment_method: row.payment_method,
    payment_terms_days: row.payment_terms_days,
    excise_number: row.excise_number,
    eori: row.eori,
    gln: row.gln,
    include_in_m347: row.include_in_m347,
    marketing_consent: row.marketing_consent,
    marketing_consent_at: row.marketing_consent_at,
    marketing_consent_source: row.marketing_consent_source,
    notes: row.notes,
    merged_into_id: row.merged_into_id,
    archived_at: row.archived_at,
    legacy_refs: row.legacy_refs,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function writeRows(writer: Writer, table: string, rows: readonly object[], key: string = 'id'): Promise<void> {
  const statements = rows.map((row) => insertSql(table, row as Record<string, unknown>, key));
  const size = 80;
  for (let index = 0; index < statements.length; index += size) {
    const slice = statements.slice(index, index + size);
    await writer.withWrite(
      { type: 'migration', id: 'seed-demo', requestId: 'seed-demo' },
      async (tx) => {
        for (const statement of slice) tx.write(statement);
        if (index === 0 && table === 'party.contact') {
          tx.audit({
            table: 'party.contact',
            rowId: null,
            action: 'EVENT',
            before: null,
            after: { seed: 'demo', rows: rows.length },
          });
        }
      },
    );
  }
}

function insertSql(table: string, row: Record<string, unknown>, key: string): string {
  const columns = Object.keys(row);
  const values = columns.map((column) => sqlValue(column, row[column]));
  const keyValue = sqlValue(key, row[key]);
  return `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${values.join(', ')} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${key} = ${keyValue})`;
}

function sqlValue(column: string, value: unknown): string {
  if (value == null) return 'NULL';
  if (UUID_COLUMNS.has(column) && typeof value === 'string') return sql`CAST(${value} AS UUID)`;
  if (JSON_COLUMNS.has(column)) return sql`${sql.json(value)}`;
  if (DATE_COLUMNS.has(column) && typeof value === 'string') return sql`CAST(${value} AS DATE)`;
  if (TIME_COLUMNS.has(column) && typeof value === 'string') return sql`CAST(${value} AS TIMESTAMPTZ)`;
  if (DECIMAL_COLUMNS.has(column) && typeof value === 'string') return sql`CAST(${value} AS DECIMAL)`;
  return sql`${value}`;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const client = await openClient(config);
  try {
    if (config.dbMode === 'local') await migrate(client);
    const writer = createWriter(client);
    await writer.tryAcquireLease();
    try {
      const result = await seedDemo(writer, config);
      console.log(JSON.stringify({ seeded: true, ...result }));
    } finally {
      await writer.read(sql`
        UPDATE core.writer_lease
        SET expires_at = TIMESTAMPTZ '1970-01-01 00:00:00+00'
        WHERE holder = ${writer.instanceId}
      `);
    }
  } finally {
    await client.close?.();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Error interno');
    process.exit(1);
  });
}
