import { requestIdFor, sessionOf } from '../../auth/guard';
import { planOperation } from '../cellar/engine';
import { auditInsert, auditUpdate, fromPlan } from '../cellar/service/http';
import { takeCellarOperationNumber } from '../cellar/service/number';
import type { VesselKind, VesselMaterial, VesselState, VesselStatus } from '../cellar/types';
import type { Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { DomainError, domainError } from '../errors';
import { newId } from '../ids';
import { findNegativeBalances } from '../inventory/balances';
import { assertPeriodOpen } from '../inventory/periods';
import type { PeriodLock, StockMove } from '../inventory/types';
import type { IdentityDocumentType } from '../regulatory/silicie/types';
import { businessDate } from '../time';
import { flag, idOf, instantOf, integer, objectOf, text, textOrNull } from './rows';
import { annulPendingEntry, planGrapeEntry, readEntry, type GrapeEntryView } from './silicie-post';
import { parseTicket, ticketView, type StoredTicket, type TicketDraft } from './ticket';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['tank_storage', 'tank_fermenter', 'barrel', 'demijohn', 'ibc', 'other']);
const MATERIALS = new Set(['stainless_steel', 'oak', 'glass', 'concrete', 'plastic', 'other']);
const STATUSES = new Set(['in_service', 'out_of_service', 'retired']);

export interface ReceptionView {
  id: string;
  number: string | null;
  status: string;
  legal_entity_id: string;
  occurred_at: string;
  performed_by: string;
  rectifies_operation_id: string | null;
  reason: string | null;
  ticket: ReturnType<typeof ticketView> | null;
  silicie: GrapeEntryView | null;
}

interface Resolved {
  ticket: StoredTicket;
  warehouseId: string;
  warehouseName: string;
  vessel: VesselState;
  counterparty: { id: string; documentType: IdentityDocumentType; documentNumber: string; legalName: string } | null;
}

