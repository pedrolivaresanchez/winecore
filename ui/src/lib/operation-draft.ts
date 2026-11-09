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
  child_lot_code: string;
  product_state: "grape" | "must" | "wine" | "packaged_unlabeled" | "packaged_labeled";
  location_id: string;
  product_id: string;
  owner_entity_id: string;
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
  previous_setpoint: string;
  new_setpoint: string;
  started_at: string;
  ended_at: string;
  process_notes: string;
  product_id: string;
  pack_state: "packaged_unlabeled" | "packaged_labeled";
  location_id: string;
  additive_product_id: string;
  organic_approved: boolean;
  cleaning_product_id: string;
  mass_text: string;
  vintage_text: string;
  is_organic: boolean;
  sample_code: string;
  intake_state: "must" | "wine";
  excise_product_key: string;
  nc_code: string;
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
  bleeding: {
    fisico: "Sale parte del lote y entra un lote hijo",
    sisv: "Sangrado",
    silicie: "Sin asiento",
  },
  pressing_off: {
    fisico: "Sale el vino del depósito con hollejos",
    sisv: "Descube",
    silicie: "Sin asiento",
  },
  delestage: {
    fisico: "No mueve volumen",
    sisv: "Délestage",
    silicie: "Sin asiento",
  },
  temperature_control: {
    fisico: "No mueve volumen",
    sisv: "Consigna de temperatura",
    silicie: "Sin asiento",
  },
  reception: {
    fisico: "Entran kilos de uva al depósito",
    sisv: "Entrada de uva",
    silicie: "Asiento de entrada de uva",
  },
  bulk_reception: {
    fisico: "Entra mosto o vino a un depósito vacío",
    sisv: "Entrada a granel",
    silicie: "Asiento de recepción si es vino",
  },
  sampling: {
    fisico: "No mueve volumen",
    sisv: "Toma de muestras",
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
    child_lot_code: "",
    product_state: "wine",
    location_id: "",
    product_id: "",
    owner_entity_id: "",
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
    previous_setpoint: "",
    new_setpoint: "",
    started_at: localNow(),
    ended_at: localNow(),
    process_notes: "",
    product_id: "",
    pack_state: "packaged_unlabeled",
    location_id: "",
    additive_product_id: "",
    organic_approved: true,
    cleaning_product_id: "",
    mass_text: "",
    vintage_text: String(new Date().getFullYear()),
    is_organic: true,
    sample_code: "",
    intake_state: "wine",
    excise_product_key: "",
    nc_code: "",
  };
}

const PRODUCT_STATES = ["grape", "must", "wine", "packaged_unlabeled", "packaged_labeled"] as const;

function asProductState(value: string | null | undefined): DraftLine["product_state"] | null {
  if (!value) return null;
  return (PRODUCT_STATES as readonly string[]).includes(value) ? (value as DraftLine["product_state"]) : null;
}

