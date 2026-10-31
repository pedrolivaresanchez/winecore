import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { remittanceApprovalDenied, type RemittanceApproval } from './approval';

export type { RemittanceApproval, RemittanceApprovalDecision, RemittanceApprovalInput } from './approval';

interface Binding {
  dataKey: Uint8Array | null;
  approval: RemittanceApproval | null;
}

const bindings = new WeakMap<Writer, Binding>();
let processApproval: RemittanceApproval = remittanceApprovalDenied;

export function bindFinance(
  writer: Writer,
  patch: { dataKey?: Uint8Array | null; approval?: RemittanceApproval | null },
): void {
  const prev = bindings.get(writer);
  bindings.set(writer, {
    dataKey: patch.dataKey !== undefined ? patch.dataKey : prev?.dataKey ?? null,
    approval: patch.approval !== undefined ? patch.approval : prev?.approval ?? null,
  });
}

/** Lo llama el integrador cuando el módulo de aprobaciones esté cableado. */
export function setRemittanceApproval(approval: RemittanceApproval): void {
  processApproval = approval;
}

export function approvalFor(writer: Writer): RemittanceApproval {
  return bindings.get(writer)?.approval ?? processApproval;
}

export function dataKeyFor(writer: Writer): Uint8Array | null {
  return bindings.get(writer)?.dataKey ?? null;
}

export function requireDataKey(writer: Writer): Uint8Array {
  const key = dataKeyFor(writer);
  if (!key) {
    throw domainError('WC_VALIDATION', { data_key: 'Falta WINECORE_DATA_KEY para cifrar el IBAN' });
  }
  return key;
}