export async function listReceptions(writer: Writer): Promise<{ items: ReceptionView[]; total: number }> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, number, status, occurred_at,
           performed_by, rectifies_operation_id::VARCHAR AS rectifies_operation_id, reason, details
    FROM cellar.operation
    WHERE op_type = 'reception'
    ORDER BY occurred_at DESC, id DESC
    LIMIT 200
  `);
  const items: ReceptionView[] = [];
  for (const row of rows) items.push(await viewOf(writer, row));
  return { items, total: items.length };
}

export async function getReception(writer: Writer, id: string): Promise<ReceptionView> {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, number, op_type, status, occurred_at,
           performed_by, rectifies_operation_id::VARCHAR AS rectifies_operation_id, reason, details
    FROM cellar.operation
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row || text(row.op_type) !== 'reception') throw domainError('WC_NOT_FOUND');
  return viewOf(writer, row);
}

export async function createReception(writer: Writer, request: Request): Promise<ReceptionView> {
  const body = await readBody(request);
  const draft = parseTicket(body);
  const header = headerOf(body);
  const actor = actorOf(request, 'borrador de entrada de uva');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    await assertEntity(tx, header.legal_entity_id);
    const resolved = await resolveTicket(tx, draft, header.legal_entity_id, false);
    if (draft.intake.decision !== 'rejected') await assertLotFree(tx, header.legal_entity_id, draft.lot_code);
    const ticket = { ...resolved.ticket, lot_id: null, silicie_entry_id: null };
    auditInsert(tx, 'cellar.operation', id, { id, status: 'draft', op_type: 'reception' }, sql`
      INSERT INTO cellar.operation (
        id, legal_entity_id, op_type, occurred_at, status, details, performed_by, created_by, silicie_relevant
      ) VALUES (
        CAST(${id} AS UUID), CAST(${header.legal_entity_id} AS UUID), 'reception',
        CAST(${draft.weighed_at} AS TIMESTAMPTZ), 'draft', ${sql.json(detailsOf(ticket))},
        ${header.performed_by}, ${actor.id}, FALSE
      )
    `);
  });
  return getReception(writer, id);
}

export async function updateReception(writer: Writer, request: Request, id: string): Promise<ReceptionView> {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const body = await readBody(request);
  const draft = parseTicket(body);
  const header = headerOf(body);
  const actor = actorOf(request, 'edición de entrada de uva');
  await writer.withWrite(actor, async (tx) => {
    const current = await loadOperation(tx, id);
    if (current.status !== 'draft') throw new DomainError('WC031', 409, 'Una entrada confirmada no se modifica');
    await assertEntity(tx, header.legal_entity_id);
    const resolved = await resolveTicket(tx, draft, header.legal_entity_id, false);
    const ticket = { ...resolved.ticket, lot_id: null, silicie_entry_id: null };
    auditUpdate(tx, 'cellar.operation', id, { status: 'draft' }, { status: 'draft' }, sql`
      UPDATE cellar.operation SET
        legal_entity_id = CAST(${header.legal_entity_id} AS UUID),
        occurred_at = CAST(${draft.weighed_at} AS TIMESTAMPTZ),
        performed_by = ${header.performed_by},
        details = ${sql.json(detailsOf(ticket))}
      WHERE id = CAST(${id} AS UUID) AND status = 'draft'
    `);
  });
  return getReception(writer, id);
}

export async function previewReception(writer: Writer, request: Request, id: string) {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const actor = actorOf(request, 'vista previa de entrada de uva');
  return writer.withWrite(actor, async (tx) => {
    const current = await loadOperation(tx, id);
    if (current.status !== 'draft' || current.ticket === null) {
      throw new DomainError('WC032', 409, 'Solo se previsualiza un borrador de entrada de uva');
    }
    const prepared = await prepare(tx, current, actor.id, false);
    return {
      stock_moves: prepared.plan.stockMoves.map((move) => ({
        move_type: move.move_type,
        product_state: move.product_state,
        mass_g: move.mass_g,
        volume_ml: move.volume_ml,
        vessel_id: move.vessel_id,
        location_id: move.location_id,
        lot_id: move.lot_id,
      })),
      lot: prepared.plan.newLots[0] ?? null,
      silicie: prepared.silicie,
    };
  });
}

export async function confirmReception(writer: Writer, request: Request, id: string): Promise<ReceptionView> {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const actor = actorOf(request, 'confirmación de entrada de uva');
  await writer.withWrite(actor, async (tx) => {
    const current = await loadOperation(tx, id);
    if (current.status !== 'draft' || current.ticket === null) {
      throw new DomainError('WC032', 409, 'Solo se confirma un borrador de entrada de uva');
    }
    const prepared = await prepare(tx, current, actor.id, true);
    const rejected = prepared.resolved.ticket.intake.decision === 'rejected';
    const lot = prepared.plan.newLots[0];
    const move = prepared.plan.stockMoves[0];
    if (!rejected && (!lot || !move || prepared.silicie?.id == null)) {
      throw new DomainError('WC_VALIDATION', 422, 'La entrada de uva no ha generado el movimiento de uva');
    }
    const ticket: StoredTicket = {
      ...prepared.resolved.ticket,
      lot_id: lot?.id ?? null,
      silicie_entry_id: prepared.silicie?.id ?? null,
    };
    const confirmedAt = new Date().toISOString();
    auditUpdate(tx, 'cellar.operation', id, { status: 'draft', number: null }, {
      status: 'confirmed',
      number: prepared.number,
      silicie_relevant: !rejected,
    }, sql`
      UPDATE cellar.operation SET
        number = ${prepared.number},
        status = 'confirmed',
        confirmed_by = CAST(${actor.id} AS UUID),
        confirmed_at = CAST(${confirmedAt} AS TIMESTAMPTZ),
        silicie_relevant = ${!rejected},
        details = ${sql.json(detailsOf(ticket))}
      WHERE id = CAST(${id} AS UUID) AND status = 'draft'
    `);
    insertIntake(tx, id, ticket.intake);
    if (rejected || !lot || !move) return;
    auditInsert(tx, 'inventory.lot', lot.id, lot, sql`
      INSERT INTO inventory.lot (
        id, producer_entity_id, code, kind, wine_id, vintage, is_organic, status, origin,
        created_by_operation_id, notes, segregated
      ) VALUES (
        CAST(${lot.id} AS UUID), CAST(${lot.producer_entity_id} AS UUID), ${lot.code}, ${lot.kind},
        NULL, ${lot.vintage}, ${lot.is_organic}, ${lot.status}, ${lot.origin},
        CAST(${lot.created_by_operation_id} AS UUID), ${lot.notes}, ${ticket.intake.decision === 'segregated'}
      )
    `);
    const lineId = newId();
    auditInsert(tx, 'cellar.operation_line', lineId, { id: lineId, mass_g: move.mass_g }, sql`
      INSERT INTO cellar.operation_line (
        id, operation_id, role, lot_id, vessel_id, product_state, volume_ml, qty_units, mass_g, notes
      ) VALUES (
        CAST(${lineId} AS UUID), CAST(${id} AS UUID), 'output', CAST(${lot.id} AS UUID),
        CAST(${move.vessel_id} AS UUID), 'grape', 0, 0, ${move.mass_g}, ${lot.notes}
      )
    `);
    auditInsert(tx, 'inventory.stock_move', move.id, move, sql`
      INSERT INTO inventory.stock_move (
        id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
        product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id,
        source_line_id, reverses_move_id, created_by
      ) VALUES (
        CAST(${move.id} AS UUID), CAST(${move.occurred_at} AS TIMESTAMPTZ), ${move.move_type},
        CAST(${move.location_id} AS UUID), CAST(${move.vessel_id} AS UUID),
        CAST(${move.owner_entity_id} AS UUID), CAST(${move.lot_id} AS UUID), NULL,
        ${move.product_state}, ${move.qty_units}, ${move.volume_ml}, ${move.mass_g}, NULL,
        ${move.source_table}, CAST(${move.source_id} AS UUID), NULL, NULL, ${move.created_by}
      )
    `);
  });
  return getReception(writer, id);
}

export async function rectifyReception(writer: Writer, request: Request, id: string): Promise<ReceptionView> {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const body = await readBody(request);
  const reason = requiredText(body.reason, 'reason', 500);
  const actor = actorOf(request, reason);
  const rectifyId = newId();
  await writer.withWrite(actor, async (tx) => {
    const current = await loadOperation(tx, id);
    if (current.status !== 'confirmed' || current.ticket === null) {
      throw new DomainError('WC032', 409, 'Solo se rectifica una entrada de uva confirmada');
    }
    const locks = await loadLocks(tx);
    assertPeriodOpen(new Date().toISOString(), locks.filter((lock) => lock.ledger === 'physical'));
    const fiscalDate = businessDate(new Date());
    assertPeriodOpen(fiscalDate, locks.filter((lock) => lock.ledger === 'fiscal'));
    const moves = await loadStock(tx, id);
    const occurredAt = new Date().toISOString();
    const reversals: StockMove[] = moves.map((move) => ({
      ...move,
      id: newId(),
      occurred_at: occurredAt,
      move_type: 'reversal',
      qty_units: -move.qty_units,
      volume_ml: -move.volume_ml,
      mass_g: -move.mass_g,
      loss_kind: null,
      source_id: rectifyId,
      source_line_id: null,
      reverses_move_id: move.id ?? null,
      created_by: actor.id,
    }));
    const lotIds = [...new Set(moves.map((move) => move.lot_id).filter((lotId): lotId is string => lotId !== null))];
    const existing = await loadLotStock(tx, lotIds);
    const hit = findNegativeBalances([...existing, ...reversals]).find((finding) => finding.code === 'WC024');
    if (hit) throw new DomainError('WC024', 422, 'La rectificación dejaría el saldo de uva en negativo');
    if (current.ticket.silicie_entry_id) await annulPendingEntry(tx, current.ticket.silicie_entry_id);
    const number = await takeCellarOperationNumber(tx, current.legal_entity_id, fiscalDate);
    const confirmedAt = new Date().toISOString();
    auditInsert(tx, 'cellar.operation', rectifyId, { id: rectifyId, status: 'confirmed', rectifies_operation_id: id }, sql`
      INSERT INTO cellar.operation (
        id, legal_entity_id, number, op_type, occurred_at, status, rectifies_operation_id, reason,
        details, performed_by, confirmed_by, confirmed_at, silicie_relevant, created_by
      ) VALUES (
        CAST(${rectifyId} AS UUID), CAST(${current.legal_entity_id} AS UUID), ${number}, 'reception',
        CAST(${occurredAt} AS TIMESTAMPTZ), 'confirmed', CAST(${id} AS UUID), ${reason},
        ${sql.json({ fiscal_date: fiscalDate, lines: [], grape_reception: null, annuls_silicie_entry_id: current.ticket.silicie_entry_id })},
        ${sessionOf(request).displayName || actor.id}, CAST(${actor.id} AS UUID),
        CAST(${confirmedAt} AS TIMESTAMPTZ), FALSE, ${actor.id}
      )
    `);
    for (const move of reversals) {
      auditInsert(tx, 'inventory.stock_move', move.id ?? rectifyId, move, sql`
        INSERT INTO inventory.stock_move (
          id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
          product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id,
          source_line_id, reverses_move_id, created_by
        ) VALUES (
          CAST(${move.id} AS UUID), CAST(${move.occurred_at} AS TIMESTAMPTZ), ${move.move_type},
          CAST(${move.location_id} AS UUID), CAST(${move.vessel_id} AS UUID),
          CAST(${move.owner_entity_id} AS UUID), CAST(${move.lot_id} AS UUID), NULL,
          ${move.product_state}, ${move.qty_units}, ${move.volume_ml}, ${move.mass_g}, NULL,
          'cellar.operation', CAST(${rectifyId} AS UUID), NULL, CAST(${move.reverses_move_id} AS UUID), ${actor.id}
        )
      `);
    }
    auditUpdate(tx, 'cellar.operation', id, { status: 'confirmed' }, { status: 'rectified' }, sql`
      UPDATE cellar.operation SET status = 'rectified'
      WHERE id = CAST(${id} AS UUID) AND status = 'confirmed'
    `);
  });
  return getReception(writer, rectifyId);
}

async function prepare(tx: Tx, current: Loaded, actorId: string, persist: boolean) {
  if (current.ticket === null) throw domainError('WC_VALIDATION', { details: 'El borrador no es una entrada de uva' });
  const draft = draftFromStored(current.ticket);
  await assertEntity(tx, current.legal_entity_id);
  const rejected = draft.intake.decision === 'rejected';
  const resolved = await resolveTicket(tx, draft, current.legal_entity_id, !rejected);
  if (!rejected) await assertLotFree(tx, current.legal_entity_id, draft.lot_code);
  const locks = await loadLocks(tx);
  assertPeriodOpen(resolved.ticket.weighed_at, locks.filter((lock) => lock.ledger === 'physical'));
  assertPeriodOpen(resolved.ticket.fiscal_date, locks.filter((lock) => lock.ledger === 'fiscal'));
  if (rejected) {
    const number = persist
      ? await takeCellarOperationNumber(tx, current.legal_entity_id, resolved.ticket.fiscal_date)
      : null;
    return {
      plan: { ok: true as const, stockMoves: [], fiscalMoves: [], newLots: [], lotEdges: [], vesselsAfter: [] },
      silicie: null,
      number,
      resolved,
    };
  }
  const notes = lotNotes(resolved.ticket);
  const plan = planOperation({
    id: current.id,
    legal_entity_id: current.legal_entity_id,
    occurred_at: resolved.ticket.weighed_at,
    fiscal_date: resolved.ticket.fiscal_date,
    performed_by: current.performed_by,
    created_by: actorId,
    reason: null,
    approval_request_id: null,
    op_type: 'reception',
    vessel_id: resolved.vessel.id,
    mass_g: resolved.ticket.net_g,
    lot_code: resolved.ticket.lot_code,
    vintage: resolved.ticket.vintage,
    is_organic: resolved.ticket.is_organic,
    notes,
    occupying_lot_id: null,
  }, { vessels: new Map([[resolved.vessel.id, resolved.vessel]]) }, { newId });
  if (!plan.ok) throw fromPlan(plan);
  const existing = await loadLotStock(tx, plan.newLots.map((lot) => lot.id));
  const negative = findNegativeBalances([
    ...existing,
    ...plan.stockMoves.map((move) => ({ ...move, reverses_move_id: null })),
  ]);
  if (negative.length > 0) throw new DomainError('WC024', 422, 'El saldo de uva quedaría en negativo');
  const number = persist
    ? await takeCellarOperationNumber(tx, current.legal_entity_id, resolved.ticket.fiscal_date)
    : null;
  const silicie = await planGrapeEntry(tx, {
    operationId: current.id,
    warehouseId: resolved.warehouseId,
    warehouseName: resolved.warehouseName,
    fiscalDate: resolved.ticket.fiscal_date,
    massG: resolved.ticket.net_g,
    justificationRef: number ?? 'VISTA-PREVIA',
    counterparty: resolved.counterparty,
    persist,
  });
  return { plan, silicie, number, resolved };
}

function draftFromStored(ticket: StoredTicket): TicketDraft {
  return {
    weighed_at: ticket.weighed_at,
    fiscal_date: ticket.fiscal_date,
    variety_code: ticket.variety_code,
    gross_kg: ticket.gross_kg,
    tare_kg: ticket.tare_kg,
    net_kg: ticket.net_kg,
    net_g: ticket.net_g,
    probable_abv: ticket.probable_abv,
    sanitary_status: ticket.sanitary_status,
    is_organic: ticket.is_organic,
    organic_label_checked: ticket.organic_label_checked,
    has_do: ticket.has_do,
    appellation: ticket.appellation,
    accompanying_doc: ticket.accompanying_doc,
    destination_vessel_id: ticket.destination_vessel_id,
    lot_code: ticket.lot_code,
    vintage: ticket.vintage,
    parcels: ticket.source.kind === 'parcels'
      ? ticket.source.lines.map((line) => ({ code: line.parcel_code, kg: line.kg, grams: line.grams }))
      : null,
    grower_contact_id: ticket.source.kind === 'grower' ? ticket.source.contact_id : null,
    intake: ticket.intake,
  };
}

async function resolveTicket(
  tx: Tx,
  draft: TicketDraft,
  legalEntityId: string,
  requireEmptyVessel: boolean,
): Promise<Resolved> {
  const varietyRows = await tx.read(sql`
    SELECT color, is_active FROM vineyard.grape_variety WHERE code = ${draft.variety_code}
  `);
  const variety = varietyRows[0];
  if (!variety) throw domainError('WC_VALIDATION', { variety_code: 'La variedad no está en el catálogo' });
  if (!flag(variety.is_active)) throw domainError('WC_VALIDATION', { variety_code: 'La variedad no está activa' });
  const vessel = await loadDestination(tx, draft.destination_vessel_id, legalEntityId, requireEmptyVessel);
  let counterpartyId: string | null = null;
  let source: StoredTicket['source'];
  if (draft.parcels) {
    const lines = [];
    const suppliers = new Set<string>();
    let own = false;
    for (const line of draft.parcels) {
      const rows = await tx.read<Record<string, unknown>>(sql`
        SELECT p.id::VARCHAR AS id, p.code, p.ownership, p.supplier_contact_id::VARCHAR AS supplier_contact_id,
               p.organic_status, p.appellation, p.is_active, v.variety
        FROM vineyard.parcel p
        LEFT JOIN vineyard.parcel_variety v ON v.parcel_id = p.id AND v.variety = ${draft.variety_code}
        WHERE p.code = ${line.code}
      `);
      const parcel = rows[0];
      if (!parcel) throw domainError('WC_VALIDATION', { parcels: `La parcela ${line.code} no existe` });
      if (!flag(parcel.is_active)) throw domainError('WC_VALIDATION', { parcels: `La parcela ${line.code} no está activa` });
      if (textOrNull(parcel.variety) === null) {
        throw domainError('WC_VALIDATION', { parcels: `La parcela ${line.code} no tiene la variedad ${draft.variety_code}` });
      }
      const organic = text(parcel.organic_status) === 'organic';
      if (organic !== draft.is_organic) {
        throw domainError('WC_VALIDATION', { is_organic: `La parcela ${line.code} no coincide con la marca ecológica` });
      }
      if (draft.has_do && textOrNull(parcel.appellation) !== draft.appellation) {
        throw domainError('WC_VALIDATION', { appellation: `La parcela ${line.code} no está en esa denominación` });
      }
      if (text(parcel.ownership) === 'supplier') {
        const supplier = textOrNull(parcel.supplier_contact_id);
        if (supplier === null) throw domainError('WC_VALIDATION', { parcels: `La parcela ${line.code} no tiene viticultor` });
        suppliers.add(supplier.toLowerCase());
      } else {
        own = true;
      }
      lines.push({
        parcel_id: idOf(parcel.id),
        parcel_code: text(parcel.code),
        kg: line.kg,
        grams: line.grams,
      });
    }
    if (own && suppliers.size > 0) {
      throw domainError('WC_VALIDATION', { parcels: 'No mezcles uva propia y de proveedor en el mismo ticket' });
    }
    if (suppliers.size > 1) throw domainError('WC_VALIDATION', { parcels: 'La entrada mezcla proveedores' });
    counterpartyId = suppliers.values().next().value ?? null;
    source = { kind: 'parcels', lines };
  } else if (draft.grower_contact_id) {
    counterpartyId = draft.grower_contact_id;
    source = { kind: 'grower', contact_id: draft.grower_contact_id };
  } else {
    throw domainError('WC_VALIDATION', { parcels: 'Indica parcelas o un viticultor' });
  }
  if (requireEmptyVessel && draft.is_organic && counterpartyId !== null) {
    await assertCertificate(tx, counterpartyId, draft.fiscal_date);
  }
  const counterparty = counterpartyId === null ? null : await loadCounterparty(tx, counterpartyId);
  return {
    ticket: {
      fiscal_date: draft.fiscal_date,
      weighed_at: draft.weighed_at,
      variety_code: draft.variety_code,
      gross_kg: draft.gross_kg,
      tare_kg: draft.tare_kg,
      net_kg: draft.net_kg,
      net_g: draft.net_g,
      probable_abv: draft.probable_abv,
      sanitary_status: draft.sanitary_status,
      is_organic: draft.is_organic,
      organic_label_checked: draft.organic_label_checked,
      has_do: draft.has_do,
      appellation: draft.appellation,
      accompanying_doc: draft.accompanying_doc,
      destination_vessel_id: draft.destination_vessel_id,
      lot_code: draft.lot_code,
      vintage: draft.vintage,
      source,
      lot_id: null,
      silicie_entry_id: null,
      intake: draft.intake,
    },
    warehouseId: vessel.warehouseId,
    warehouseName: vessel.warehouseName,
    vessel: vessel.state,
    counterparty,
  };
}

async function loadDestination(tx: Tx, vesselId: string, legalEntityId: string, requireEmpty: boolean): Promise<{
  state: VesselState;
  warehouseId: string;
  warehouseName: string;
}> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT v.id::VARCHAR AS id, v.kind, v.material, v.capacity_ml::VARCHAR AS capacity_ml, v.status,
           v.location_id::VARCHAR AS location_id, loc.is_active,
           loc.controlling_entity_id::VARCHAR AS controlling_entity_id,
           loc.tax_warehouse_id::VARCHAR AS tax_warehouse_id, tw.name AS warehouse_name
    FROM cellar.vessel v
    JOIN inventory.location loc ON loc.id = v.location_id
    LEFT JOIN inventory.tax_warehouse tw ON tw.id = loc.tax_warehouse_id
    WHERE v.id = CAST(${vesselId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_VALIDATION', { destination_vessel_id: 'El recipiente no existe' });
  if (!flag(row.is_active)) throw domainError('WC_VALIDATION', { destination_vessel_id: 'La ubicación del recipiente está archivada' });
  const controlling = idOf(row.controlling_entity_id);
  if (controlling !== legalEntityId) {
    throw domainError('WC_VALIDATION', { legal_entity_id: 'La entrada se registra en la entidad que controla la ubicación' });
  }
  const warehouseId = textOrNull(row.tax_warehouse_id);
  if (warehouseId === null) {
    throw domainError('WC_VALIDATION', { destination_vessel_id: 'El recipiente está fuera del perímetro fiscal' });
  }
  const balances = await tx.read(sql`
    SELECT lot_id::VARCHAR AS lot_id
    FROM inventory.stock_move
    WHERE vessel_id = CAST(${vesselId} AS UUID)
    GROUP BY lot_id, product_state, owner_entity_id
    HAVING sum(volume_ml) <> 0 OR sum(qty_units) <> 0 OR sum(mass_g) <> 0
  `);
  if (requireEmpty && balances.length > 0) {
    throw new DomainError('WC026', 422, 'El recipiente ya contiene producto; hay que vaciarlo o elegir otro');
  }
  if (text(row.status) !== 'in_service') throw domainError('WC_VESSEL_NOT_IN_SERVICE');
  const kind = text(row.kind);
  const material = text(row.material);
  const status = text(row.status);
  if (!KINDS.has(kind) || !MATERIALS.has(material) || !STATUSES.has(status)) {
    throw domainError('WC_VALIDATION', { destination_vessel_id: 'El recipiente no es válido' });
  }
  return {
    warehouseId: warehouseId.toLowerCase(),
    warehouseName: textOrNull(row.warehouse_name) ?? '',
    state: {
      id: idOf(row.id),
      kind: kind as VesselKind,
      material: material as VesselMaterial,
      capacity_ml: integer(row.capacity_ml),
      lot_id: null,
      volume_ml: 0,
      owner_entity_id: controlling,
      product_state: null,
      location_id: idOf(row.location_id),
      status: status as VesselStatus,
      tax_warehouse_id: warehouseId.toLowerCase(),
      excise_product_key: null,
    },
  };
}

async function assertCertificate(tx: Tx, contactId: string, fiscalDate: string): Promise<void> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT valid_from::VARCHAR AS valid_from, valid_to::VARCHAR AS valid_to, product_categories
    FROM regulatory.organic_certificate
    WHERE holder_kind = 'supplier' AND contact_id = CAST(${contactId} AS UUID)
      AND valid_from <= CAST(${fiscalDate} AS DATE)
      AND valid_to >= CAST(${fiscalDate} AS DATE)
  `);
  const covered = rows.some((row) => categoriesOf(row.product_categories).includes('a'));
  if (!covered) throw domainError('WC_ECO_CERT_MISSING');
}

