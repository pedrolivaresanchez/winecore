import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { eventSpec } from './catalogue';
import { assertEventPayload } from './payload';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGGREGATE = /^[a-z_]+(\.[a-z_]+)+$/;

export interface EmitEventInput {
  type: string;
  aggregate: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/** Encola el INSERT del outbox en la misma escritura atómica que el cambio de negocio. */
export function emitEvent(tx: Tx, input: EmitEventInput): void {
  if (!eventSpec(input.type)) {
    throw domainError('WC_VALIDATION', { type: 'Tipo de evento desconocido' });
  }
  if (!AGGREGATE.test(input.aggregate)) {
    throw domainError('WC_VALIDATION', { aggregate: 'Agregado no válido' });
  }
  if (typeof input.aggregateId !== 'string' || !UUID.test(input.aggregateId)) {
    throw domainError('WC_VALIDATION', { aggregateId: 'Identificador no válido' });
  }
  if (!isPlainObject(input.payload)) {
    throw domainError('WC_VALIDATION', { payload: 'El cuerpo del evento debe ser un objeto' });
  }
  assertEventPayload(input.payload);
  const legalEntityId = legalEntityOf(input.payload);
  tx.write(sql`
    INSERT INTO ops.outbox_event (
      event_type, aggregate_table, aggregate_id, legal_entity_id, payload
    ) VALUES (
      ${input.type},
      ${input.aggregate},
      CAST(${input.aggregateId} AS UUID),
      CAST(${legalEntityId} AS UUID),
      ${sql.json(input.payload)}
    )
  `);
}

function legalEntityOf(payload: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(payload, 'legal_entity_id')) return null;
  const value = payload.legal_entity_id;
  if (value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw domainError('WC_VALIDATION', { legal_entity_id: 'Identificador no válido' });
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
