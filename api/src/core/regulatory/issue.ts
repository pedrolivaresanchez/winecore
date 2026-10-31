/** Incidencia de validación regulatoria. `error` bloquea la aprobación. */
export interface Issue {
  severity: "error" | "warning";
  code: string;
  message: string;
  item_id?: string;
}

export function errorsOf(issues: readonly Issue[]): Issue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function warningsOf(issues: readonly Issue[]): Issue[] {
  return issues.filter((issue) => issue.severity === "warning");
}
