import type { Env } from '../src/config';
import { loadConfig } from '../src/config';
import type { KbClient } from '../src/core/db/client';
import { openClient } from '../src/core/db/open';
import { sql } from '../src/core/db/sql';
import { businessDate } from '../src/core/time';

const TAX_ID = /^[A-Z0-9]{9}$/;

const IDS = {
  po: '019a0000-0000-7000-8000-000000000001',
  cvpo: '019a0000-0000-7000-8000-000000000002',
  owner: '019a0000-0000-7000-8000-000000000011',
  admin: '019a0000-0000-7000-8000-000000000012',
  advisor: '019a0000-0000-7000-8000-000000000013',
  cellar: '019a0000-0000-7000-8000-000000000014',
  ownerRole: '019a0000-0000-7000-8000-000000000021',
  adminRole: '019a0000-0000-7000-8000-000000000022',
  advisorRole: '019a0000-0000-7000-8000-000000000023',
  cellarRole: '019a0000-0000-7000-8000-000000000024',
} as const;

export interface SeedInput {
  nodeEnv: string;
  poTaxId: string;
  cvpoTaxId: string;
}

export function seedInputFromEnv(env: Env): SeedInput {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  return {
    nodeEnv,
    poTaxId: taxId(env, 'WINECORE_SEED_PO_TAX_ID', '00000000T', nodeEnv),
    cvpoTaxId: taxId(env, 'WINECORE_SEED_CVPO_TAX_ID', 'B00000000', nodeEnv),
  };
}

function taxId(env: Env, name: string, fallback: string, nodeEnv: string): string {
  const raw = env[name]?.trim() ?? '';
  if (raw === '') {
    if (nodeEnv === 'production') throw new Error(`Variable ausente o inválida: ${name}`);
    return fallback;
  }
  const value = raw.toUpperCase();
  if (!TAX_ID.test(value)) throw new Error(`Variable ausente o inválida: ${name}`);
  return value;
}

export async function seed(client: KbClient, input: SeedInput): Promise<void> {
  const statements = [
    'BEGIN TRANSACTION',
    entity(IDS.po, 'PO', 'Productor (P.O)', input.poTaxId, 'natural', 'IRPF'),
    entity(IDS.cvpo, 'CVPO', 'Comercializadora (CVPO)', input.cvpoTaxId, 'legal', 'IS'),
    user(IDS.owner, 'owner@winecore.test', 'Propietario'),
    user(IDS.admin, 'admin@winecore.test', 'Administración'),
    user(IDS.advisor, 'asesor@winecore.test', 'Asesoría'),
    user(IDS.cellar, 'bodega@winecore.test', 'Bodega'),
    role(IDS.ownerRole, IDS.owner, 'owner'),
    role(IDS.adminRole, IDS.admin, 'admin'),
    role(IDS.advisorRole, IDS.advisor, 'advisor'),
    role(IDS.cellarRole, IDS.cellar, 'cellar'),
    ...cellarOperationSeriesStatements(),
    'COMMIT',
  ];
  try {
    await client.query(`${statements.join(';\n')};`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (input.nodeEnv === 'production') {
      throw new Error('No se han podido sembrar los datos iniciales');
    }
    throw error;
  }
}

function entity(
  id: string,
  code: string,
  legalName: string,
  tax: string,
  personType: 'natural' | 'legal',
  incomeTax: 'IRPF' | 'IS',
): string {
  return sql`
    INSERT INTO core.legal_entity (
      id, code, legal_name, tax_id, person_type, income_tax,
      address_line, postal_code, city, province
    )
    SELECT
      CAST(${id} AS UUID), ${code}, ${legalName}, ${tax}, ${personType}, ${incomeTax},
      'Calle Ejemplo 1', '00000', 'Ejemplo', 'Ejemplo'
    WHERE NOT EXISTS (SELECT 1 FROM core.legal_entity WHERE code = ${code})
  `;
}

function user(id: string, email: string, displayName: string): string {
  return sql`
    INSERT INTO core.app_user (id, email, display_name, locale, status)
    SELECT CAST(${id} AS UUID), ${email}, ${displayName}, 'es-ES', 'active'
    WHERE NOT EXISTS (SELECT 1 FROM core.app_user WHERE lower(email) = ${email})
  `;
}

function role(id: string, userId: string, roleCode: string): string {
  return sql`
    INSERT INTO core.user_role (id, user_id, role_code)
    SELECT CAST(${id} AS UUID), CAST(${userId} AS UUID), ${roleCode}
    WHERE NOT EXISTS (
      SELECT 1 FROM core.user_role
      WHERE user_id = CAST(${userId} AS UUID)
        AND role_code = ${roleCode}
        AND legal_entity_id IS NULL
        AND revoked_at IS NULL
    )
  `;
}

/** Default `cellar_operation` series for P.O and CVPO, this year and the next. */
export function cellarOperationSeriesStatements(now = new Date()): string[] {
  const year = Number(businessDate(now).slice(0, 4));
  return [year, year + 1].flatMap((value) => [
    cellarSeries('PO', value),
    cellarSeries('CVPO', value),
  ]);
}

function cellarSeries(entityCode: string, year: number): string {
  const prefix = `OB${String(year).slice(2)}-`;
  return sql`
    INSERT INTO core.number_series (
      id, legal_entity_id, doc_type, code, year, prefix, padding, next_value, is_default, is_active
    )
    SELECT gen_random_uuid(), e.id, 'cellar_operation', 'OB', ${year}, ${prefix}, 4, 1, TRUE, TRUE
    FROM core.legal_entity e
    WHERE e.code = ${entityCode}
      AND NOT EXISTS (
        SELECT 1 FROM core.number_series s
        WHERE s.legal_entity_id = e.id
          AND s.doc_type = 'cellar_operation'
          AND s.year = ${year}
      )
  `;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const client = await openClient(config);
  try {
    await seed(client, seedInputFromEnv(process.env));
    console.log(JSON.stringify({ seeded: true }));
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
