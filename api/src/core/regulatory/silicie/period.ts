// Construcción del fichero de un periodo a partir de asientos ya calculados. No presenta nada.
import { createHash } from "node:crypto";
import { DomainError } from "../../errors";
import { payloadSha256 } from "../../approvals/canonical";
import { findNegativeBalances } from "../../inventory/balances";
import type { FiscalMove } from "../../inventory/types";
import { entriesFor } from "./entries";
import { renderAltaAsientosCsv } from "./csv";
import { renderAnulaciones, type AnnulmentReason, type AnnulmentRow } from "./iesx4";
import { validateCsv } from "./validate-csv";
import {
  silicieInvalid,
  type EntriesContext,
  type FiscalMoveInput,
  type MoveHint,
  type SilicieEntryDraft,
  type SilicieLedger,
} from "./types";
import { errorsOf, warningsOf, type Issue } from "../issue";

export interface PeriodFile {
  kind: "altas" | "anulaciones";
  exerciseYear: number;
  filename: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface BuiltPeriod {
  drafts: SilicieEntryDraft[];
  files: PeriodFile[];
  issues: Issue[];
  /** Años de ejercicio que tienen asientos de alta, en orden. */
  years: number[];
}

export interface BuildPeriodInput {
  moves: readonly FiscalMoveInput[];
  history: readonly FiscalMove[];
  ledgers: readonly SilicieLedger[];
  taxWarehouseId: string;
  cae: string;
  establishmentName: string;
  recordedOn: string;
  aggregation: "monthly" | "none";
  /** Primer correlativo de cada año. Si falta, se usa 1. */
  seqStartByYear: Readonly<Record<string, number>>;
  hints?: Readonly<Record<string, MoveHint>>;
  annulments?: readonly (AnnulmentRow & { exerciseYear: number })[];
  /** Operaciones de bodega en borrador dentro del periodo. */
  openOperations?: readonly { id: string; opType: string; occurredOn: string }[];
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildPeriod(input: BuildPeriodInput): BuiltPeriod {
  const issues: Issue[] = [];
  const ledgers = indexLedgers(input.ledgers);
  for (const ledger of input.ledgers) {
    if (!/^[0-9]{4,8}$/.test(ledger.ncCode)) {
      issues.push({
        severity: "error",
        code: "nc_ausente",
        message: `Falta el código NC del mayor ${ledger.reference}.`,
        item_id: ledger.id,
      });
    } else if (ledger.ncCode.length < 8) {
      issues.push({
        severity: "warning",
        code: "nc_corto",
        message: `El código NC del mayor ${ledger.reference} tiene ${ledger.ncCode.length} dígitos. El asesor tiene que confirmar los 8 (§6).`,
        item_id: ledger.id,
      });
    }
  }
  for (const move of input.moves) {
    const key = move.exciseProductKey;
    if (key === null || key === "" || !ledgers.has(key)) {
      issues.push({
        severity: "error",
        code: "nc_ausente",
        message: `Falta el código NC: el movimiento no tiene mayor SILICIE${key ? ` (${key})` : ""}.`,
        item_id: move.id,
      });
    }
  }
  issues.push(...balanceIssues(input.history));
  for (const operation of input.openOperations ?? []) {
    issues.push({
      severity: "error",
      code: "operacion_abierta",
      message: `Hay una operación de bodega sin confirmar en el periodo (${operation.opType}, ${operation.occurredOn}).`,
      item_id: operation.id,
    });
  }

  const missingLedger = issues.some((issue) => issue.code === "nc_ausente" && issue.item_id !== undefined && input.moves.some((move) => move.id === issue.item_id));
  const yearList = [...new Set(input.moves.map((move) => Number(move.fiscalDate.slice(0, 4))))]
    .filter((year) => Number.isInteger(year))
    .sort((a, b) => a - b);
  const drafts: SilicieEntryDraft[] = [];
  const files: PeriodFile[] = [];

  if (input.moves.length === 0 && (input.annulments ?? []).length === 0) {
    issues.push({
      severity: "error",
      code: "sin_asientos",
      message: "El periodo no tiene asientos que presentar.",
    });
  }

  if (!missingLedger && input.moves.length > 0) {
    for (const year of yearList) {
      const moves = input.moves.filter((move) => move.fiscalDate.startsWith(String(year)));
      if (moves.length === 0) continue;
      const seqStart = input.seqStartByYear[String(year)] ?? 1;
      const context: EntriesContext = {
        exerciseId: `exercise-${year}`,
        exerciseYear: year,
        taxWarehouseId: input.taxWarehouseId,
        nextLocalSeq: seqStart,
        ledgers: input.ledgers,
        aggregation: input.aggregation,
        recordedOn: input.recordedOn,
        establishmentName: clipEstablishment(input.establishmentName),
        hints: input.hints,
      };
      try {
        const built = entriesFor(moves, context);
        drafts.push(...built);
        const rendered = renderAltaAsientosCsv(built, { exerciseYear: year, cae: input.cae });
        files.push(fileOf("altas", year, rendered.filename, rendered.bytes));
        issues.push(...validateCsv(rendered.bytes));
      } catch (error) {
        issues.push(engineIssue(error));
      }
    }
  }

  const annulments = input.annulments ?? [];
  if (annulments.length > 0) {
    const byYear = new Map<number, AnnulmentRow[]>();
    for (const row of annulments) {
      const list = byYear.get(row.exerciseYear) ?? [];
      list.push(row);
      byYear.set(row.exerciseYear, list);
    }
    for (const [year, rows] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
      try {
        const rendered = renderAnulaciones(rows, { exerciseYear: year, cae: input.cae });
        files.push(fileOf("anulaciones", year, rendered.filename, rendered.bytes));
      } catch (error) {
        issues.push(engineIssue(error));
      }
    }
  }

  return { drafts, files, issues, years: yearList };
}

export function blocking(issues: readonly Issue[]): Issue[] {
  return errorsOf(issues);
}

export function nonBlocking(issues: readonly Issue[]): Issue[] {
  return warningsOf(issues);
}

function fileOf(kind: PeriodFile["kind"], exerciseYear: number, filename: string, bytes: Uint8Array): PeriodFile {
  return { kind, exerciseYear, filename, bytes, sha256: sha256Bytes(bytes) };
}

function indexLedgers(ledgers: readonly SilicieLedger[]): Map<string, SilicieLedger> {
  const map = new Map<string, SilicieLedger>();
  for (const ledger of ledgers) map.set(ledger.reference, ledger);
  return map;
}

function clipEstablishment(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 35) return trimmed;
  return trimmed.slice(0, 35);
}

function balanceIssues(history: readonly FiscalMove[]): Issue[] {
  if (history.length === 0) return [];
  try {
    return findNegativeBalances(history).map((finding) => ({
      severity: "error" as const,
      code: "saldo_negativo",
      message: `Saldo fiscal negativo${finding.excise_product_key ? ` en ${finding.excise_product_key}` : ""} el ${finding.at}: ${finding.volume_ml} mL.`,
      item_id: finding.excise_product_key ?? undefined,
    }));
  } catch (error) {
    return [engineIssue(error)];
  }
}

function engineIssue(error: unknown): Issue {
  if (error instanceof DomainError) {
    return { severity: "error", code: error.code, message: error.message };
  }
  if (error instanceof Error && error.message.trim() !== "") {
    return { severity: "error", code: "WC_VALIDATION", message: error.message };
  }
  return { severity: "error", code: "WC_VALIDATION", message: "No se ha podido preparar el fichero." };
}

export function canonicalContent(input: {
  legalEntityId: string;
  taxWarehouseId: string;
  cae: string;
  kind: string;
  periodStart: string;
  periodEnd: string;
  aggregation: "monthly" | "none";
  recordedOn: string;
  establishmentName: string;
  seqStartByYear: Readonly<Record<string, number>>;
  files: readonly PeriodFile[];
  drafts: readonly SilicieEntryDraft[];
  entryIds: ReadonlyMap<string, string>;
  annulments: readonly { aeatEntryNumber: string; reason: AnnulmentReason; exerciseYear: number }[];
}): Record<string, unknown> {
  const altas: Record<string, string> = {};
  const anulaciones: Record<string, string> = {};
  for (const file of input.files) {
    const bucket = file.kind === "altas" ? altas : anulaciones;
    bucket[String(file.exerciseYear)] = file.sha256;
  }
  return {
    version: 1,
    flow: "silicie",
    kind: input.kind,
    legal_entity_id: input.legalEntityId,
    tax_warehouse_id: input.taxWarehouseId,
    cae: input.cae,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    aggregation: input.aggregation,
    recorded_on: input.recordedOn,
    establishment_name: clipEstablishment(input.establishmentName),
    seq_start_by_year: { ...input.seqStartByYear },
    altas_sha256: altas,
    anulaciones_sha256: anulaciones,
    entries: input.drafts.map((draft) => ({
      id: input.entryIds.get(draftKey(draft)) ?? "",
      exercise_year: Number(draft.movementDate.slice(0, 4)),
      local_seq: draft.localSeq,
      entry_kind: draft.entryKind,
      movement_date: draft.movementDate,
      reference: draft.fields.referenciaProducto,
      cantidad: draft.fields.cantidad,
      unidad: draft.fields.unidadMedida,
      fiscal_move_ids: [...draft.fiscalMoveIds],
      annuls_entry_id: draft.annulsEntryId,
      numero_asiento_previo: draft.fields.numeroAsientoPrevio,
    })),
    annulments: input.annulments.map((row) => ({
      aeat_entry_number: row.aeatEntryNumber,
      reason: row.reason,
      exercise_year: row.exerciseYear,
    })),
  };
}

export function contentHash(canonical: Record<string, unknown>): string {
  return payloadSha256(canonical);
}

export function draftKey(draft: SilicieEntryDraft): string {
  return `${draft.movementDate.slice(0, 4)}:${draft.localSeq}`;
}

export function assertCae(cae: string): void {
  if (!/^ES[0-9A-Z]{11}$/.test(cae)) {
    throw silicieInvalid("el CAE del establecimiento no tiene la forma ES y 11 caracteres");
  }
}
