import { newId } from '../../ids';
import { sql } from '../../db/sql';
import type { Tx, Writer } from '../../db/writer';
import { domainError } from '../../errors';
import {
  actorFor,
  auditInsert,
  auditUpdate,
  boolOf,
  countOf,
  intOf,
  invalid,
  isUuid,
  jsonObject,
  oneOf,
  optionalBool,
  optionalText,
  optionalUuid,
  parseLimit,
  readJson,
  requireCode,
  requireText,
  requireUuid,
  slicePage,
  textOf,
  textOrNull,
  type ListBody,
} from './http';

const KINDS = [
  'cellar',
  'cellar_shop',
  'own_warehouse',
  'third_party_warehouse',
  'forwarder',
  'in_transit',
  'customer_virtual',
] as const;

type LocationKind = (typeof KINDS)[number];

const VIRTUAL_KINDS = new Set<LocationKind>(['in_transit', 'customer_virtual']);
const OPERATOR_KINDS = new Set<LocationKind>(['third_party_warehouse', 'forwarder']);

export interface Location {
  id: string;
  code: string;
  name: string;
  kind: string;
  tax_warehouse_id: string | null;
  operator_contact_id: string | null;
  controlling_entity_id: string;
  address: unknown;
  is_virtual: boolean;
  is_active: boolean;
  created_at: string;
}

const COLUMNS = `
  id::VARCHAR AS id, code, name, kind,
  tax_warehouse_id::VARCHAR AS tax_warehouse_id,
  operator_contact_id::VARCHAR AS operator_contact_id,
  controlling_entity_id::VARCHAR AS controlling_entity_id,
  address, is_virtual, is_active, created_at
`;

export async function listLocations(writer: Writer, request: Request): Promise<ListBody<Location>> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = optionalCursor(url.searchParams.get('cursor'));
  const kind = optionalKind(url.searchParams.get('kind'));
  const active = optionalActive(url.searchParams.get('is_active'));
  const filters = ['TRUE'];
  if (kind) filters.push(sql`kind = ${kind}`);
  if (active !== null) filters.push(sql`is_active = ${active}`);
  const where = filters.join(' AND ');
  const page = [...filters];
  if (cursor) page.push(sql`code > ${cursor}`);
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM inventory.location WHERE ${where}`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT ${COLUMNS}
    FROM inventory.location
    WHERE ${page.join(' AND ')}
    ORDER BY code
    LIMIT ${limit + 1}
  `);
  return slicePage(rows.map(locationOf), limit, total, (row) => row.code);
}

export async function getLocation(writer: Writer, _request: Request, code: string): Promise<Location> {
  return locationByCode(writer, code);
}

export async function createLocation(writer: Writer, request: Request): Promise<Location> {
  const body = await readJson(request);
  const draft = parseLocation(body, true);
  const user = actorFor(request, 'alta de ubicación');
  const id = await writer.withWrite(user, async (tx) => {
    await assertAvailable(tx, draft);
    const locationId = newId();
    const row = { id: locationId, ...draft };
    auditInsert(tx, 'inventory.location', locationId, row, sql`
      INSERT INTO inventory.location (
        id, code, name, kind, tax_warehouse_id, operator_contact_id,
        controlling_entity_id, address, is_virtual, is_active
      ) VALUES (
        CAST(${locationId} AS UUID),
        ${draft.code},
        ${draft.name},
        ${draft.kind},
        CAST(${draft.tax_warehouse_id} AS UUID),
        CAST(${draft.operator_contact_id} AS UUID),
        CAST(${draft.controlling_entity_id} AS UUID),
        ${draft.address === null ? null : sql.json(draft.address)},
        ${draft.is_virtual},
        TRUE
      )
    `);
    return draft.code;
  });
  return locationByCode(writer, id);
}

export async function patchLocation(writer: Writer, request: Request, code: string): Promise<Location> {
  const body = await readJson(request);
  const patch = parsePatch(body);
  const user = actorFor(request, 'edición de ubicación');
  await writer.withWrite(user, async (tx) => {
    const current = await locationByCode(tx, code);
    const next = { ...current, ...patch, code: current.code, id: current.id, created_at: current.created_at };
    assertShape(next);
    await assertRefs(tx, next.kind, next.tax_warehouse_id, next.operator_contact_id, next.controlling_entity_id);
    if (next.is_active === false && current.is_active) await assertArchivable(tx, current.id);
    const sets = [
      sql`name = ${next.name}`,
      sql`kind = ${next.kind}`,
      sql`tax_warehouse_id = CAST(${next.tax_warehouse_id} AS UUID)`,
      sql`operator_contact_id = CAST(${next.operator_contact_id} AS UUID)`,
      sql`controlling_entity_id = CAST(${next.controlling_entity_id} AS UUID)`,
      sql`address = ${next.address === null ? null : sql.json(next.address)}`,
      sql`is_virtual = ${next.is_virtual}`,
      sql`is_active = ${next.is_active}`,
    ];
    if (!isUuid(current.id)) throw new Error('Identificador de ubicación no válido');
    auditUpdate(tx, 'inventory.location', current.id, current, next, `
      UPDATE inventory.location
      SET ${sets.join(', ')}
      WHERE id = CAST('${current.id}' AS UUID)
    `);
  });
  return locationByCode(writer, code);
}

