// Ficha INFOVI: existencias por instalación, color y categoría.
// Apertura + entradas − salidas = cierre. No presenta nada a la sede.
import { addMl, averageHl, gToKg, mlToLitres } from "./measure";
import type { Issue } from "../issue";

export const BLOCKED_NOTE =
  "BLOCKED: el modelo oficial del anexo III b (columnas de la aplicación INFOVI) sigue abierto. Este CSV es la ficha para teclear, no el fichero de la sede.";

const GAUGE_WINDOW_DAYS = 45;

export type WineFamily = "mosto" | "vino";
export type InfoviCategory = "con_dop" | "con_igp" | "varietal" | "sin_dop_igp";
export type InfoviColor = "red" | "white" | "rose" | "orange" | "sweet" | "sparkling" | "other";

const COLORS = new Set<InfoviColor>(["red", "white", "rose", "orange", "sweet", "sparkling", "other"]);

export interface InfoviMove {
  id: string;
  day: string;
  inInstallation: boolean;
  lotId: string | null;
  productState: string;
  volumeMl: number;
  massG: number;
  qtyUnits: number;
  moveType: string;
  sourceTable: string;
  sourceId: string;
}

export interface InfoviLot {
  id: string;
  wineId: string | null;
  code: string;
}

export interface InfoviWine {
  id: string;
  code: string;
  name: string;
  color: string;
  category: string;
}

export interface InfoviOperation {
  id: string;
  opType: string;
  status: string;
  day: string;
  varietyCode: string | null;
  netG: number | null;
  parcelCodes: readonly string[];
  sourceKind: "parcels" | "grower" | null;
  hasIntake: boolean;
  lotIds: readonly string[];
  inputMl: number;
  outputMl: number;
}

export interface InfoviEdge {
  childLotId: string;
  parentLotId: string;
}

export interface InfoviGauge {
  day: string;
  volumeMl: number;
}

export interface BuildSheetInput {
  installationId: string;
  installationName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  moves: readonly InfoviMove[];
  lots: readonly InfoviLot[];
  wines: readonly InfoviWine[];
  operations: readonly InfoviOperation[];
  edges: readonly InfoviEdge[];
  gauges: readonly InfoviGauge[];
}

export interface SheetLine {
  family: WineFamily;
  color: InfoviColor;
  category: InfoviCategory;
  openingMl: number;
  entriesMl: number;
  exitsMl: number;
  closingMl: number;
  reconciles: boolean;
}

export interface GrapeRow {
  operationId: string;
  day: string;
  variety: string | null;
  parcelCodes: string[];
  kg: string | null;
  hasIntake: boolean;
}

export interface SheetProduction {
  campaign: string;
  mustMl: number;
  wineMl: number;
  averageHl: string | null;
  campaignsWithData: number;
}

export interface InfoviSheet {
  installationId: string;
  installationName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  lines: SheetLine[];
  grape: GrapeRow[];
  production: SheetProduction;
  bottlingMl: number;
  salesMl: number;
  reconciliation: { ok: boolean; unbalanced: number };
  issues: Issue[];
  blockedNote: string;
}

interface Bucket {
  openingMl: number;
  entriesMl: number;
  exitsMl: number;
  closingMl: number;
}

interface Classified {
  family: WineFamily;
  color: InfoviColor;
  category: InfoviCategory;
}

