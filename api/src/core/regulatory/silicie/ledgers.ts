// Mayores SILICIE (§6) y WC122. La identificación no se edita: se crea otro mayor y se traspasa.
import {
  SilicieDataError,
  SilicieLedgerIdentityError,
  SilicieUnspecifiedError,
  type FiscalProductClass,
  type LedgerProductClass,
  type LedgerSituation,
  type SilicieLedger,
  type VesselRef,
  type WineColor,
} from "./types";

const REFERENCE = /^[A-Z0-9_-]{2,20}$/;

export function ledgerClassForVessel(vessel: VesselRef): "bulk" | "bulk_wood" {
  if (vessel.kind === "tank_storage" || vessel.kind === "tank_fermenter") {
    return "bulk";
  }
  if (vessel.kind === "barrel" && vessel.material === "oak") {
    return "bulk_wood";
  }
  throw new SilicieUnspecifiedError(
    `clase de mayor para el recipiente ${vessel.kind}/${vessel.material}: §5 solo fija el depósito (granel) y la barrica de madera no revestida (crianza, kind barrel y material oak)`,
  );
}

/** Trasiego depósito ↔ barrica de roble: cambia de mayor. Entre depósitos del mismo mayor, no (§5). */
export function rackingCrossesLedger(from: VesselRef, to: VesselRef): boolean {
  return ledgerClassForVessel(from) !== ledgerClassForVessel(to);
}

export function ledgerKeyFor(
  move: { productClass: LedgerProductClass; exciseProductKey: string | null },
  situation: LedgerSituation,
): string {
  if (move.productClass !== situation.productClass) {
    throw new SilicieDataError("la clase del movimiento no coincide con la situación del producto");
  }
  const expected = referenceFor(situation);
  if (move.exciseProductKey !== null && move.exciseProductKey !== expected) {
    throw new SilicieLedgerIdentityError();
  }
  return expected;
}

export function ledgerFromSituation(args: {
  id: string;
  taxWarehouseId: string;
  createdAt: string;
  situation: LedgerSituation;
  /**
   * En vino, §6 deja los 8 dígitos pendientes. Hay que pasar el encabezado que sí figura
   * (220429, 220421, 220422) o un NC de 8 dígitos que empiece por ese encabezado.
   */
  ncCode?: string;
}): SilicieLedger {
  const situation = args.situation;
  const reference = referenceFor(situation);
  const description = descriptionFor(situation);
  const ncCode = ncFor(situation, args.ncCode);
  const wine = isWineClass(situation.productClass);
  const packaged = situation.productClass === "packaged";
  if (description.length < 3 || description.length > 100) {
    throw new SilicieDataError("la descripción del mayor debe tener entre 3 y 100 caracteres");
  }
  rejectSeparator(reference, "referencia del mayor");
  rejectSeparator(description, "descripción del mayor");
  return {
    id: args.id,
    taxWarehouseId: args.taxWarehouseId,
    reference,
    description,
    productClass: situation.productClass,
    epigrafe: wine ? "1" : null,
    epigrafeCode: wine ? "V0" : null,
    ncCode,
    productKey: productKeyFor(situation.productClass),
    containerType: packaged ? "VF03" : null,
    containerCapacityMl: packaged ? (situation.containerCapacityMl ?? null) : null,
    isActive: true,
    validatedBy: null,
    createdAt: args.createdAt,
  };
}

/** WC122: is_active y validated_by pueden cambiar; el resto de la identificación, no. */
export function assertCanUpdate(before: SilicieLedger, after: SilicieLedger): void {
  if (before.id !== after.id) {
    throw new SilicieDataError("no es una actualización del mismo mayor");
  }
  if (identityChanged(before, after)) {
    throw new SilicieLedgerIdentityError();
  }
}

export interface LedgerTransferPlan {
  changed: true;
  previous: SilicieLedger;
  next: SilicieLedger;
  setPreviousInactive: true;
  transfer: null | {
    volumeMl: number;
    outMoveType: "ledger_change_out";
    inMoveType: "ledger_change_in";
    outEntryKind: "A17";
    inEntryKind: "A16";
    fromProductClass: FiscalProductClass;
    toProductClass: FiscalProductClass;
    fromReference: string;
    toReference: string;
  };
}

/**
 * Cambio de identificación: mayor nuevo y, si hay saldo, traspaso A17/A16.
 * No modifica `current`.
 */
