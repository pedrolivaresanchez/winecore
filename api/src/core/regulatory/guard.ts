import { domainError } from "../errors";

const MUTABLE = new Set(["draft", "validated"]);
const CLOSED = new Set(["accepted", "rejected", "accepted_with_errors", "cancelled", "rectified"]);

/** WC120: el payload y su hash no cambian desde la solicitud de aprobación. */
export function assertMutableContent(status: string): void {
  if (!MUTABLE.has(status)) throw domainError("WC120");
}

/**
 * WC121: un envío cerrado no cambia de estado.
 * Aceptado, aceptado con errores o rechazado solo pueden pasar a rectificado.
 */
export function assertStatusChange(from: string, to: string): void {
  if (from === to) return;
  if (!CLOSED.has(from)) return;
  if ((from === "accepted" || from === "rejected" || from === "accepted_with_errors") && to === "rectified") return;
  throw domainError("WC121");
}

export function isMutableStatus(status: string): boolean {
  return MUTABLE.has(status);
}