export function buildInfoviSheet(input: BuildSheetInput): InfoviSheet {
  const lots = new Map(input.lots.map((lot) => [lot.id, lot]));
  const wines = new Map(input.wines.map((wine) => [wine.id, wine]));
  const varieties = varietyByLot(input.lots, input.edges, input.operations);
  const issues: Issue[] = [];
  const groups = new Map<string, Bucket>();
  const seenMove = new Set<string>();
  let outsideMl = 0;

  for (const move of input.moves) {
    if (seenMove.has(move.id)) continue;
    seenMove.add(move.id);
    const family = familyOf(move.productState);
    if (!family) continue;
    if (!inPeriodOrBefore(move, input.periodEnd)) continue;
    if (!move.inInstallation) {
      if (move.day >= input.periodStart && move.day <= input.periodEnd && move.volumeMl !== 0) {
        outsideMl = addMl(outsideMl, Math.abs(move.volumeMl));
      }
      continue;
    }
    const classified = classify(move, lots, wines, varieties, issues);
    const key = classified
      ? `${classified.family}|${classified.color}|${classified.category}`
      : null;
    const bucket = key ? (groups.get(key) ?? blank()) : null;
    applyMove(bucket, move, input.periodStart, input.periodEnd);
    if (key && bucket) groups.set(key, bucket);
  }

  if (outsideMl !== 0) {
    issues.push(warning(
      "fuera_de_instalacion",
      `Hay ${mlToLitres(outsideMl)} L de vino o mosto del titular fuera de la instalación en el periodo.`,
    ));
  }

  const lines: SheetLine[] = [];
  for (const [key, bucket] of groups) {
    const [family, color, category] = key.split("|") as [WineFamily, InfoviColor, InfoviCategory];
    const expected = addMl(addMl(bucket.openingMl, bucket.entriesMl), -bucket.exitsMl);
    const reconciles = expected === bucket.closingMl;
    if (!reconciles) {
      issues.push(error(
        "cuadre_roto",
        `El grupo ${family} ${color} ${category} no cuadra: apertura + entradas − salidas no es el cierre.`,
      ));
    }
    if (bucket.openingMl === 0 && bucket.entriesMl === 0 && bucket.exitsMl === 0 && bucket.closingMl === 0) {
      continue;
    }
    lines.push({
      family,
      color,
      category,
      openingMl: bucket.openingMl,
      entriesMl: bucket.entriesMl,
      exitsMl: bucket.exitsMl,
      closingMl: bucket.closingMl,
      reconciles,
    });
  }
  lines.sort(compareLines);

  const grape = grapeRows(input, issues);
  const production = productionOf(input);
  regimeFindings(production, issues);
  operationFindings(input, issues);
  gaugeFinding(input, lines, issues);
  salesFinding(input, issues);

  const stockMoves = input.moves.some((move) => move.inInstallation && familyOf(move.productState) && move.day <= input.periodEnd);
  if (!stockMoves) {
    issues.push(warning("sin_movimientos", "No hay movimientos de vino ni de mosto en la instalación."));
  }
  issues.push(warning("reovi_ausente", "Falta el número REOVI/NIDPB (Q-031). No está en WineCore."));
  issues.push(warning("modelo_oficial", BLOCKED_NOTE));

  const unbalanced = lines.filter((line) => !line.reconciles).length;
  const missing = issues.some((issue) => issue.code === "dato_ausente" || issue.code === "venta_sin_lote");
  return {
    installationId: input.installationId,
    installationName: input.installationName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueDate: input.dueDate,
    lines,
    grape,
    production,
    bottlingMl: bottlingMl(input),
    salesMl: salesMl(input),
    reconciliation: { ok: unbalanced === 0 && !missing, unbalanced },
    issues: sortIssues(dedupe(issues)),
    blockedNote: BLOCKED_NOTE,
  };
}

function inPeriodOrBefore(move: InfoviMove, periodEnd: string): boolean {
  return move.day <= periodEnd;
}

function blank(): Bucket {
  return { openingMl: 0, entriesMl: 0, exitsMl: 0, closingMl: 0 };
}

function applyMove(bucket: Bucket | null, move: InfoviMove, start: string, end: string): void {
  if (!bucket || move.volumeMl === 0) return;
  if (move.day <= end) bucket.closingMl = addMl(bucket.closingMl, move.volumeMl);
  if (move.day < start) {
    bucket.openingMl = addMl(bucket.openingMl, move.volumeMl);
    return;
  }
  if (move.day > end) return;
  if (move.volumeMl > 0) bucket.entriesMl = addMl(bucket.entriesMl, move.volumeMl);
  else bucket.exitsMl = addMl(bucket.exitsMl, -move.volumeMl);
}

function familyOf(state: string): WineFamily | null {
  if (state === "must") return "mosto";
  if (state === "wine" || state === "packaged_unlabeled" || state === "packaged_labeled") return "vino";
  return null;
}

function classify(
  move: InfoviMove,
  lots: ReadonlyMap<string, InfoviLot>,
  wines: ReadonlyMap<string, InfoviWine>,
  varieties: ReadonlyMap<string, ReadonlySet<string>>,
  issues: Issue[],
): Classified | null {
  const family = familyOf(move.productState);
  if (!family || move.volumeMl === 0) return null;
  if (!move.lotId) {
    issues.push(error("dato_ausente", "Un movimiento de vino o mosto no tiene lote.", move.id));
    return null;
  }
  const lot = lots.get(move.lotId);
  const wine = lot?.wineId ? wines.get(lot.wineId) : undefined;
  if (!lot || !wine) {
    issues.push(error("dato_ausente", `El lote ${lot?.code ?? move.lotId} no tiene vino, color ni categoría.`, move.lotId));
    return null;
  }
  if (!isColor(wine.color)) {
    issues.push(error("dato_ausente", `El vino ${wine.code} no tiene un color reconocible.`, wine.id));
    return null;
  }
  const category = categoryOf(wine, varieties.get(lot.id) ?? new Set());
  if (!category) {
    issues.push(error("dato_ausente", `El vino ${wine.code} no tiene categoría INFOVI.`, wine.id));
    return null;
  }
  return { family, color: wine.color, category };
}

