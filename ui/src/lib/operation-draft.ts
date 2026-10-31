import {
  conservation,
  holding,
  litresToMl,
  OP_TYPES,
  type OpType,
  type Vessel,
} from "@/lib/cellar";
import { formatLitres } from "@/lib/format";

export type WizardStep = "tipo" | "origenes" | "destinos" | "mermas" | "revision";

export const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: "tipo", label: "Tipo" },
  { id: "origenes", label: "Orígenes" },
  { id: "destinos", label: "Destinos" },
  { id: "mermas", label: "Merma" },
  { id: "revision", label: "Revisión" },
];

export type LineRole = "input" | "output" | "loss";

export type DraftLine = {
  key: string;
  vessel_code: string;
  lot_id: string;
  lot_code: string;
  volume_text: string;
  qty_text: string;
  nominal_text: string;
  loss_kind: "authorized" | "incident";
  notes: string;
  product_state: "grape" | "must" | "wine" | "packaged_unlabeled" | "packaged_labeled";
};

export type Draft = {
  op_type: OpType | "";
  occurred_at: string;
  reason: string;
  performed_by: string;
  new_lot_code: string;
  inputs: DraftLine[];
  outputs: DraftLine[];
  losses: DraftLine[];
  additive_name: string;
  quantity_text: string;
  quantity_unit: "g" | "kg" | "ml" | "l";
  dose_text: string;
  dose_unit: "g/hl" | "mg/l" | "g/l";
  purpose: "acidification" | "sulphiting" | "cleaning" | "other";
  cleaning_product: string;
  active_substance: string;
  cleaning_qty: string;
  cleaning_unit: "g" | "kg" | "ml" | "l";
  efficacy_check: string;
};

export type Issue = { step: WizardStep; key: string; code: string; message: string };

export type Balance = { ok: boolean; text: string };

export type ActiveField = {
  list: "inputs" | "outputs" | "losses";
  index: number;
  field: "volume_text" | "qty_text" | "nominal_text";
};

const EFFECTS: Record<OpType, { fisico: string; sisv: string; silicie: string }> = {
  racking: {
    fisico: "Sale del depósito de origen y entra en el destino",
    sisv: "Trasiego",
    silicie: "Sin asiento si no cambia el mayor",
  },
  blend: {
    fisico: "Salen los lotes de origen y entra un lote nuevo",
    sisv: "Ensamblaje",
    silicie: "Sin asiento, salvo cambio de clase",
  },
  filtration: {
    fisico: "Sale y vuelve el mismo lote",
    sisv: "Prácticas enológicas",
    silicie: "Sin asiento",
  },
  bottling: {
    fisico: "Baja el granel y suben las botellas",
    sisv: "Envasado",
    silicie: "Asiento de envasado, con la merma si la hay",
  },
  labeling: {
    fisico: "Pasan de sin etiquetar a etiquetadas",
    sisv: "Vinos envasados",
    silicie: "Solo si hay roturas",
  },
  addition: {
    fisico: "No mueve volumen",
    sisv: "Prácticas enológicas",
    silicie: "Sin asiento",
  },
  loss: {
    fisico: "Baja el vino del depósito",
    sisv: "Mermas",
    silicie: "Asiento de merma",
  },
  destruction: {
    fisico: "Baja el vino del depósito cuando se apruebe",
    sisv: "Destrucción",
    silicie: "Asiento de merma cuando se apruebe",
  },
  cleaning: {
    fisico: "No mueve volumen",
    sisv: "Higiene",
    silicie: "Sin asiento",
  },
};

export function readTipo(value: string | null): OpType | "" {
  if (!value) return "";
  return OP_TYPES.some((item) => item.id === value) ? (value as OpType) : "";
}

export function localNow(): string {
  const date = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function emptyLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    vessel_code: "",
    lot_id: "",
    lot_code: "",
    volume_text: "",
    qty_text: "",
    nominal_text: "0,750",
    loss_kind: "authorized",
    notes: "",
    product_state: "wine",
  };
}

export function emptyDraft(op: OpType | "", performedBy: string): Draft {
  return {
    op_type: op,
    occurred_at: localNow(),
    reason: "",
    performed_by: performedBy,
    new_lot_code: "",
    inputs: [emptyLine()],
    outputs: [emptyLine()],
    losses: [emptyLine()],
    additive_name: "",
    quantity_text: "",
    quantity_unit: "g",
    dose_text: "",
    dose_unit: "g/hl",
    purpose: "sulphiting",
    cleaning_product: "",
    active_substance: "",
    cleaning_qty: "",
    cleaning_unit: "ml",
    efficacy_check: "",
  };
}