export function planIdentificationChange(
  current: SilicieLedger,
  args: {
    newId: string;
    createdAt: string;
    situation: LedgerSituation;
    ncCode?: string;
    balanceMl: number;
  },
): { changed: false } | LedgerTransferPlan {
  if (!Number.isSafeInteger(args.balanceMl) || args.balanceMl < 0) {
    throw new SilicieDataError("el saldo a traspasar tiene que ser un entero de mililitros ≥ 0");
  }
  const next = ledgerFromSituation({
    id: args.newId,
    taxWarehouseId: current.taxWarehouseId,
    createdAt: args.createdAt,
    situation: args.situation,
    ncCode: args.ncCode ?? current.ncCode,
  });
  if (!identityChanged(current, next)) {
    return { changed: false };
  }
  const fromClass = asFiscalClass(current.productClass);
  const toClass = asFiscalClass(next.productClass);
  return {
    changed: true,
    previous: current,
    next,
    setPreviousInactive: true,
    transfer:
      args.balanceMl === 0
        ? null
        : {
            volumeMl: args.balanceMl,
            outMoveType: "ledger_change_out",
            inMoveType: "ledger_change_in",
            outEntryKind: "A17",
            inEntryKind: "A16",
            fromProductClass: fromClass,
            toProductClass: toClass,
            fromReference: current.reference,
            toReference: next.reference,
          },
  };
}

export function identityChanged(before: SilicieLedger, after: SilicieLedger): boolean {
  return (
    before.taxWarehouseId !== after.taxWarehouseId ||
    before.reference !== after.reference ||
    before.description !== after.description ||
    before.productClass !== after.productClass ||
    before.epigrafe !== after.epigrafe ||
    before.epigrafeCode !== after.epigrafeCode ||
    before.ncCode !== after.ncCode ||
    before.productKey !== after.productKey ||
    before.containerType !== after.containerType ||
    before.containerCapacityMl !== after.containerCapacityMl
  );
}

function referenceFor(situation: LedgerSituation): string {
  switch (situation.productClass) {
    case "raw_grape":
      return "UVA";
    case "raw_must":
      return "MOSTO";
    case "byproduct":
      throw new SilicieUnspecifiedError(
        "clave y código NC concreto de orujos y lías: §6 indica 2307 / 2308 y una tabla de claves que no reproduce",
      );
    case "bulk":
      return `GRANEL-${colorToken(situation)}`;
    case "bulk_wood":
      return `CRIANZA-${colorToken(situation)}`;
    case "packaged":
      return packagedReference(situation);
    default: {
      const unreachable: never = situation.productClass;
      throw new SilicieDataError(`clase de mayor desconocida: ${String(unreachable)}`);
    }
  }
}

function descriptionFor(situation: LedgerSituation): string {
  switch (situation.productClass) {
    case "raw_grape":
      return "Uva fresca de vinificación";
    case "raw_must":
      return "Mosto de uva";
    case "byproduct":
      throw new SilicieUnspecifiedError(
        "clave y código NC concreto de orujos y lías: §6 indica 2307 / 2308 y una tabla de claves que no reproduce",
      );
    case "bulk":
      return `Vino ${colorWord(situation)} a granel en depósito`;
    case "bulk_wood":
      return `Vino ${colorWord(situation)} en crianza en barrica`;
    case "packaged":
      return packagedDescription(situation);
    default: {
      const unreachable: never = situation.productClass;
      throw new SilicieDataError(`clase de mayor desconocida: ${String(unreachable)}`);
    }
  }
}

function packagedReference(situation: LedgerSituation): string {
  if (situation.containerKind === "bottle" && situation.containerCapacityMl === 750) {
    const wine = situation.wineCode ?? "";
    if (!/^[A-Z0-9][A-Z0-9-]{0,14}$/.test(wine)) {
      throw new SilicieDataError("el código de vino de B075-<VINO> no cabe en la referencia del mayor");
    }
    const reference = `B075-${wine}`;
    if (!REFERENCE.test(reference)) {
      throw new SilicieDataError("la referencia de envasado no cumple el formato del mayor");
    }
    return reference;
  }
  if (situation.containerKind === "bib") {
    throw new SilicieUnspecifiedError(
      "referencia de producto para BIB: §6 fija el NC 2204 22 pero no la referencia ni la descripción",
    );
  }
  throw new SilicieUnspecifiedError(
    "referencia y descripción de vino envasado que no es botella de 0,75 L: §6 solo da el ejemplo B075-<VINO>",
  );
}