export function withVessel(line: DraftLine, vessel: Vessel): DraftLine {
  const inside = holding(vessel);
  return {
    ...line,
    vessel_code: vessel.code,
    lot_id: inside?.lot_id ?? "",
    lot_code: inside?.lot_code ?? "",
    product_state: asProductState(vessel.product_state) ?? line.product_state,
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
  return op === "racking" || op === "blend" || op === "filtration" || op === "bottling" || op === "labeling" || op === "bleeding" || op === "pressing_off";
}

export function lossApplies(op: OpType | ""): boolean {
  return op === "racking" || op === "blend" || op === "filtration" || op === "bottling" || op === "labeling" || op === "loss" || op === "destruction" || op === "bleeding" || op === "pressing_off";
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
  if (op === "labeling") return parseQty(line.qty_text) * litresToMl(line.nominal_text || "0");
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
  if (!op || op === "cleaning" || op === "addition" || op === "delestage" || op === "temperature_control" || op === "sampling" || op === "reception" || op === "bulk_reception") return null;
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
  if (draft.op_type === "labeling" && source?.lot_id) {
    const inn = parseQty(source.qty_text);
    const out = draft.outputs.reduce((sum, line) => sum + parseQty(line.qty_text), 0);
    const broken = Math.max(0, inn - out);
    const current = draft.losses[0] ?? emptyLine();
    if (current.qty_text) return draft;
    return {
      ...draft,
      losses: [{
        ...current,
        lot_id: source.lot_id,
        lot_code: source.lot_code,
        location_id: source.location_id,
        product_id: source.product_id,
        owner_entity_id: source.owner_entity_id,
        nominal_text: source.nominal_text,
        qty_text: broken > 0 ? String(broken) : "",
        product_state: "packaged_unlabeled",
      }, ...draft.losses.slice(1)],
    };
  }
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
  if (draft.op_type !== "racking" && draft.op_type !== "filtration") return null;
  const source = vessels.find((item) => item.code === draft.inputs[0]?.vessel_code);
  const sourceClass = materialClass(source);
  let ml = 0;
  for (const line of draft.outputs) {
    const dest = vessels.find((item) => item.code === line.vessel_code);
    if (!dest || materialClass(dest) === sourceClass) continue;
    ml += mlOf(draft.op_type, "output", line);
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

function parseSetpoint(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < -30 || value > 40) return null;
  return value;
}

function setpointPayload(text: string): string {
  const value = parseSetpoint(text);
  return value === null ? text.trim() : value.toFixed(1);
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

  const sourceNeedsAmount = op !== "cleaning" && op !== "addition" && op !== "delestage" && op !== "temperature_control" && op !== "sampling" && op !== "reception" && op !== "bulk_reception" && op !== "labeling";
  draft.inputs.forEach((line) => {
    if (op === "labeling") {
      if (reveal && !line.lot_id) push({ step: "origenes", key: line.key, code: "", message: "Elige el vino sin etiquetar" });
      if (reveal && parseQty(line.qty_text) <= 0) push({ step: "origenes", key: line.key, code: "", message: "Indica las botellas" });
      if (litresToMl(line.nominal_text) <= 0) push({ step: "origenes", key: line.key, code: "", message: "Indica el volumen de la botella" });
      return;
    }
    const vessel = vessels.find((item) => item.code === line.vessel_code);
    if (!line.vessel_code) {
      if (reveal) push({ step: "origenes", key: line.key, code: "", message: "Elige el depósito" });
      return;
    }
    if (vessel && vessel.status !== "in_service") {
      push({ step: "origenes", key: line.key, code: "WC_VESSEL_NOT_IN_SERVICE", message: `${vessel.code} está fuera de servicio` });
    }
    if (op === "delestage" || op === "temperature_control" || op === "sampling") {
      if (!line.lot_id && reveal) push({ step: "origenes", key: line.key, code: "", message: "Ese depósito no tiene lote" });
      return;
    }
    if (op === "reception" || op === "bulk_reception") {
      if (vessel && vessel.volume_ml > 0) {
        push({ step: "origenes", key: line.key, code: "WC026", message: `${vessel.code} tiene producto; elige uno vacío (WC026)` });
      }
      return;
    }
    if (!sourceNeedsAmount) return;
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

  if (op === "reception") {
    if (reveal && !/^[A-Z0-9][A-Z0-9./-]{1,29}$/.test(draft.new_lot_code.trim())) {
      push({ step: "origenes", key: "new_lot_code", code: "", message: "Indica el código del lote" });
    }
    if (reveal && kgToG(draft.mass_text) <= 0) {
      push({ step: "origenes", key: "mass_text", code: "", message: "Indica los kilos" });
    }
    if (reveal && !vintageOk(draft.vintage_text)) {
      push({ step: "origenes", key: "vintage_text", code: "", message: "Indica la añada" });
    }
  }

  if (op === "bulk_reception") {
    if (reveal && !/^[A-Z0-9][A-Z0-9./-]{1,29}$/.test(draft.new_lot_code.trim())) {
      push({ step: "origenes", key: "new_lot_code", code: "", message: "Indica el código del lote" });
    }
    if (reveal && litresToMl(draft.inputs[0]?.volume_text ?? "") <= 0) {
      push({ step: "origenes", key: draft.inputs[0]?.key ?? "volume", code: "", message: "Indica los litros" });
    }
    if (reveal && !vintageOk(draft.vintage_text)) {
      push({ step: "origenes", key: "vintage_text", code: "", message: "Indica la añada" });
    }
  }

  if (op === "sampling" && reveal) {
    if (!/^[A-Z0-9][A-Z0-9./-]{0,31}$/.test(draft.sample_code.trim().toUpperCase())) {
      push({ step: "origenes", key: "sample_code", code: "", message: "Indica el código de la muestra" });
    }
  }

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
    if (reveal && !draft.cleaning_product_id) {
      push({ step: "origenes", key: "cleaning_product_id", code: "", message: "Elige el producto del catálogo" });
    }
  }

  if (op === "addition") {
    if (reveal && parseDecimal(draft.quantity_text) <= 0) {
      push({ step: "origenes", key: "quantity_text", code: "", message: "Indica la cantidad" });
    }
    if (reveal && parseDecimal(draft.dose_text) <= 0) {
      push({ step: "origenes", key: "dose_text", code: "", message: "Indica la dosis" });
    }
    if (reveal && !draft.additive_product_id) {
      push({ step: "origenes", key: "additive_product_id", code: "", message: "Elige el producto del catálogo" });
    }
  }

  if ((op === "blend" || op === "bottling" || op === "bleeding") && reveal && !/^[A-Z0-9][A-Z0-9./-]{1,29}$/.test(draft.new_lot_code.trim())) {
    push({ step: "destinos", key: "new_lot_code", code: "", message: "Indica el código del lote nuevo" });
  }
  if (op === "blend" || op === "bottling" || op === "bleeding") {
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

  if ((op === "bottling") && reveal && !draft.product_id) {
    push({ step: "destinos", key: "product_id", code: "", message: "Elige el producto envasado" });
  }

  if (destApplies(op)) {
    draft.outputs.forEach((line) => {
      if (op === "labeling") {
        if (reveal && !line.location_id) push({ step: "destinos", key: line.key, code: "", message: "Elige el almacén" });
        if (reveal && parseQty(line.qty_text) <= 0) push({ step: "destinos", key: line.key, code: "", message: "Indica las botellas" });
        return;
      }
      if (op === "bottling" && reveal && !line.location_id) {
        push({ step: "destinos", key: line.key, code: "", message: "Elige el almacén" });
      }
      const vessel = vessels.find((item) => item.code === line.vessel_code);
      if (op !== "bottling" && !line.vessel_code) {
        if (reveal) push({ step: "destinos", key: line.key, code: "", message: "Elige el depósito" });
        return;
      }
      if (vessel && vessel.status !== "in_service") {
        push({ step: "destinos", key: line.key, code: "WC_VESSEL_NOT_IN_SERVICE", message: `${vessel.code} está fuera de servicio` });
      }
      if ((op === "racking" || op === "filtration" || op === "bleeding") && line.vessel_code && line.vessel_code === draft.inputs[0]?.vessel_code) {
        push({ step: "destinos", key: line.key, code: "", message: "El destino es el mismo depósito" });
      }
      const sourceLot = draft.inputs[0]?.lot_id;
      const inside = holding(vessel);
      if (op === "bleeding" && inside && inside.volume_ml > 0) {
        push({ step: "destinos", key: line.key, code: "WC026", message: `${vessel?.code ?? "El destino"} tiene vino (WC026)` });
      }
      const pressCode = line.child_lot_code.trim();
      if (op === "pressing_off" && pressCode) {
        if (!/^[A-Z0-9][A-Z0-9./-]{1,29}$/.test(pressCode)) {
          push({ step: "destinos", key: line.key, code: "", message: "El lote de prensa no es válido" });
        }
        if (inside && inside.volume_ml > 0) {
          push({ step: "destinos", key: line.key, code: "WC026", message: "El lote de prensa entra en un depósito vacío (WC026)" });
        }
        if (pressCode === draft.inputs[0]?.lot_code) {
          push({ step: "destinos", key: line.key, code: "WC030", message: "Ese código es el lote de origen (WC030)" });
        }
      }
      if (op === "pressing_off" && inside && inside.volume_ml > 0 && sourceLot && inside.lot_id !== sourceLot) {
        push({ step: "destinos", key: line.key, code: "WC026", message: "El depósito contiene otro lote (WC026)" });
      }
      if (inside && sourceLot && inside.lot_id !== sourceLot && (op === "racking" || op === "filtration")) {
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
      if (op === "bottling") {
        if (reveal && parseQty(line.qty_text) <= 0) push({ step: "destinos", key: line.key, code: "", message: "Indica las botellas" });
        if (litresToMl(line.nominal_text) <= 0) {
          push({ step: "destinos", key: line.key, code: "", message: "Indica el volumen de la botella" });
        }
      } else if (reveal && litresToMl(line.volume_text) <= 0) {
        push({ step: "destinos", key: line.key, code: "", message: "Indica los litros" });
      }
      if (vessel && !((op === "bleeding" || op === "pressing_off") && draft.inputs.some((item) => item.vessel_code === line.vessel_code))) {
        const incoming = mlOf(op, "output", line);
        const sameLot = Boolean(inside && sourceLot && inside.lot_id === sourceLot);
        const base = !inside || sameLot ? (inside?.volume_ml ?? 0) : 0;
        if (incoming > 0 && (!inside || sameLot) && base + incoming > vessel.capacity_ml) {
          push({ step: "destinos", key: line.key, code: "WC025", message: `No cabe en ${vessel.code}: supera la capacidad (WC025)` });
        }
      }
    });
  }

  if (op === "temperature_control" && reveal) {
    const previous = parseSetpoint(draft.previous_setpoint);
    const next = parseSetpoint(draft.new_setpoint);
    if (previous === null || next === null) {
      push({ step: "origenes", key: "setpoint", code: "", message: "Indica las dos consignas, de −30 a 40 °C" });
    } else if (previous === next) {
      push({ step: "origenes", key: "setpoint", code: "", message: "La consigna nueva es la misma" });
    }
    if (draft.reason.trim().length < 3) {
      push({ step: "origenes", key: "reason", code: "", message: "Indica el motivo" });
    }
  }

  if (op === "delestage" && reveal) {
    const start = new Date(draft.started_at);
    const end = new Date(draft.ended_at);
    if (!draft.started_at || !draft.ended_at || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      push({ step: "origenes", key: "window", code: "", message: "Indica inicio y fin" });
    } else if (end.getTime() < start.getTime()) {
      push({ step: "origenes", key: "window", code: "", message: "El fin es anterior al inicio" });
    }
  }

  if (lossApplies(op)) {
    const incident = op === "destruction" || op === "loss" || draft.losses.some((line) => line.loss_kind === "incident");
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

function productState(op: OpType, role: LineRole, pack: Draft["pack_state"]): DraftLine["product_state"] {
  if (op === "bottling" && role === "output") return pack;
  if (op === "labeling" && role === "output") return "packaged_labeled";
  if (op === "labeling") return "packaged_unlabeled";
  return "wine";
}

function kgToG(text: string): number {
  const kg = parseDecimal(text);
  if (kg <= 0) return 0;
  return Math.round(kg * 1000);
}

function vintageOk(text: string): boolean {
  const year = Number(text.trim());
  return Number.isInteger(year) && year >= 1990 && year <= 2100;
}

function decimalText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
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
  location_id: string | null;
  volume_ml: number;
  qty_units: number;
  mass_g: number;
  loss_kind: "authorized" | "incident" | null;
  product_state: DraftLine["product_state"];
  nominal_volume_ml: number | null;
  notes: string | null;
  new_lot_code?: string | null;
  product_id?: string | null;
  excise_product_key?: string | null;
  nc_code?: string | null;
  owner_entity_id?: string | null;
};

export function buildPayload(draft: Draft, vessels: Vessel[], legalEntityId: string) {
  const op = draft.op_type;
  if (!op) throw new Error("Sin tipo");
  const vesselId = (code: string) => vessels.find((item) => item.code === code)?.id ?? null;
  const source = draft.inputs[0];

  const mapLine = (role: LineRole, line: DraftLine): PayloadLine => {
    const fresh = (op === "blend" || op === "bottling") && role === "output";
    const bulk = op === "bleeding" || op === "pressing_off";
    const follow = role !== "input" && (op === "racking" || op === "filtration" || op === "labeling" || bulk);
    const lotId = fresh ? null : follow ? source?.lot_id || null : line.lot_id || null;
    const place = vessels.find((item) => item.code === line.vessel_code);
    const carried = role === "input" || role === "loss" ? line.product_state : null;
    const sourceState = source?.product_state === "must" ? "must" : "wine";
    const bottled = (op === "bottling" && role === "output") || op === "labeling";
    const payload: PayloadLine = {
      role,
      lot_id: lotId || null,
      vessel_id: op === "labeling" || (op === "bottling" && role === "output") ? null : vesselId(line.vessel_code),
      location_id: line.location_id || place?.location_id || null,
      volume_ml: mlOf(op, role, line),
      qty_units: qtyOf(op, role, line),
      mass_g: 0,
      loss_kind: role === "loss" ? (op === "destruction" ? "incident" : bulk ? "authorized" : line.loss_kind) : null,
      product_state: op === "labeling"
        ? (role === "output" ? "packaged_labeled" : "packaged_unlabeled")
        : bulk ? sourceState : (carried ?? productState(op, role, draft.pack_state)),
      nominal_volume_ml: bottled ? litresToMl(line.nominal_text || "0") : null,
      notes: line.notes.trim() ? line.notes.trim() : null,
      product_id: (op === "bottling" && role === "output" ? draft.product_id : line.product_id) || null,
      excise_product_key: op === "bottling" && role === "output" && draft.excise_product_key.trim() ? draft.excise_product_key.trim() : null,
      nc_code: op === "bottling" && role === "output" && draft.nc_code.trim() ? draft.nc_code.trim() : null,
      owner_entity_id: line.owner_entity_id || null,
    };
    if (op === "pressing_off" && role === "output" && line.child_lot_code.trim()) payload.new_lot_code = line.child_lot_code.trim();
    return payload;
  };

  const meaningful = (line: PayloadLine) => line.volume_ml > 0 || line.qty_units > 0;
  let lines: PayloadLine[] = [];
  if (op === "loss" || op === "destruction") {
    lines = draft.losses.map((line) => mapLine("loss", line)).filter(meaningful);
  } else if (op !== "cleaning" && op !== "addition" && op !== "delestage" && op !== "temperature_control" && op !== "sampling" && op !== "reception" && op !== "bulk_reception") {
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
    ...((op === "blend" || op === "bottling" || op === "bleeding") && draft.new_lot_code.trim()
      ? { new_lot: { code: draft.new_lot_code.trim() } }
      : {}),
    ...(op === "delestage" || op === "temperature_control"
      ? { vessel_id: vesselId(source?.vessel_code ?? ""), lot_id: source?.lot_id || null }
      : {}),
    ...(op === "temperature_control"
      ? {
          previous_setpoint_c: setpointPayload(draft.previous_setpoint),
          new_setpoint_c: setpointPayload(draft.new_setpoint),
        }
      : {}),
    ...(op === "delestage"
      ? {
          started_at: toIso(draft.started_at || draft.occurred_at),
          ended_at: toIso(draft.ended_at || draft.occurred_at),
          notes: draft.process_notes.trim() ? draft.process_notes.trim() : null,
        }
      : {}),
    ...(op === "cleaning"
      ? {
          cleaning: {
            vessel_id: vesselId(source?.vessel_code ?? ""),
            product_id: draft.cleaning_product_id,
            active_substance: draft.active_substance.trim(),
            quantity: decimalText(parseDecimal(draft.cleaning_qty)),
            quantity_unit: draft.cleaning_unit,
            efficacy_check: draft.efficacy_check.trim(),
          },
        }
      : {}),
    ...(op === "addition"
      ? {
          vessel_id: vesselId(source?.vessel_code ?? ""),
          lot_id: source?.lot_id || null,
          addition: {
            additive_product_id: draft.additive_product_id,
            quantity: decimalText(parseDecimal(draft.quantity_text)),
            quantity_unit: draft.quantity_unit,
            dose: decimalText(parseDecimal(draft.dose_text)),
            dose_unit: draft.dose_unit,
            purpose: draft.purpose,
            organic_approved: draft.organic_approved,
          },
        }
      : {}),
    ...(op === "reception"
      ? {
          vessel_id: vesselId(source?.vessel_code ?? ""),
          mass_g: kgToG(draft.mass_text),
          lot_code: draft.new_lot_code.trim(),
          vintage: Number(draft.vintage_text),
          is_organic: draft.is_organic,
          notes: draft.reason.trim() ? draft.reason.trim() : null,
        }
      : {}),
    ...(op === "bulk_reception"
      ? {
          vessel_id: vesselId(source?.vessel_code ?? ""),
          volume_ml: litresToMl(source?.volume_text ?? ""),
          product_state: draft.intake_state,
          lot_code: draft.new_lot_code.trim(),
          vintage: Number(draft.vintage_text),
          is_organic: draft.is_organic,
          notes: draft.reason.trim() ? draft.reason.trim() : null,
        }
      : {}),
    ...(op === "sampling"
      ? {
          vessel_id: vesselId(source?.vessel_code ?? ""),
          lot_id: source?.lot_id || null,
          sampled_at: toIso(draft.occurred_at),
          sample_code: draft.sample_code.trim().toUpperCase(),
          destination: "internal" as const,
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
