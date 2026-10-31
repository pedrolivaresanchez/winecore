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
      for (const statement of syntheticParcelStatements()) tx.write(statement);
      for (const statement of planLayoutStatements()) tx.write(statement);
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

const UNPLACED = `('INOX-002', 'INOX-012', 'FERM-006', 'BAR-002', 'DAM-002')`;

/** Nave, sala de barricas y exterior. Unos pocos recipientes y un nicho quedan sin colocar. */
function planLayoutStatements(): string[] {
  return [
    zoneSql('ELAB', 'Nave de elaboración', 'elaboration'),
    zoneSql('SALA', 'Sala de barricas', 'barrel_room'),
    zoneSql('EXT', 'Exterior', 'outdoor'),
    zoneSql('BOT', 'Almacén de botellas', 'bottle_store'),
    sql`
      INSERT INTO cellar.holder (
        id, location_id, code, kind, name, cage_number, capacity_units, nominal_volume_ml, format_code
      )
      SELECT gen_random_uuid(), loc.id, 'JAUL-01', 'jaulon', 'Jaulón 1', 1, 600, 750, 'B075'
      FROM inventory.location loc
      WHERE loc.code = 'BOD'
        AND NOT EXISTS (SELECT 1 FROM cellar.holder WHERE code = 'JAUL-01')
    `,
    sql`
      INSERT INTO cellar.holder (id, location_id, code, kind, name, capacity_units)
      SELECT gen_random_uuid(), loc.id, 'NICH-01', 'nicho', 'Nicho 1', 120
      FROM inventory.location loc
      WHERE loc.code = 'BOD'
        AND NOT EXISTS (SELECT 1 FROM cellar.holder WHERE code = 'NICH-01')
    `,
    placeVesselsSql(
      'ELAB',
      `v.kind IN ('tank_storage', 'tank_fermenter', 'ibc')`,
      `CASE v.kind WHEN 'tank_fermenter' THEN 0 WHEN 'tank_storage' THEN 1 ELSE 2 END, v.code`,
      6,
      156,
      136,
      `CASE ranked.kind WHEN 'tank_fermenter' THEN 108 WHEN 'ibc' THEN 96 ELSE 136 END`,
      `CASE ranked.kind WHEN 'tank_fermenter' THEN 118 WHEN 'ibc' THEN 96 ELSE 88 END`,
    ),
    placeVesselsSql(
      'SALA',
      `v.kind = 'barrel'`,
      'v.code',
      4,
      128,
      88,
      '108',
      '64',
    ),
    placeVesselsSql(
      'EXT',
      `v.kind = 'demijohn'`,
      'v.code',
      4,
      112,
      112,
      '92',
      '92',
    ),
    sql`
      INSERT INTO cellar.plan_position (id, zone_id, holder_id, x, y, width, height, rotation)
      SELECT gen_random_uuid(), z.id, h.id, 36, 36, 168, 104, 0
      FROM cellar.holder h
      JOIN cellar.zone z ON z.code = 'BOT' AND z.location_id = h.location_id
      WHERE h.code = 'JAUL-01'
        AND NOT EXISTS (SELECT 1 FROM cellar.plan_position p WHERE p.holder_id = h.id)
    `,
    sql`
      INSERT INTO cellar.operation (
        id, legal_entity_id, number, op_type, occurred_at, status, confirmed_at, performed_by, created_by, reason
      )
      SELECT
        gen_random_uuid(), e.id, 'OB26-PLANO', 'racking',
        CAST('2026-09-12T08:30:00Z' AS TIMESTAMPTZ), 'confirmed',
        CAST('2026-09-12T08:35:00Z' AS TIMESTAMPTZ), 'Bodega', 'seed-demo', 'seed-plano'
      FROM core.legal_entity e
      WHERE e.code = 'PO'
        AND EXISTS (SELECT 1 FROM cellar.vessel WHERE code = 'INOX-001')
        AND NOT EXISTS (SELECT 1 FROM cellar.operation WHERE number = 'OB26-PLANO')
    `,
    sql`
      INSERT INTO cellar.operation_line (id, operation_id, role, lot_id, vessel_id, product_state, volume_ml)
      SELECT gen_random_uuid(), o.id, 'output', m.lot_id, v.id, 'wine', 1000
      FROM cellar.operation o
      JOIN cellar.vessel v ON v.code = 'INOX-001'
      JOIN inventory.stock_move m ON m.vessel_id = v.id AND m.volume_ml > 0
      WHERE o.number = 'OB26-PLANO'
        AND NOT EXISTS (SELECT 1 FROM cellar.operation_line l WHERE l.operation_id = o.id)
      LIMIT 1
    `,
    sql`
      INSERT INTO cellar.analysis (id, lot_id, vessel_id, kind, sampled_at, lab, created_by, notes)
      SELECT
        gen_random_uuid(), m.lot_id, v.id, 'control',
        CAST('2026-09-10T07:00:00Z' AS TIMESTAMPTZ), 'internal', 'seed-demo', 'seed-plano'
      FROM cellar.vessel v
      JOIN inventory.stock_move m ON m.vessel_id = v.id AND m.volume_ml > 0
      WHERE v.code = 'INOX-001'
        AND NOT EXISTS (
          SELECT 1 FROM cellar.analysis a WHERE a.vessel_id = v.id AND a.notes = 'seed-plano'
        )
      LIMIT 1
    `,
    ...([
      ['ph', '3.4500'],
      ['free_so2', '28.0000'],
      ['abv', '13.8000'],
    ] as const).map(([code, value]) => sql`
      INSERT INTO cellar.analysis_result (id, analysis_id, parameter_code, value)
      SELECT gen_random_uuid(), a.id, ${code}, CAST(${value} AS DECIMAL(12,4))
      FROM cellar.analysis a
      JOIN cellar.vessel v ON v.id = a.vessel_id AND v.code = 'INOX-001'
      WHERE a.notes = 'seed-plano'
        AND NOT EXISTS (
          SELECT 1 FROM cellar.analysis_result r
          WHERE r.analysis_id = a.id AND r.parameter_code = ${code}
        )
    `),
  ];
}

