import { z } from "zod";

import { domainError } from "../../core/errors";
import { defineReadTool } from "../registry";

export const approvalsGetLink = defineReadTool({
  name: "approvals_get_link",
  module: "system",
  scope: "*.read",
  title: "Enlace a la bandeja",
  description: "Enlace a una solicitud en la bandeja de aprobaciones. No aprueba ni rechaza.",
  input: z.object({
    approval_id: z.uuid(),
  }),
  handler: async (ctx, input) => {
    if (!ctx.deps.approvals) {
      throw domainError("WC002", undefined, "Falta el origen de aprobaciones.");
    }
    const view = await ctx.deps.approvals.get(input.approval_id);
    if (!view) {
      throw domainError("WC_VALIDATION", { approval_id: "No encontrada" }, "No existe esa solicitud de aprobación.");
    }
    const origin = (ctx.deps.webBaseUrl ?? "").replace(/\/$/, "");
    return {
      link: `${origin}/aprobaciones/${input.approval_id}`,
      status: view.status,
      summary: view.summary,
    };
  },
});