export function withVessel(line: DraftLine, vessel: Vessel): DraftLine {
  const inside = holding(vessel);
  return {
    ...line,
    vessel_code: vessel.code,
    lot_id: inside?.lot_id ?? "",
    lot_code: inside?.lot_code ?? "",
  };
}

export function nextStep(step: WizardStep): WizardStep {
  const index = WIZARD_STEPS.findIndex((item) => item.id === step);
  return WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, index + 1)]?.id ?? step;
}

export function prevStep(step: WizardStep): WizardStep {
  const index = WIZARD_STEPS.findIndex((item) => item.id === step);
  return WIZARD_STEPS[Math.max(0, index - 1)]?.id ?? step;
}

export function destApplies(op: OpType | ""): boolean {
  return op === "racking" || op === "blend" || op === "filtration" || op === "bottling" || op === "labeling";
}

export function lossApplies(op: OpType | ""): boolean {
  return op === "racking" || op === "blend" || op === "filtration" || op === "bottling" || op === "labeling" || op === "loss" || op === "destruction";
}

export function parseQty(text: string): number {
  const cleaned = text.trim().replace(/\s/g, "").replace(/\./g, "");
  if (!/^\d+$/.test(cleaned)) return 0;
  return Number(cleaned);
}

export function parseDecimal(text: string): number {
  const cleaned = text.trim().replace(/\s/g, "");
  const normalised = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const value = Number(normalised);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function typeInto(current: string, key: string, mode: "decimal" | "integer"): string {
  if (key === "⌫") return current.slice(0, -1);
  if (mode === "integer") {
    if (!/^\d$/.test(key) || current.length >= 7) return current;
    return current + key;
  }
  if (key === ",") {
    if (current.includes(",")) return current;
    return current === "" ? "0," : `${current},`;
  }
  if (!/^\d$/.test(key)) return current;
  if (current.replace(",", "").length >= 9) return current;
  return current + key;
}

export function mlOf(op: OpType, role: LineRole, line: DraftLine): number {
  if (op === "labeling") return 0;
  if (op === "bottling" && role === "output") return parseQty(line.qty_text) * litresToMl(line.nominal_text || "0");
  return litresToMl(line.volume_text);
}

export function qtyOf(op: OpType, role: LineRole, line: DraftLine): number {
  if (op === "labeling") return parseQty(line.qty_text);
  if (op === "bottling" && role === "output") return parseQty(line.qty_text);
  return 0;
}

export function balanceFor(draft: Draft): Balance | null {
  const op = draft.op_type;
  if (!op || op === "cleaning" || op === "addition") return null;
  if (op === "labeling") {
    const inn = draft.inputs.reduce((sum, line) => sum + qtyOf(op, "input", line), 0);
    const out = draft.outputs.reduce((sum, line) => sum + qtyOf(op, "output", line), 0);
    const loss = draft.losses.reduce((sum, line) => sum + qtyOf(op, "loss", line), 0);
    if (inn === 0 && out === 0 && loss === 0) return { ok: false, text: "" };
    const ok = inn > 0 && inn === out + loss;
    return {
      ok,
      text: ok
        ? `Entran ${inn} botellas = salen ${out} + roturas ${loss}`
        : `Las unidades no cuadran: entran ${inn} y salen ${out + loss} (WC020)`,
    };
  }
  const inn = draft.inputs.reduce((sum, line) => sum + mlOf(op, "input", line), 0);
  const out = op === "loss" || op === "destruction" ? 0 : draft.outputs.reduce((sum, line) => sum + mlOf(op, "output", line), 0);
  const loss = draft.losses.reduce((sum, line) => sum + mlOf(op, "loss", line), 0);
  if (inn === 0 && out === 0 && loss === 0) return { ok: false, text: "" };
  const check = conservation(inn, out, loss);
  return { ok: inn > 0 && check.ok, text: check.text };
}

export function needsApproval(draft: Draft): boolean {
  if (draft.op_type === "destruction") return true;
  return draft.losses.some((line) => line.loss_kind === "incident" && (litresToMl(line.volume_text) > 0 || parseQty(line.qty_text) > 0));
}

export function prefillLosses(draft: Draft): Draft {
  if (!lossApplies(draft.op_type)) return draft;
  const source = draft.inputs[0];
  if (!source?.vessel_code || draft.losses[0]?.vessel_code) return draft;
  const current = draft.losses[0] ?? emptyLine();
  const copyVolume = draft.op_type === "loss" || draft.op_type === "destruction";
  return {
    ...draft,
    losses: [
      {
        ...current,
        vessel_code: source.vessel_code,
        lot_id: source.lot_id,
        lot_code: source.lot_code,
        volume_text: copyVolume ? source.volume_text : current.volume_text,
        qty_text: current.qty_text,
        loss_kind: draft.op_type === "destruction" ? "incident" : current.loss_kind,
      },
      ...draft.losses.slice(1),
    ],
  };
}

function materialClass(vessel: Vessel | undefined): "wood" | "bulk" {
  if (vessel?.kind === "barrel" && vessel.material === "oak") return "wood";
  return "bulk";
}

export function silicieNote(draft: Draft, vessels: Vessel[]): string | null {
  if (draft.op_type !== "racking") return null;
  const source = vessels.find((item) => item.code === draft.inputs[0]?.vessel_code);
  const sourceClass = materialClass(source);
  let ml = 0;
  for (const line of draft.outputs) {
    const dest = vessels.find((item) => item.code === line.vessel_code);
    if (!dest || materialClass(dest) === sourceClass) continue;
    ml += mlOf("racking", "output", line);
  }
  if (ml <= 0) return null;
  const entra = sourceClass === "bulk" ? "depósito" : "barrica";
  const sale = sourceClass === "bulk" ? "barrica" : "depósito";
  return `Cambio de mayor SILICIE (A17/A16): ${formatLitres(ml / 1000)} de ${entra} a ${sale}`;
}

export function effectsFor(draft: Draft, vessels: Vessel[]): { fisico: string; sisv: string; silicie: string } | null {
  if (!draft.op_type) return null;
  const base = EFFECTS[draft.op_type];
  const note = silicieNote(draft, vessels);
  if (!note) return base;
  return { ...base, silicie: note };
}

function blameKey(draft: Draft): string | null {
  if (draft.op_type === "loss" || draft.op_type === "destruction") return draft.losses[0]?.key ?? null;
  return draft.outputs[0]?.key ?? draft.losses[0]?.key ?? null;
}

export function problems(draft: Draft, vessels: Vessel[], reveal: boolean): Issue[] {
  const found: Issue[] = [];
  const push = (issue: Issue) => {
    if (found.some((item) => item.key === issue.key && item.message === issue.message)) return;
    found.push(issue);
  };
  const op = draft.op_type;
  if (!op) {
    if (reveal) push({ step: "tipo", key: "tipo", code: "", message: "Elige el tipo de operación" });
    return found;
  }

  const when = new Date(draft.occurred_at);
  if (draft.occurred_at && !Number.isNaN(when.getTime()) && when.getTime() > Date.now() + 60_000) {
    push({ step: "revision", key: "occurred_at", code: "WC021", message: "La fecha no puede ser futura (WC021)" });
  }
  if (reveal && !draft.performed_by.trim()) {
    push({ step: "revision", key: "performed_by", code: "", message: "Indica quién la hace" });
  }

  const sourceNeedsAmount = op !== "cleaning" && op !== "addition";
  draft.inputs.forEach((line) => {
    const vessel = vessels.find((item) => item.code === line.vessel_code);
    if (!line.vessel_code) {
      if (reveal) push({ step: "origenes", key: line.key, code: "", message: "Elige el depósito" });
      return;
    }
    if (vessel && vessel.status !== "in_service") {
      push({ step: "origenes", key: line.key, code: "WC_VESSEL_NOT_IN_SERVICE", message: `${vessel.code} está fuera de servicio` });
    }
    if (!sourceNeedsAmount) return;
    if (op === "labeling") {
      if (reveal && parseQty(line.qty_text) <= 0) push({ step: "origenes", key: line.key, code: "", message: "Indica las botellas" });
      return;
    }
    const ml = litresToMl(line.volume_text);
    if (ml <= 0) {
      if (reveal) push({ step: "origenes", key: line.key, code: "", message: "Indica los litros" });
      return;
    }
    const available = holding(vessel)?.volume_ml ?? 0;
    if (vessel && ml > available) {
      const lot = holding(vessel)?.lot_code ?? "—";
      push({
        step: "origenes",
        key: line.key,
        code: "WC024",
        message: `No hay existencias suficientes del lote ${lot} en ${vessel.code} (WC024)`,
      });
    }
  });

  if (op === "cleaning") {
    if (reveal && !draft.active_substance.trim()) {
      push({ step: "origenes", key: "active_substance", code: "", message: "Indica la sustancia activa" });
    }
    if (reveal && parseDecimal(draft.cleaning_qty) <= 0) {
      push({ step: "origenes", key: "cleaning_qty", code: "", message: "Indica la cantidad" });
    }
    if (reveal && draft.efficacy_check.trim().length < 3) {
      push({ step: "origenes", key: "efficacy_check", code: "", message: "Indica cómo comprobaste la limpieza" });
    }
  }

  if (op === "addition") {
    if (reveal && !draft.additive_name.trim()) {
      push({ step: "origenes", key: "additive_name", code: "", message: "Indica el producto" });
    }
    if (reveal && parseDecimal(draft.quantity_text) <= 0) {
      push({ step: "origenes", key: "quantity_text", code: "", message: "Indica la cantidad" });
    }
    if (reveal && parseDecimal(draft.dose_text) <= 0) {
      push({ step: "origenes", key: "dose_text", code: "", message: "Indica la dosis" });
    }
  }

  if ((op === "blend" || op === "bottling") && reveal && !/^[A-Z0-9][A-Z0-9./-]{1,29}$/.test(draft.new_lot_code.trim())) {
    push({ step: "destinos", key: "new_lot_code", code: "", message: "Indica el código del lote nuevo" });
  }
  if (op === "blend" || op === "bottling") {
    const parents = new Set(draft.inputs.map((line) => line.lot_code).filter(Boolean));
    if (draft.new_lot_code && parents.has(draft.new_lot_code.trim())) {
      push({
        step: "destinos",
        key: "new_lot_code",
        code: "WC030",
        message: "Ese código es un lote de origen: la genealogía tendría un ciclo (WC030)",
      });
    }
  }

  if (destApplies(op)) {
    draft.outputs.forEach((line) => {
      const vessel = vessels.find((item) => item.code === line.vessel_code);
      if (op !== "bottling" && !line.vessel_code) {
        if (reveal) push({ step: "destinos", key: line.key, code: "", message: "Elige el depósito" });
        return;
      }
      if (vessel && vessel.status !== "in_service") {
        push({ step: "destinos", key: line.key, code: "WC_VESSEL_NOT_IN_SERVICE", message: `${vessel.code} está fuera de servicio` });
      }
      if ((op === "racking" || op === "filtration" || op === "labeling") && line.vessel_code && line.vessel_code === draft.inputs[0]?.vessel_code) {
        push({ step: "destinos", key: line.key, code: "", message: "El destino es el mismo depósito" });
      }
      const sourceLot = draft.inputs[0]?.lot_id;
      const inside = holding(vessel);
      if (inside && sourceLot && inside.lot_id !== sourceLot && (op === "racking" || op === "filtration" || op === "labeling")) {
        push({
          step: "destinos",
          key: line.key,
          code: "WC026",
          message: "El depósito contiene otro lote; usa Ensamblaje (WC026)",
        });
      }
      if (vessel && inside && inside.volume_ml > 0 && (op === "blend" || op === "bottling")) {
        push({ step: "destinos", key: line.key, code: "WC026", message: `${vessel.code} contiene otro lote (WC026)` });
      }
      if (op === "labeling" || op === "bottling") {
        if (reveal && parseQty(line.qty_text) <= 0) push({ step: "destinos", key: line.key, code: "", message: "Indica las botellas" });
        if (op === "bottling" && litresToMl(line.nominal_text) <= 0) {
          push({ step: "destinos", key: line.key, code: "", message: "Indica el volumen de la botella" });
        }
      } else if (reveal && litresToMl(line.volume_text) <= 0) {
        push({ step: "destinos", key: line.key, code: "", message: "Indica los litros" });
      }
      if (vessel && op !== "labeling") {
        const incoming = mlOf(op, "output", line);
        const sameLot = Boolean(inside && sourceLot && inside.lot_id === sourceLot);
        const base = !inside || sameLot ? (inside?.volume_ml ?? 0) : 0;
        if (incoming > 0 && (!inside || sameLot) && base + incoming > vessel.capacity_ml) {
          push({ step: "destinos", key: line.key, code: "WC025", message: `No cabe en ${vessel.code}: supera la capacidad (WC025)` });
        }
      }
    });
  }

  if (lossApplies(op)) {
    const incident = op === "destruction" || draft.losses.some((line) => line.loss_kind === "incident");
    if (incident && draft.reason.trim().length < 3 && reveal) {
      push({ step: "mermas", key: "reason", code: "", message: "Indica el motivo" });
    }
  }

  const balance = balanceFor(draft);
  if (balance && !balance.ok) {
    push({
      step: "revision",
      key: blameKey(draft) ?? "balance",
      code: "WC020",
      message: balance.text || "El volumen no cuadra (WC020)",
    });
  }

  return found;
}

export function blocksStep(issues: Issue[], step: WizardStep): boolean {
  return issues.some((issue) => issue.step === step && issue.code !== "WC020");
}

function productState(op: OpType, role: LineRole): DraftLine["product_state"] {
  if (op === "bottling" && role === "output") return "packaged_unlabeled";
  if (op === "labeling" && role === "output") return "packaged_labeled";
  if (op === "labeling") return "packaged_unlabeled";
  return "wine";
}

function toIso(local: string): string {
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

type PayloadLine = {
  role: LineRole;
  lot_id: string | null;
  vessel_id: string | null;
  volume_ml: number;
  qty_units: number;
  mass_g: number;
  loss_kind: "authorized" | "incident" | null;
  product_state: DraftLine["product_state"];
  notes: string | null;
};

export function buildPayload(draft: Draft, vessels: Vessel[], legalEntityId: string) {
  const op = draft.op_type;
  if (!op) throw new Error("Sin tipo");
  const vesselId = (code: string) => vessels.find((item) => item.code === code)?.id ?? null;
  const source = draft.inputs[0];

  const mapLine = (role: LineRole, line: DraftLine): PayloadLine => {
    const fresh = (op === "blend" || op === "bottling") && role === "output";
    const follow = role !== "input" && (op === "racking" || op === "filtration" || op === "labeling");
    const lotId = fresh ? null : follow ? source?.lot_id || null : line.lot_id || null;
    return {
      role,
      lot_id: lotId || null,
      vessel_id: vesselId(line.vessel_code),
      volume_ml: mlOf(op, role, line),
      qty_units: qtyOf(op, role, line),
      mass_g: 0,
      loss_kind: role === "loss" ? (op === "destruction" ? "incident" : line.loss_kind) : null,
      product_state: productState(op, role),
      notes: line.notes.trim() ? line.notes.trim() : null,
    };
  };

  const meaningful = (line: PayloadLine) => line.volume_ml > 0 || line.qty_units > 0;
  let lines: PayloadLine[] = [];
  if (op === "loss" || op === "destruction") {
    lines = draft.losses.map((line) => mapLine("loss", line)).filter(meaningful);
  } else if (op !== "cleaning" && op !== "addition") {
    lines = [
      ...draft.inputs.map((line) => mapLine("input", line)),
      ...draft.outputs.map((line) => mapLine("output", line)),
      ...draft.losses.map((line) => mapLine("loss", line)).filter(meaningful),
    ].filter(meaningful);
  }

  const details: Record<string, string> = {};
  if (draft.new_lot_code.trim()) details.new_lot_code = draft.new_lot_code.trim();
  if (op === "addition" && draft.additive_name.trim()) details.additive_name = draft.additive_name.trim();
  if (op === "cleaning" && draft.cleaning_product.trim()) details.product_name = draft.cleaning_product.trim();

  return {
    legal_entity_id: legalEntityId,
    op_type: op,
    occurred_at: toIso(draft.occurred_at),
    reason: draft.reason.trim() ? draft.reason.trim() : null,
    performed_by: draft.performed_by.trim(),
    created_by: draft.performed_by.trim(),
    details,
    lines,
    ...(op === "cleaning"
      ? {
          cleaning: {
            vessel_id: vesselId(source?.vessel_code ?? ""),
            active_substance: draft.active_substance.trim(),
            quantity: parseDecimal(draft.cleaning_qty),
            quantity_unit: draft.cleaning_unit,
            efficacy_check: draft.efficacy_check.trim(),
          },
        }
      : {}),
    ...(op === "addition"
      ? {
          addition: {
            lot_id: source?.lot_id || null,
            vessel_id: vesselId(source?.vessel_code ?? ""),
            quantity: parseDecimal(draft.quantity_text),
            quantity_unit: draft.quantity_unit,
            dose: parseDecimal(draft.dose_text),
            dose_unit: draft.dose_unit,
            purpose: draft.purpose,
          },
        }
      : {}),
  };
}

export function applyKey(draft: Draft, active: ActiveField, key: string): Draft {
  const lines = draft[active.list];
  const line = lines[active.index];
  if (!line) return draft;
  const mode = active.field === "qty_text" ? "integer" : "decimal";
  const next = typeInto(line[active.field], key, mode);
  return {
    ...draft,
    [active.list]: lines.map((item, index) => (index === active.index ? { ...item, [active.field]: next } : item)),
  };
}