export async function archiveLocation(writer: Writer, request: Request, code: string): Promise<Location> {
  const reason = await archiveReason(request);
  const user = actorFor(request, reason);
  await writer.withWrite(user, async (tx) => {
    const current = await locationByCode(tx, code);
    if (!current.is_active) return;
    await assertArchivable(tx, current.id);
    const next = { ...current, is_active: false };
    auditUpdate(tx, 'inventory.location', current.id, current, next, sql`
      UPDATE inventory.location
      SET is_active = FALSE
      WHERE id = CAST(${current.id} AS UUID)
    `);
  });
  return locationByCode(writer, code);
}

interface LocationDraft {
  code: string;
  name: string;
  kind: LocationKind;
  tax_warehouse_id: string | null;
  operator_contact_id: string | null;
  controlling_entity_id: string;
  address: unknown;
  is_virtual: boolean;
}

function parseLocation(body: Record<string, unknown>, creating: boolean): LocationDraft {
  const draft: LocationDraft = {
    code: requireCode(body.code),
    name: requireText(body.name, 'name', 120),
    kind: oneOf(body.kind, 'kind', KINDS),
    tax_warehouse_id: optionalUuid(body.tax_warehouse_id, 'tax_warehouse_id'),
    operator_contact_id: optionalUuid(body.operator_contact_id, 'operator_contact_id'),
    controlling_entity_id: requireUuid(body.controlling_entity_id, 'controlling_entity_id'),
    address: parseAddress(body.address),
    is_virtual: body.is_virtual === undefined ? false : requireBoolFlag(body.is_virtual),
  };
  if (!creating) return draft;
  assertShape(draft);
  return draft;
}

function parsePatch(body: Record<string, unknown>): Partial<LocationDraft> & { is_active?: boolean } {
  const patch: Partial<LocationDraft> & { is_active?: boolean } = {};
  if ('code' in body && body.code !== undefined) invalid({ code: 'El código no se modifica' });
  if ('name' in body) patch.name = requireText(body.name, 'name', 120);
  if ('kind' in body) patch.kind = oneOf(body.kind, 'kind', KINDS);
  if ('tax_warehouse_id' in body) patch.tax_warehouse_id = optionalUuid(body.tax_warehouse_id, 'tax_warehouse_id');
  if ('operator_contact_id' in body) patch.operator_contact_id = optionalUuid(body.operator_contact_id, 'operator_contact_id');
  if ('controlling_entity_id' in body) patch.controlling_entity_id = requireUuid(body.controlling_entity_id, 'controlling_entity_id');
  if ('address' in body) patch.address = parseAddress(body.address);
  if ('is_virtual' in body) patch.is_virtual = requireBoolFlag(body.is_virtual);
  const active = optionalBool(body.is_active, 'is_active');
  if (active !== undefined) patch.is_active = active;
  if (Object.keys(patch).length === 0) invalid({ body: 'No hay cambios' });
  return patch;
}

function assertShape(row: {
  kind: string;
  is_virtual: boolean;
  operator_contact_id: string | null;
}): void {
  const kind = row.kind as LocationKind;
  if (VIRTUAL_KINDS.has(kind) && !row.is_virtual) {
    invalid({ is_virtual: 'Esta ubicación es virtual' });
  }
  if (!VIRTUAL_KINDS.has(kind) && row.is_virtual) {
    invalid({ is_virtual: 'Solo el tránsito y el cliente virtual son ubicaciones virtuales' });
  }
  if (OPERATOR_KINDS.has(kind) && row.operator_contact_id === null) {
    invalid({ operator_contact_id: 'El almacén de un operador logístico exige el contacto del operador' });
  }
}