async function loadCounterparty(tx: Tx, contactId: string): Promise<{
  id: string;
  documentType: IdentityDocumentType;
  documentNumber: string;
  legalName: string;
}> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, legal_name, tax_id, tax_id_type
    FROM party.contact
    WHERE id = CAST(${contactId} AS UUID) AND archived_at IS NULL
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_VALIDATION', { grower_contact_id: 'El viticultor no existe' });
  const taxType = text(row.tax_id_type);
  const documentType: IdentityDocumentType = taxType === 'nif' || taxType === 'nie'
    ? '1'
    : taxType === 'vat_eu'
      ? '2'
      : taxType === 'passport' || taxType === 'foreign_id'
        ? '3'
        : '1';
  if (documentType === '1' && taxType !== 'nif' && taxType !== 'nie') {
    throw domainError('WC_VALIDATION', { grower_contact_id: 'El viticultor necesita NIF, NIE o documento' });
  }
  const documentNumber = textOrNull(row.tax_id)?.toUpperCase() ?? '';
  const legalName = text(row.legal_name);
  if (documentNumber.length === 0 || documentNumber.length > 15 || /[;"\r\n]/.test(documentNumber)) {
    throw domainError('WC_VALIDATION', { grower_contact_id: 'El documento del viticultor no cabe en el asiento' });
  }
  if (legalName.length > 125 || /[;"\r\n]/.test(legalName)) {
    throw domainError('WC_VALIDATION', { grower_contact_id: 'La razón social no cabe en el asiento' });
  }
  return { id: idOf(row.id), documentType, documentNumber, legalName };
}

async function assertEntity(tx: Tx, entityId: string): Promise<void> {
  const rows = await tx.read(sql`SELECT id FROM core.legal_entity WHERE id = CAST(${entityId} AS UUID) AND is_active`);
  if (rows.length === 0) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });
}