function isColor(value: string): value is InfoviColor {
  return COLORS.has(value as InfoviColor);
}

function categoryOf(wine: InfoviWine, varieties: ReadonlySet<string>): InfoviCategory | null {
  if (wine.category === "pdo_wine") return "con_dop";
  if (wine.category === "pgi_wine") return "con_igp";
  if (wine.category === "wine" || wine.category === "fortified" || wine.category === "other") {
    return varieties.size === 1 ? "varietal" : "sin_dop_igp";
  }
  return null;
}

function varietyByLot(
  lots: readonly InfoviLot[],
  edges: readonly InfoviEdge[],
  operations: readonly InfoviOperation[],
): Map<string, Set<string>> {
  const direct = new Map<string, Set<string>>();
  for (const operation of operations) {
    if (!operation.varietyCode) continue;
    for (const lotId of operation.lotIds) {
      const set = direct.get(lotId) ?? new Set<string>();
      set.add(operation.varietyCode);
      direct.set(lotId, set);
    }
  }
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    const list = parents.get(edge.childLotId) ?? [];
    list.push(edge.parentLotId);
    parents.set(edge.childLotId, list);
  }
  const memo = new Map<string, Set<string>>();
  function collect(lotId: string, stack: Set<string>): Set<string> {
    const cached = memo.get(lotId);
    if (cached) return cached;
    if (stack.has(lotId)) return new Set();
    stack.add(lotId);
    const out = new Set(direct.get(lotId) ?? []);
    for (const parent of parents.get(lotId) ?? []) {
      for (const code of collect(parent, stack)) out.add(code);
    }
    stack.delete(lotId);
    memo.set(lotId, out);
    return out;
  }
  const map = new Map<string, Set<string>>();
  for (const lot of lots) map.set(lot.id, collect(lot.id, new Set()));
  return map;
}

function grapeRows(input: BuildSheetInput, issues: Issue[]): GrapeRow[] {
  const rows: GrapeRow[] = [];
  for (const operation of input.operations) {
    if (operation.opType !== "reception" || operation.status !== "confirmed") continue;
    if (operation.day < input.periodStart || operation.day > input.periodEnd) continue;
    if (!operation.hasIntake) {
      issues.push(warning("entrada_uva_sin_ficha", "La recepción de uva no tiene ficha de entrada.", operation.id));
    }
    if (!operation.varietyCode) {
      issues.push(warning("variedad_ausente", "La recepción de uva no indica la variedad.", operation.id));
    }
    if (operation.parcelCodes.length === 0) {
      issues.push(warning("parcela_ausente", "La recepción de uva no indica la parcela.", operation.id));
    }
    const moved = grapeMass(input.moves, operation.id);
    if (operation.netG !== null && moved !== null && operation.netG !== moved) {
      issues.push(error(
        "entrada_uva_descuadre",
        `La ficha de uva (${gToKg(operation.netG)} kg) no coincide con el movimiento (${gToKg(moved)} kg).`,
        operation.id,
      ));
    }
    const grams = operation.netG ?? moved;
    rows.push({
      operationId: operation.id,
      day: operation.day,
      variety: operation.varietyCode,
      parcelCodes: [...operation.parcelCodes],
      kg: grams === null ? null : gToKg(grams),
      hasIntake: operation.hasIntake,
    });
  }
  rows.sort((left, right) => left.day.localeCompare(right.day) || left.operationId.localeCompare(right.operationId));
  return rows;
}

function grapeMass(moves: readonly InfoviMove[], operationId: string): number | null {
  let total = 0;
  let found = false;
  for (const move of moves) {
    if (move.sourceId !== operationId || move.productState !== "grape") continue;
    total = addMl(total, move.massG);
    found = true;
  }
  return found ? total : null;
}

