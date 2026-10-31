import type { Env } from '../src/config';
import { loadConfig } from '../src/config';
import type { KbClient } from '../src/core/db/client';
import { openClient } from '../src/core/db/open';
import { sql } from '../src/core/db/sql';

const TAX_ID = /^[A-Z0-9]{9}$/;
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
export const PENDING_TAX_ID = 'PENDIENTE';

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
  poName?: string;
  cvpoName?: string;
  ownerEmails?: string[];
  poTaxId: string;
  cvpoTaxId: string;
}

export function seedInputFromEnv(env: Env): SeedInput {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const allowPending = env.WINECORE_SEED_ALLOW_PENDING_TAX_ID === 'true';
  const input: SeedInput = {
    nodeEnv,
    poTaxId: taxId(env, 'WINECORE_SEED_PO_TAX_ID', '00000000T', nodeEnv, allowPending),
    cvpoTaxId: taxId(env, 'WINECORE_SEED_CVPO_TAX_ID', 'B00000000', nodeEnv, allowPending),
  };
  const poName = env.WINECORE_SEED_PO_NAME?.trim();
  const cvpoName = env.WINECORE_SEED_CVPO_NAME?.trim();
  if (poName) input.poName = poName;
  if (cvpoName) input.cvpoName = cvpoName;
  if (nodeEnv === 'production') input.ownerEmails = ownerEmails(env);
  return input;
}

// In production only real people sign in: the owners come from a secret variable, never from the repo.
function ownerEmails(env: Env): string[] {
  const list = (env.WINECORE_BOOTSTRAP_OWNER_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== '');
  if (list.length === 0 || list.some((value) => !EMAIL.test(value))) {
    throw new Error('Variable ausente o inválida: WINECORE_BOOTSTRAP_OWNER_EMAILS');
  }
  return list;
}

function taxId(env: Env, name: string, fallback: string, nodeEnv: string, allowPending: boolean): string {
  const raw = env[name]?.trim() ?? '';
  if (raw === '') {
    if (nodeEnv === 'production') {
      // A tax id nobody has supplied yet is marked, never invented.
      if (allowPending) return PENDING_TAX_ID;
      throw new Error(`Variable ausente o inválida: ${name}`);
    }
    return fallback;
  }
  const value = raw.toUpperCase();
  if (!TAX_ID.test(value)) throw new Error(`Variable ausente o inválida: ${name}`);
  return value;
}

export async function seed(client: KbClient, input: SeedInput): Promise<void> {
  const production = input.nodeEnv === 'production';
  const people = production
    ? (input.ownerEmails ?? []).flatMap(bootstrapOwner)
    : [
        user(IDS.owner, 'owner@winecore.test', 'Propietario'),
        user(IDS.admin, 'admin@winecore.test', 'Administración'),
        user(IDS.advisor, 'asesor@winecore.test', 'Asesoría'),
        user(IDS.cellar, 'bodega@winecore.test', 'Bodega'),
        role(IDS.ownerRole, IDS.owner, 'owner'),
        role(IDS.adminRole, IDS.admin, 'admin'),
        role(IDS.advisorRole, IDS.advisor, 'advisor'),
        role(IDS.cellarRole, IDS.cellar, 'cellar'),
      ];
  const statements = [
    'BEGIN TRANSACTION',
    entity(IDS.po, 'PO', input.poName ?? 'Productor (P.O)', input.poTaxId, 'natural', 'IRPF', production),
    entity(IDS.cvpo, 'CVPO', input.cvpoName ?? 'Comercializadora (CVPO)', input.cvpoTaxId, 'legal', 'IS', production),
    ...people,
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
  production = false,
): string {
  const [line, postal, place] = production ? ['Pendiente', '00000', 'Pendiente'] : ['Calle Ejemplo 1', '00000', 'Ejemplo'];
  return sql`
    INSERT INTO core.legal_entity (
      id, code, legal_name, tax_id, person_type, income_tax,
      address_line, postal_code, city, province
    )
    SELECT
      CAST(${id} AS UUID), ${code}, ${legalName}, ${tax}, ${personType}, ${incomeTax},
      ${line}, ${postal}, ${place}, ${place}
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

function bootstrapOwner(email: string): string[] {
  return [
    sql`
      INSERT INTO core.app_user (id, email, display_name, locale, status)
      SELECT gen_random_uuid(), ${email}, ${email.split('@')[0] ?? email}, 'es-ES', 'active'
      WHERE NOT EXISTS (SELECT 1 FROM core.app_user WHERE lower(email) = ${email})
    `,
    sql`
      INSERT INTO core.user_role (id, user_id, role_code)
      SELECT gen_random_uuid(), u.id, 'owner'
      FROM core.app_user u
      WHERE lower(u.email) = ${email}
        AND NOT EXISTS (
          SELECT 1 FROM core.user_role r
          WHERE r.user_id = u.id AND r.role_code = 'owner' AND r.legal_entity_id IS NULL AND r.revoked_at IS NULL
        )
    `,
  ];
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
