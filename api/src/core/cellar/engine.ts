import { fail } from "./common";
import { planAddition } from "./ops/addition";
import { planBlend } from "./ops/blend";
import { planBottling } from "./ops/bottling";
import { planCleaning } from "./ops/cleaning";
import { planLoss } from "./ops/loss";
import { planTransfer } from "./ops/transfer";
import type { CellarState, IdSource, OperationRequest, PlanResult } from "./types";

/**
 * Plans the records a confirmed cellar operation must persist.
 * The caller supplies vessel state and fresh ids. Nothing here is written,
 * and the clock is never read: `occurred_at` and `fiscal_date` come from
 * the request.
 */
export function planOperation(
  req: OperationRequest,
  state: CellarState,
  ids: IdSource,
): PlanResult {
  if (req === null || typeof req !== "object" || !("op_type" in req)) {
    return fail("WC_VALIDATION", "WC_VALIDATION: la operación no es válida.", { field: "op_type" });
  }
  switch (req.op_type) {
    case "racking":
      return planTransfer(req, state, ids);
    case "blend":
      return planBlend(req, state, ids);
    case "addition":
      return planAddition(req, state, ids);
    case "bottling":
      return planBottling(req, state, ids);
    case "loss":
    case "destruction":
      return planLoss(req, state, ids);
    case "cleaning":
      return planCleaning(req, state, ids);
    default: {
      const unknown: never = req;
      return fail("WC_VALIDATION", "WC_VALIDATION: el tipo de operación no está soportado.", {
        op_type: (unknown as { op_type?: unknown }).op_type,
      });
    }
  }
}