async function assertLotFree(tx: Tx, entityId: string, code: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM inventory.lot
    WHERE producer_entity_id = CAST(${entityId} AS UUID) AND code = ${code}
  `);
  if (rows.length > 0) throw domainError('WC_VALIDATION', { lot_code: 'Ya existe un lote con este código' });
}

async function loadLocks(tx: Tx): Promise<PeriodLock[]> {
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT ledger, locked_until::VARCHAR AS locked_until, locked_by, locked_at, reason
    FROM inventory.period_lock
  `);
  return rows.map((row) => ({
    ledger: text(row.ledger) === 'fiscal' ? 'fiscal' : 'physical',
    locked_until: text(row.locked_until).slice(0, 10),
    locked_by: text(row.locked_by),
    locked_at: instantOf(row.locked_at),
    reason: text(row.reason),
  }));
}

async function loadStock(tx: Tx, operationId: string): Promise<StockMove[]> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, occurred_at, move_type, location_id::VARCHAR AS location_id,
           vessel_id::VARCHAR AS vessel_id, owner_entity_id::VARCHAR AS owner_entity_id,
           lot_id::VARCHAR AS lot_id, product_state, qty_units, volume_ml::VARCHAR AS volume_ml,
           mass_g::VARCHAR AS mass_g, created_by
    FROM inventory.stock_move
    WHERE source_table = 'cellar.operation' AND source_id = CAST(${operationId} AS UUID)
    ORDER BY id
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    occurred_at: instantOf(row.occurred_at),
    move_type: text(row.move_type) as StockMove['move_type'],
    location_id: idOf(row.location_id),
    vessel_id: textOrNull(row.vessel_id)?.toLowerCase() ?? null,
    owner_entity_id: idOf(row.owner_entity_id),
    lot_id: textOrNull(row.lot_id)?.toLowerCase() ?? null,
    product_id: null,
    product_state: text(row.product_state) as StockMove['product_state'],
    qty_units: integer(row.qty_units),
    volume_ml: integer(row.volume_ml),
    mass_g: integer(row.mass_g),
    loss_kind: null,
    source_table: 'cellar.operation',
    source_id: operationId,
    source_line_id: null,
    reverses_move_id: null,
    created_by: text(row.created_by),
  }));
}