function packagedDescription(situation: LedgerSituation): string {
  if (situation.containerKind !== "bottle" || situation.containerCapacityMl !== 750) {
    throw new SilicieUnspecifiedError(
      "referencia y descripción de vino envasado que no es botella de 0,75 L: §6 solo da el ejemplo B075-<VINO>",
    );
  }
  const brand = situation.brand ?? "";
  if (brand.length === 0) {
    throw new SilicieDataError("falta la marca de la descripción del vino envasado");
  }
  return `Vino ${colorWord(situation)} ${brand} botella 0,75 L`;
}

function ncFor(situation: LedgerSituation, given: string | undefined): string {
  if (situation.productClass === "raw_grape") {
    if (given !== undefined && given !== "0806") {
      throw new SilicieDataError("el NC de la uva en §6 es 0806");
    }
    return "0806";
  }
  if (situation.productClass === "raw_must") {
    throw new SilicieUnspecifiedError("código NC del mosto: §6 indica 2204 o 2009, pendiente de asesor");
  }
  if (situation.productClass === "byproduct") {
    throw new SilicieUnspecifiedError(
      "clave y código NC concreto de orujos y lías: §6 indica 2307 / 2308 y una tabla de claves que no reproduce",
    );
  }
  const heading = wineHeading(situation);
  if (given === undefined) {
    throw new SilicieUnspecifiedError(
      `código NC a 8 dígitos del vino (encabezado ${heading}), pendiente de asesor (§6)`,
    );
  }
  if (!/^\d{6}(\d{2})?$/.test(given) || (given !== heading && !(given.length === 8 && given.startsWith(heading)))) {
    throw new SilicieDataError(
      `el NC ${given} no es el encabezado ${heading} de §6 ni un código de 8 dígitos que empiece por él`,
    );
  }
  return given;
}

function wineHeading(situation: LedgerSituation): string {
  if (situation.productClass === "bulk" || situation.productClass === "bulk_wood") {
    return "220429";
  }
  if (situation.productClass !== "packaged") {
    throw new SilicieDataError("encabezado NC pedido para un producto que no es vino");
  }
  if (situation.containerKind === "bottle" && situation.containerCapacityMl !== undefined && situation.containerCapacityMl <= 2000) {
    return "220421";
  }
  if (
    situation.containerKind === "bib" &&
    situation.containerCapacityMl !== undefined &&
    situation.containerCapacityMl > 2000 &&
    situation.containerCapacityMl <= 10000
  ) {
    return "220422";
  }
  throw new SilicieUnspecifiedError(
    "código NC del envasado para este formato: §6 solo fija 2204 21 hasta 2 L y 2204 22 para BIB de más de 2 L y hasta 10 L",
  );
}

function productKeyFor(productClass: LedgerProductClass): string | null {
  if (productClass === "raw_grape") {
    return "V01";
  }
  if (productClass === "raw_must") {
    return "V02";
  }
  return null;
}

function isWineClass(productClass: LedgerProductClass): boolean {
  return productClass === "bulk" || productClass === "bulk_wood" || productClass === "packaged";
}

function colorToken(situation: LedgerSituation): string {
  return colorOf(situation).toUpperCase();
}

function colorWord(situation: LedgerSituation): WineColor {
  return colorOf(situation);
}

function colorOf(situation: LedgerSituation): WineColor {
  switch (situation.color) {
    case "tinto":
    case "blanco":
    case "rosado":
      return situation.color;
    default:
      throw new SilicieDataError("falta el color del vino (tinto, blanco o rosado) para el mayor de §6");
  }
}

function asFiscalClass(productClass: LedgerProductClass): FiscalProductClass {
  if (productClass === "bulk" || productClass === "bulk_wood" || productClass === "packaged") {
    return productClass;
  }
  throw new SilicieUnspecifiedError(
    `traspaso A17/A16 de la clase ${productClass}: el movimiento fiscal solo admite granel, crianza o envasado`,
  );
}

function rejectSeparator(value: string, label: string): void {
  if (/[;"\r\n]/.test(value)) {
    throw new SilicieDataError(`${label} contiene un carácter que el CSV de §7 no dice cómo entrecomillar`);
  }
}