function operationFindings(input: BuildSheetInput, issues: Issue[]): void {
  const sources = new Set(input.moves.map((move) => move.sourceId));
  for (const operation of input.operations) {
    if (operation.day < input.periodStart || operation.day > input.periodEnd) continue;
    if (operation.status === "draft" && operation.opType !== "cleaning") {
      issues.push(error("operacion_abierta", "Hay una operación en borrador dentro del periodo.", operation.id));
      continue;
    }
    if (operation.status !== "confirmed") continue;
    if (!TRACKED.has(operation.opType)) continue;
    if (!sources.has(operation.id)) {
      issues.push(error("operacion_sin_movimiento", "La operación confirmada no tiene movimiento de existencias.", operation.id));
    }
  }
}

const TRACKED = new Set(["reception", "crushing_pressing", "fermentation_end", "bottling"]);

function productionOf(input: BuildSheetInput): SheetProduction {
  const campaign = campaignOf(input.periodEnd);
  let mustMl = 0;
  let wineMl = 0;
  for (const operation of input.operations) {
    if (operation.status !== "confirmed") continue;
    if (operation.day < campaign.start || operation.day > campaign.end) continue;
    if (operation.opType === "crushing_pressing") mustMl = addMl(mustMl, operation.outputMl);
    if (operation.opType === "fermentation_end") wineMl = addMl(wineMl, operation.outputMl);
  }
  const previous = previousCampaigns(campaign, 4);
  let withData = 0;
  let wineSum = 0;
  for (const item of previous) {
    let any = false;
    let wine = 0;
    for (const operation of input.operations) {
      if (operation.status !== "confirmed") continue;
      if (operation.day < item.start || operation.day > item.end) continue;
      if (operation.opType !== "crushing_pressing" && operation.opType !== "fermentation_end") continue;
      any = true;
      if (operation.opType === "fermentation_end") wine = addMl(wine, operation.outputMl);
    }
    if (!any) continue;
    withData += 1;
    wineSum = addMl(wineSum, wine);
  }
  const mean = withData === 4 ? averageHl(wineSum, 4) : null;
  return { campaign: campaign.label, mustMl, wineMl, averageHl: mean, campaignsWithData: withData };
}

function regimeFindings(production: SheetProduction, issues: Issue[]): void {
  if (production.averageHl === null) {
    issues.push(warning(
      "media_incompleta",
      "Faltan campañas para la media de cuatro años. No se puede confirmar el umbral de 1.000 hl.",
    ));
    return;
  }
  const hl = Number(production.averageHl);
  if (hl >= 1000) {
    issues.push(warning(
      "umbral_mensual",
      `La media de cuatro campañas es ${production.averageHl} hl. El art. 5.2 exige declaración mensual.`,
    ));
    return;
  }
  issues.push(warning(
    "regimen_semestral",
    `La media de cuatro campañas es ${production.averageHl} hl, por debajo de 1.000 hl. El art. 5.3 declara en diciembre y agosto; esta ficha es mensual, con plazo el día 20.`,
  ));
}

function gaugeFinding(input: BuildSheetInput, lines: readonly SheetLine[], issues: Issue[]): void {
  let best: InfoviGauge | null = null;
  let bestDistance = GAUGE_WINDOW_DAYS + 1;
  for (const gauge of input.gauges) {
    const distance = Math.abs(daysBetween(gauge.day, input.periodEnd));
    if (distance > GAUGE_WINDOW_DAYS) continue;
    if (distance < bestDistance) {
      best = gauge;
      bestDistance = distance;
    }
  }
  if (!best) {
    issues.push(warning("aforo_ausente", "No hay un aforo aprobado a menos de 45 días del cierre."));
    return;
  }
  const closing = lines.reduce((sum, line) => addMl(sum, line.closingMl), 0);
  if (closing !== best.volumeMl) {
    issues.push(warning(
      "aforo_distinto",
      `El aforo del ${best.day} (${mlToLitres(best.volumeMl)} L) no coincide con el cierre (${mlToLitres(closing)} L).`,
    ));
  }
}

function salesFinding(input: BuildSheetInput, issues: Issue[]): void {
  for (const move of input.moves) {
    if (move.moveType !== "delivery_out") continue;
    if (!move.inInstallation) continue;
    if (move.day < input.periodStart || move.day > input.periodEnd) continue;
    if (!familyOf(move.productState)) continue;
    if (!move.lotId) {
      issues.push(error("venta_sin_lote", "Una salida de venta no tiene lote.", move.id));
    }
    if (move.volumeMl === 0 && move.qtyUnits !== 0) {
      issues.push(warning("venta_sin_volumen", "Una salida de venta tiene unidades y no tiene litros.", move.id));
    }
  }
}