async function loadLotStock(tx: Tx, lotIds: string[]): Promise<StockMove[]> {
  if (lotIds.length === 0) return [];
  const list = lotIds.map((lotId) => sql`CAST(${lotId} AS UUID)`).join(', ');
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, occurred_at, move_type, location_id::VARCHAR AS location_id,
           vessel_id::VARCHAR AS vessel_id, owner_entity_id::VARCHAR AS owner_entity_id,
           lot_id::VARCHAR AS lot_id, product_state, qty_units, volume_ml::VARCHAR AS volume_ml,
           mass_g::VARCHAR AS mass_g, created_by
    FROM inventory.stock_move
    WHERE lot_id IN (${list})
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    occurred_at: instantOf(row.occurred_at),
    move_type: text(row.move_type) as StockMove['move_type'],
    location_id: idOf(row.location_id),
    vessel_id: textOrNull(row.vessel_id)?.toLowerCase() ?? null,
    owner_entity_id: idOf(row.owner_entity_id),
    lot_id: textOrNull(row.lot_id)?.toLowerCase() ?? null,
    product_id: null,
    product_state: text(row.product_state) as StockMove['product_state'],
    qty_units: integer(row.qty_units),
    volume_ml: integer(row.volume_ml),
    mass_g: integer(row.mass_g),
    loss_kind: null,
    source_table: 'cellar.operation',
    source_id: idOf(row.id),
    source_line_id: null,
    reverses_move_id: null,
    created_by: text(row.created_by),
  }));
}