async function assertAvailable(tx: Tx, draft: LocationDraft): Promise<void> {
  assertShape(draft);
  const existing = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM inventory.location WHERE code = ${draft.code}
  `);
  if (existing.length > 0) invalid({ code: 'Ya existe una ubicación con este código' });
  await assertRefs(tx, draft.kind, draft.tax_warehouse_id, draft.operator_contact_id, draft.controlling_entity_id);
}

async function assertRefs(
  tx: Tx,
  kind: string,
  taxWarehouseId: string | null,
  operatorId: string | null,
  entityId: string,
): Promise<void> {
  const entities = await tx.read(sql`
    SELECT id FROM core.legal_entity
    WHERE id = CAST(${entityId} AS UUID) AND is_active
  `);
  if (entities.length === 0) invalid({ controlling_entity_id: 'La entidad no existe' });
  if (taxWarehouseId !== null) {
    const warehouses = await tx.read(sql`
      SELECT id FROM inventory.tax_warehouse
      WHERE id = CAST(${taxWarehouseId} AS UUID) AND is_active
    `);
    if (warehouses.length === 0) invalid({ tax_warehouse_id: 'El almacén fiscal no existe' });
  }
  if (operatorId !== null) {
    const contacts = await tx.read<{ is_logistics_operator: boolean }>(sql`
      SELECT is_logistics_operator
      FROM party.contact
      WHERE id = CAST(${operatorId} AS UUID) AND archived_at IS NULL
    `);
    const contact = contacts[0];
    if (!contact) invalid({ operator_contact_id: 'El operador no existe' });
    if (OPERATOR_KINDS.has(kind as LocationKind) && contact.is_logistics_operator !== true) {
      invalid({ operator_contact_id: 'El contacto no es un operador logístico' });
    }
  }
}

async function assertArchivable(tx: Tx, locationId: string): Promise<void> {
  const vessels = await tx.read<{ total: unknown }>(sql`
    SELECT count(*)::VARCHAR AS total
    FROM cellar.vessel
    WHERE location_id = CAST(${locationId} AS UUID) AND status <> 'retired'
  `);
  if (intOf(vessels[0]?.total ?? 0) > 0) {
    invalid({ code: 'La ubicación tiene recipientes en servicio' });
  }
  const stock = await tx.read<{ volume_ml: unknown; qty_units: unknown; mass_g: unknown }>(sql`
    SELECT
      coalesce(sum(volume_ml), 0)::VARCHAR AS volume_ml,
      coalesce(sum(qty_units), 0)::VARCHAR AS qty_units,
      coalesce(sum(mass_g), 0)::VARCHAR AS mass_g
    FROM inventory.stock_move
    WHERE location_id = CAST(${locationId} AS UUID)
  `);
  const row = stock[0];
  if (row && (intOf(row.volume_ml) !== 0 || intOf(row.qty_units) !== 0 || intOf(row.mass_g) !== 0)) {
    invalid({ code: 'La ubicación todavía tiene existencias' });
  }
}

async function locationByCode(source: Writer | Tx, code: string): Promise<Location> {
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await source.read<Record<string, unknown>>(sql`
    SELECT
      id::VARCHAR AS id, code, name, kind,
      tax_warehouse_id::VARCHAR AS tax_warehouse_id,
      operator_contact_id::VARCHAR AS operator_contact_id,
      controlling_entity_id::VARCHAR AS controlling_entity_id,
      address, is_virtual, is_active, created_at
    FROM inventory.location
    WHERE code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return locationOf(row);
}

function locationOf(row: Record<string, unknown>): Location {
  return {
    id: textOf(row.id),
    code: textOf(row.code),
    name: textOf(row.name),
    kind: textOf(row.kind),
    tax_warehouse_id: textOrNull(row.tax_warehouse_id),
    operator_contact_id: textOrNull(row.operator_contact_id),
    controlling_entity_id: textOf(row.controlling_entity_id),
    address: jsonObject(row.address),
    is_virtual: boolOf(row.is_virtual),
    is_active: boolOf(row.is_active),
    created_at: textOf(row.created_at),
  };
}

function optionalKind(value: string | null): LocationKind | null {
  if (value === null || value.trim() === '') return null;
  return oneOf(value, 'kind', KINDS);
}

function optionalActive(value: string | null): boolean | null {
  if (value === null || value.trim() === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  invalid({ is_active: 'Debe ser true o false' });
}

function optionalCursor(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return requireCode(value, 'cursor');
}

function requireBoolFlag(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid({ is_virtual: 'Debe ser verdadero o falso' });
  return value;
}

function parseAddress(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) invalid({ address: 'La dirección debe ser un objeto' });
  const json = JSON.stringify(value);
  if (json.length > 4000) invalid({ address: 'La dirección es demasiado grande' });
  return value;
}

async function archiveReason(request: Request): Promise<string> {
  const text = await request.clone().text();
  if (text.trim() === '') return 'archivo de ubicación';
  const body = await readJson(request);
  return optionalText(body.reason, 'reason', 500) ?? 'archivo de ubicación';
}