function zoneSql(code: string, name: string, kind: string): string {
  return sql`
    INSERT INTO cellar.zone (id, location_id, code, name, kind, is_active)
    SELECT gen_random_uuid(), loc.id, ${code}, ${name}, ${kind}, TRUE
    FROM inventory.location loc
    WHERE loc.code = 'BOD'
      AND NOT EXISTS (SELECT 1 FROM cellar.zone WHERE code = ${code})
  `;
}

function placeVesselsSql(
  zoneCode: string,
  whereKind: string,
  orderBy: string,
  columns: number,
  pitchX: number,
  pitchY: number,
  widthSql: string,
  heightSql: string,
): string {
  return `
    INSERT INTO cellar.plan_position (id, zone_id, vessel_id, x, y, width, height, rotation)
    SELECT
      gen_random_uuid(),
      z.id,
      ranked.id,
      28 + ((ranked.n - 1) % ${columns}) * ${pitchX},
      28 + CAST(floor((ranked.n - 1) / ${columns}.0) AS INTEGER) * ${pitchY},
      ${widthSql},
      ${heightSql},
      0
    FROM (
      SELECT v.id, v.kind, row_number() OVER (ORDER BY ${orderBy}) AS n
      FROM cellar.vessel v
      JOIN inventory.location loc ON loc.id = v.location_id AND loc.code = 'BOD'
      WHERE ${whereKind}
        AND v.code NOT IN ${UNPLACED}
        AND NOT EXISTS (SELECT 1 FROM cellar.plan_position p WHERE p.vessel_id = v.id)
    ) ranked
    JOIN cellar.zone z ON z.code = '${zoneCode}' AND z.location_id = (SELECT id FROM inventory.location WHERE code = 'BOD')
  `;
}

function syntheticParcelStatements(): string[] {
  return [
    sql`
      INSERT INTO vineyard.grape_variety (code, name, color)
      SELECT 'BOBAL', 'Bobal', 'red'
      WHERE NOT EXISTS (SELECT 1 FROM vineyard.grape_variety WHERE code = 'BOBAL')
    `,
    sql`
      INSERT INTO vineyard.grape_variety (code, name, color)
      SELECT 'TEMPRANILLO', 'Tempranillo', 'red'
      WHERE NOT EXISTS (SELECT 1 FROM vineyard.grape_variety WHERE code = 'TEMPRANILLO')
    `,
    sql`
      INSERT INTO vineyard.parcel (
        code, name, ownership,
        sigpac_province, sigpac_municipality, sigpac_aggregate, sigpac_zone,
        sigpac_polygon, sigpac_parcel, sigpac_enclosure,
        area_ha, is_organic, organic_since, organic_status
      )
      SELECT 'P-07', 'Pago Norte', 'own',
        23, 50, 0, 0, 7, 7, 1,
        CAST('0.8400' AS DECIMAL(8,4)), TRUE, CAST('2019-01-01' AS DATE), 'organic'
      WHERE NOT EXISTS (SELECT 1 FROM vineyard.parcel WHERE code = 'P-07')
    `,
    sql`
      INSERT INTO vineyard.parcel (
        code, name, ownership,
        sigpac_province, sigpac_municipality, sigpac_aggregate, sigpac_zone,
        sigpac_polygon, sigpac_parcel, sigpac_enclosure,
        area_ha, is_organic, organic_status
      )
      SELECT 'P-08', 'Pago Sur', 'own',
        23, 50, 0, 0, 8, 8, 1,
        CAST('1.2500' AS DECIMAL(8,4)), FALSE, 'conventional'
      WHERE NOT EXISTS (SELECT 1 FROM vineyard.parcel WHERE code = 'P-08')
    `,
    sql`
      INSERT INTO vineyard.parcel_variety (parcel_id, variety, color, area_ha, planting_year)
      SELECT p.id, 'BOBAL', 'red', CAST('0.8400' AS DECIMAL(8,4)), 2004
      FROM vineyard.parcel p
      WHERE p.code = 'P-07'
        AND NOT EXISTS (
          SELECT 1 FROM vineyard.parcel_variety v WHERE v.parcel_id = p.id AND v.variety = 'BOBAL'
        )
    `,
    sql`
      INSERT INTO vineyard.parcel_variety (parcel_id, variety, color, area_ha, planting_year)
      SELECT p.id, 'TEMPRANILLO', 'red', CAST('1.2500' AS DECIMAL(8,4)), 2011
      FROM vineyard.parcel p
      WHERE p.code = 'P-08'
        AND NOT EXISTS (
          SELECT 1 FROM vineyard.parcel_variety v WHERE v.parcel_id = p.id AND v.variety = 'TEMPRANILLO'
        )
    `,
  ];
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