interface Loaded {
  id: string;
  status: string;
  legal_entity_id: string;
  performed_by: string;
  ticket: StoredTicket | null;
}

async function loadOperation(tx: Tx, id: string): Promise<Loaded> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, op_type, status,
           performed_by, details
    FROM cellar.operation
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row || text(row.op_type) !== 'reception') throw domainError('WC_NOT_FOUND');
  return {
    id,
    status: text(row.status),
    legal_entity_id: idOf(row.legal_entity_id),
    performed_by: text(row.performed_by),
    ticket: ticketFrom(objectOf(row.details)),
  };
}

function ticketFrom(details: Record<string, unknown> | null): StoredTicket | null {
  if (details === null) return null;
  const ticket = details.grape_reception;
  if (ticket === null || typeof ticket !== 'object' || Array.isArray(ticket)) return null;
  return ticket as StoredTicket;
}

function detailsOf(ticket: StoredTicket) {
  return {
    fiscal_date: ticket.fiscal_date,
    lines: [],
    new_lot: null,
    addition: null,
    cleaning: null,
    grape_reception: ticket,
  };
}

function lotNotes(ticket: StoredTicket): string {
  const place = ticket.source.kind === 'parcels'
    ? `parcelas ${ticket.source.lines.map((line) => line.parcel_code).join(', ')}`
    : 'viticultor externo';
  const segregated = ticket.intake.decision === 'segregated' ? '. Lote segregado: no se ensambla con uno sano' : '';
  return `Variedad ${ticket.variety_code}; ${place}${segregated}`.slice(0, 240);
}

