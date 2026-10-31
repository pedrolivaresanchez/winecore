import { ledgerFromSituation } from "../../src/core/regulatory/silicie/ledgers";
import type {
  EntriesContext,
  FiscalMoveInput,
  FiscalProductClass,
  SilicieLedger,
  WineColor,
} from "../../src/core/regulatory/silicie/types";
import { DomainError } from "../../src/core/errors";
import { expect } from "bun:test";

export const WH = "wh-sint";
export const CAE = "ES00000V0000T";
export const HEADER = { exerciseYear: 2027, cae: CAE };
export const PARTY_ID = "contacto-sintetico";
export const PARTY = {
  documentType: "3" as const,
  documentNumber: "SYNTH-CLIENTE",
  legalName: "Cliente Sintetico",
};
const CREATED = "2027-01-01T00:00:00.000Z";

export function uva(): SilicieLedger {
  return ledgerFromSituation({
    id: "led-uva",
    taxWarehouseId: WH,
    createdAt: CREATED,
    situation: { productClass: "raw_grape" },
  });
}

export function granel(color: WineColor, ncCode = "220429"): SilicieLedger {
  return ledgerFromSituation({
    id: `led-granel-${color}`,
    taxWarehouseId: WH,
    createdAt: CREATED,
    ncCode,
    situation: { productClass: "bulk", color },
  });
}

export function crianza(color: WineColor, ncCode = "220429"): SilicieLedger {
  return ledgerFromSituation({
    id: `led-crianza-${color}`,
    taxWarehouseId: WH,
    createdAt: CREATED,
    ncCode,
    situation: { productClass: "bulk_wood", color },
  });
}

export function bottled(wineCode = "SINTE", brand = "SINTE", color: WineColor = "tinto"): SilicieLedger {
  return ledgerFromSituation({
    id: `led-b075-${wineCode}`,
    taxWarehouseId: WH,
    createdAt: CREATED,
    ncCode: "220421",
    situation: {
      productClass: "packaged",
      color,
      wineCode,
      brand,
      containerKind: "bottle",
      containerCapacityMl: 750,
    },
  });
}

export function defaultLedgers(): SilicieLedger[] {
  return [uva(), granel("tinto"), granel("blanco"), granel("rosado"), crianza("tinto"), crianza("blanco"), bottled()];
}

export function move(
  partial: Partial<FiscalMoveInput> &
    Pick<FiscalMoveInput, "id" | "moveType" | "productClass" | "volumeMl" | "exciseProductKey">,
): FiscalMoveInput {
  return {
    taxWarehouseId: WH,
    fiscalDate: "2027-06-15",
    physicalDate: null,
    lotId: null,
    productId: null,
    units: 0,
    abvCenti: 1250,
    ncCode: null,
    justificationType: "internal",
    justificationRef: "OP-1",
    counterpartyContactId: null,
    counterpartyExciseNumber: null,
    fiscalTrigger: "operation",
    sourceTable: "cellar.operation",
    sourceId: "op-1",
    sourceLineId: null,
    silicieEntryId: null,
    reversesMoveId: null,
    reason: null,
    createdBy: "sintetico",
    createdAt: "2027-06-15T08:00:00.000Z",
    ...partial,
  };
}

export function ctx(partial: Partial<EntriesContext> = {}): EntriesContext {
  return {
    exerciseId: partial.exerciseId ?? "ej-2027",
    exerciseYear: partial.exerciseYear ?? 2027,
    taxWarehouseId: partial.taxWarehouseId ?? WH,
    nextLocalSeq: partial.nextLocalSeq ?? 1,
    ledgers: partial.ledgers ?? defaultLedgers(),
    aggregation: partial.aggregation ?? "none",
    recordedOn: "recordedOn" in partial ? partial.recordedOn : "2027-10-01",
    establishmentName: partial.establishmentName ?? "Fábrica sintética",
    hints: partial.hints ?? {},
    facts: partial.facts ?? [],
    counterparties: partial.counterparties ?? { [PARTY_ID]: PARTY },
    retailJustificationByMonth: partial.retailJustificationByMonth ?? {},
    closeExercise: partial.closeExercise,
  };
}

export function opening(
  id: string,
  productClass: FiscalProductClass,
  key: string,
  volumeMl: number,
  ref: string,
  extra: Partial<FiscalMoveInput> = {},
): FiscalMoveInput {
  return move({
    id,
    moveType: "opening",
    productClass,
    exciseProductKey: key,
    volumeMl,
    fiscalDate: "2027-01-01",
    justificationType: "count_record",
    justificationRef: ref,
    fiscalTrigger: "count",
    sourceTable: "inventory.inventory_count",
    sourceId: id,
    ...extra,
  });
}

export function bottles(count: number, sign: -1 | 1 = 1): { volumeMl: number; units: number } {
  return { volumeMl: sign * count * 750, units: sign * count };
}

export function expectUnspecified(run: () => void, fragment: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    const unspecified = error as DomainError;
    expect(unspecified.code).toBe("WC_REG_SILICIE_UNSPECIFIED");
    expect(unspecified.httpStatus).toBe(422);
    expect(unspecified.message).toContain(fragment);
    return;
  }
  throw new Error(`se esperaba un caso no especificado: ${fragment}`);
}

export function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}