function bottlingMl(input: BuildSheetInput): number {
  let total = 0;
  for (const operation of input.operations) {
    if (operation.opType !== "bottling" || operation.status !== "confirmed") continue;
    if (operation.day < input.periodStart || operation.day > input.periodEnd) continue;
    total = addMl(total, operation.outputMl);
  }
  return total;
}

function salesMl(input: BuildSheetInput): number {
  let total = 0;
  for (const move of input.moves) {
    if (move.moveType !== "delivery_out" || !move.inInstallation) continue;
    if (move.day < input.periodStart || move.day > input.periodEnd) continue;
    if (!familyOf(move.productState) || move.volumeMl >= 0) continue;
    total = addMl(total, -move.volumeMl);
  }
  return total;
}

interface Campaign {
  start: string;
  end: string;
  label: string;
}

function campaignOf(day: string): Campaign {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const startYear = month >= 8 ? year : year - 1;
  return {
    start: `${startYear}-08-01`,
    end: `${startYear + 1}-07-31`,
    label: `${startYear}/${startYear + 1}`,
  };
}

function previousCampaigns(current: Campaign, count: number): Campaign[] {
  const items: Campaign[] = [];
  let year = Number(current.start.slice(0, 4));
  for (let index = 0; index < count; index += 1) {
    year -= 1;
    items.push({
      start: `${year}-08-01`,
      end: `${year + 1}-07-31`,
      label: `${year}/${year + 1}`,
    });
  }
  return items;
}

function daysBetween(left: string, right: string): number {
  const start = Date.parse(`${left}T00:00:00Z`);
  const end = Date.parse(`${right}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function compareLines(left: SheetLine, right: SheetLine): number {
  return left.family.localeCompare(right.family)
    || left.color.localeCompare(right.color)
    || left.category.localeCompare(right.category);
}

function dedupe(issues: readonly Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.code}|${issue.item_id ?? ""}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "error" ? -1 : 1;
    return left.code.localeCompare(right.code) || left.message.localeCompare(right.message, "es");
  });
}

function error(code: string, message: string, itemId?: string): Issue {
  const issue: Issue = { severity: "error", code, message };
  if (itemId) issue.item_id = itemId;
  return issue;
}

function warning(code: string, message: string, itemId?: string): Issue {
  const issue: Issue = { severity: "warning", code, message };
  if (itemId) issue.item_id = itemId;
  return issue;
}

export function sheetToPayload(sheet: InfoviSheet, extra: {
  legalEntityId: string;
  recordedOn: string;
  rectifiesFilingId: string | null;
  reason: string | null;
  csvSha256: string;
}): Record<string, unknown> {
  return {
    legal_entity_id: extra.legalEntityId,
    tax_warehouse_id: sheet.installationId,
    installation_name: sheet.installationName,
    period_start: sheet.periodStart,
    period_end: sheet.periodEnd,
    due_date: sheet.dueDate,
    recorded_on: extra.recordedOn,
    kind: "infovi.mensual",
    blocked_note: sheet.blockedNote,
    csv_sha256: extra.csvSha256,
    rectifies_filing_id: extra.rectifiesFilingId,
    reason: extra.reason,
    lines: sheet.lines.map((line) => ({
      family: line.family,
      color: line.color,
      category: line.category,
      opening_ml: line.openingMl,
      entries_ml: line.entriesMl,
      exits_ml: line.exitsMl,
      closing_ml: line.closingMl,
      opening_l: mlToLitres(line.openingMl),
      entries_l: mlToLitres(line.entriesMl),
      exits_l: mlToLitres(line.exitsMl),
      closing_l: mlToLitres(line.closingMl),
      reconciles: line.reconciles,
    })),
    grape: sheet.grape.map((row) => ({
      operation_id: row.operationId,
      day: row.day,
      variety: row.variety,
      parcel_codes: row.parcelCodes,
      kg: row.kg,
      has_intake: row.hasIntake,
    })),
    production: {
      campaign: sheet.production.campaign,
      must_l: mlToLitres(sheet.production.mustMl),
      wine_l: mlToLitres(sheet.production.wineMl),
      average_hl: sheet.production.averageHl,
      campaigns_with_data: sheet.production.campaignsWithData,
    },
    bottling_l: mlToLitres(sheet.bottlingMl),
    sales_l: mlToLitres(sheet.salesMl),
    reconciliation: sheet.reconciliation,
  };
}