function insertIntake(tx: Tx, operationId: string, intake: StoredTicket['intake']): void {
  auditInsert(tx, 'cellar.grape_intake', operationId, intake, sql`
    INSERT INTO cellar.grape_intake (
      operation_id, container, container_count, container_nominal_kg, weighing, sanitary_state,
      botrytis_pct, storm_damage, overripe, raisined, microbial_notes, decision, grape_temperature_c
    ) VALUES (
      CAST(${operationId} AS UUID), ${intake.container}, ${intake.container_count},
      CAST(${intake.container_nominal_kg} AS DECIMAL(7,2)), ${intake.weighing}, ${intake.sanitary_state},
      CAST(${intake.botrytis_pct} AS DECIMAL(5,2)), ${intake.storm_damage}, ${intake.overripe},
      ${intake.raisined}, ${intake.microbial_notes}, ${intake.decision},
      CAST(${intake.grape_temperature_c} AS DECIMAL(4,1))
    )
  `);
}

async function viewOf(writer: Writer, row: Record<string, unknown>): Promise<ReceptionView> {
  const ticket = ticketFrom(objectOf(row.details));
  const silicie = ticket?.silicie_entry_id ? await readEntry(writer, ticket.silicie_entry_id) : null;
  return {
    id: idOf(row.id),
    number: textOrNull(row.number),
    status: text(row.status),
    legal_entity_id: idOf(row.legal_entity_id),
    occurred_at: instantOf(row.occurred_at),
    performed_by: text(row.performed_by),
    rectifies_operation_id: textOrNull(row.rectifies_operation_id)?.toLowerCase() ?? null,
    reason: textOrNull(row.reason),
    ticket: ticket ? ticketView(ticket) : null,
    silicie,
  };
}

function headerOf(body: Record<string, unknown>): { legal_entity_id: string; performed_by: string } {
  const legal = typeof body.legal_entity_id === 'string' ? body.legal_entity_id.trim().toLowerCase() : '';
  if (!UUID.test(legal)) throw domainError('WC_VALIDATION', { legal_entity_id: 'Debe ser un UUID' });
  return { legal_entity_id: legal, performed_by: requiredText(body.performed_by, 'performed_by', 120) };
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw domainError('WC_VALIDATION', { [field]: `Texto de 1 a ${max} caracteres` });
  }
  return trimmed;
}

function categoriesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed.map((item) => String(item));
      } catch {
        return [];
      }
    }
    return trimmed.replace(/[{}]/g, '').split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  }
  return [];
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.trim() === '') throw domainError('WC_VALIDATION', { body: 'El cuerpo está vacío' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { body: 'El JSON no es válido' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  return parsed as Record<string, unknown>;
}

function actorOf(request: Request, reason: string) {
  const user = sessionOf(request);
  return { type: 'user' as const, id: user.id, requestId: requestIdFor(request), reason };
}
