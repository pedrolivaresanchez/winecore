// Asientos de §5. No presenta nada: solo devuelve borradores.
import {
  SilicieDataError,
  SilicieUnspecifiedError,
  assertIsoDate,
  lastDayOfMonth,
  monthKeyOf,
  type EntriesContext,
  type FiscalMoveInput,
  type FiscalMoveType,
  type JustificanteCode,
  type MoveHint,
  type SilicieCounterparty,
  type SilicieEntryDraft,
  type SilicieFact,
  type SilicieLedger,
  type SilicieMovementCode,
  type SilicieOfficialFields,
} from "./types";

const SIGN: Readonly<Record<SilicieMovementCode, -1 | 0 | 1>> = {
  A01: 1,
  A02: 1,
  A08: -1,
  A10: -1,
  A11: -1,
  A14: -1,
  A15: 1,
  A16: 1,
  A17: -1,
  A28: -1,
  A30: -1,
  A31: 1,
  A32: 0,
  A35: -1,
  A36: 1,
  A42: -1,
  A43: 1,
};

const KIND_RANK: Readonly<Record<SilicieMovementCode, number>> = {
  A01: 10,
  A02: 20,
  A14: 30,
  A17: 40,
  A15: 50,
  A16: 60,
  A32: 70,
  A30: 80,
  A31: 90,
  A08: 100,
  A10: 110,
  A11: 120,
  A28: 130,
  A35: 140,
  A36: 150,
  A42: 160,
  A43: 170,
};

const POSITIVE: ReadonlySet<FiscalMoveType> = new Set([
  "opening",
  "production",
  "bulk_receipt",
  "packaging_in_packaged",
  "ledger_change_in",
  "return_in",
  "regularization_in",
]);

const NEGATIVE: ReadonlySet<FiscalMoveType> = new Set([
  "packaging_out_bulk",
  "loss",
  "destruction",
  "exit_domestic",
  "exit_export",
  "exit_intra_eu",
  "exit_canary",
  "ledger_change_out",
  "regularization_out",
]);

interface Proto {
  movementDate: string;
  monthKey: string;
  aggregable: boolean;
  entryKind: SilicieMovementCode;
  ledger: SilicieLedger;
  cantidad: number;
  unidadMedida: "LTR" | "KGM";
  signedVolumeMl: number;
  gradoCenti: number | null;
  diferenciaMenos: string;
  regimenFiscal: string;
  tipoOperacion: string;
  numeroOperacion: string;
  tipoJustificante: string;
  numeroJustificante: string;
  counterparty: SilicieCounterparty | null;
  caeSeed: string;
  observaciones: string;
  numeroAsientoPrevio: string;
  annulsEntryId: string | null;
  fiscalMoveIds: string[];
  numeroEnvases: number | null;
  densidadE6: number | null;
  previousOperationNumber: string;
  sortTie: string;
}

/** Referencia interna `2027-000123` (§7 campo 1). */
export function formatLocalReference(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new SilicieDataError("el ejercicio está fuera de 2020 a 2100");
  }
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new SilicieDataError("el correlativo interno empieza en 1");
  }
  const reference = `${year}-${String(seq).padStart(6, "0")}`;
  if (reference.length > 20) {
    throw new SilicieDataError("la referencia interna supera AN 20");
  }
  return reference;
}

/**
 * Mililitros con signo que el asiento aporta al saldo fiscal del mayor.
 * A32 es informativo (sin signo). La uva está en kilogramos y no mueve el saldo fiscal.
 */
export function signedVolumeMl(entry: SilicieEntryDraft): number {
  if (entry.fields.unidadMedida !== "LTR") {
    return 0;
  }
  return SIGN[entry.entryKind] * entry.fields.cantidad;
}

export function entriesFor(moves: readonly FiscalMoveInput[], ctx: EntriesContext): SilicieEntryDraft[] {
  if (ctx.closeExercise === true) {
    throw new SilicieUnspecifiedError(
      "comunicación de cierre del ejercicio: §1 exige comunicarlo pero §5 y §7 no definen un asiento ni columnas de fichero",
    );
  }
  formatLocalReference(ctx.exerciseYear, ctx.nextLocalSeq);
  if (ctx.recordedOn !== undefined) {
    assertIsoDate(ctx.recordedOn, "fecha de registro contable");
  }
  const establishment = ctx.establishmentName ?? "";
  checkAn(establishment, 35, "descripción de la unidad de fabricación");

  const facts = ctx.facts ?? [];
  assertUniqueIds(moves.map((move) => move.id), "movimiento");
  assertUniqueIds(facts.map((fact) => fact.id), "hecho");
  const ledgers = indexLedgers(ctx);

  for (const move of moves) {
    assertMoveShape(move, ctx.taxWarehouseId);
  }
  assertSameElaborationNumber(moves, facts, ctx);

  const protos: Proto[] = [];
  for (const move of moves) {
    protos.push(mapMove(move, ctx, ledgers));
  }
  for (const fact of facts) {
    protos.push(mapFact(fact, ctx, ledgers));
  }
  protos.push(...packagingLosses(moves, ctx, ledgers));
  assertOneOpening(protos);

  const collapsed = collapse(protos, ctx);
  collapsed.sort(compareProto);

  const drafts: SilicieEntryDraft[] = [];
  for (let index = 0; index < collapsed.length; index += 1) {
    const proto = collapsed[index];
    if (proto === undefined) {
      throw new SilicieDataError("asiento ausente al numerar");
    }
    drafts.push(toDraft(proto, ctx, establishment, ctx.nextLocalSeq + index));
  }
  assertEachMoveOnce(moves, drafts);
  return drafts;
}

function assertMoveShape(move: FiscalMoveInput, taxWarehouseId: string): void {
  if (move.taxWarehouseId !== taxWarehouseId) {
    throw new SilicieDataError(`el movimiento ${move.id} es de otro establecimiento`);
  }
  if (move.silicieEntryId !== null) {
    throw new SilicieDataError(`el movimiento ${move.id} ya tiene asiento SILICIE`);
  }
  if (!Number.isSafeInteger(move.volumeMl) || move.volumeMl === 0) {
    throw new SilicieDataError(`el volumen de ${move.id} tiene que ser un entero de mililitros distinto de cero`);
  }
  if (!Number.isSafeInteger(move.units)) {
    throw new SilicieDataError(`las unidades de ${move.id} tienen que ser un entero`);
  }
  assertIsoDate(move.fiscalDate, `fecha fiscal de ${move.id}`);
  if (move.physicalDate !== null) {
    assertIsoDate(move.physicalDate, `fecha física de ${move.id}`);
  }
  if (move.moveType === "reversal") {
    throw new SilicieUnspecifiedError("movimiento fiscal reversal sin correspondencia en la tabla de §5");
  }
  if (move.reversesMoveId !== null) {
    throw new SilicieDataError(`el movimiento ${move.id} apunta a un reverso sin ser reversal`);
  }
  if (POSITIVE.has(move.moveType) && (move.volumeMl < 0 || move.units < 0)) {
    throw new SilicieDataError(`el signo del movimiento ${move.id} no coincide con su tipo`);
  }
  if (NEGATIVE.has(move.moveType) && (move.volumeMl > 0 || move.units > 0)) {
    throw new SilicieDataError(`el signo del movimiento ${move.id} no coincide con su tipo`);
  }
  if (!POSITIVE.has(move.moveType) && !NEGATIVE.has(move.moveType)) {
    throw new SilicieUnspecifiedError(`tipo de movimiento fiscal ${move.moveType} sin fila en §5`);
  }
  if (move.productClass === "packaged" && move.units === 0) {
    throw new SilicieDataError(`el envasado ${move.id} tiene que traer unidades`);
  }
  if (
    (move.moveType === "ledger_change_out" || move.moveType === "ledger_change_in") &&
    move.productClass === "packaged"
  ) {
    throw new SilicieDataError(`el cambio de mayor ${move.id} no puede ser de envasado`);
  }
  if (
    (move.moveType === "regularization_in" ||
      move.moveType === "regularization_out" ||
      move.moveType === "destruction") &&
    (move.reason === null || move.reason.trim() === "")
  ) {
    throw new SilicieDataError(`el movimiento ${move.id} exige motivo`);
  }
  if (move.exciseProductKey === null || move.exciseProductKey === "") {
    throw new SilicieDataError(`el movimiento ${move.id} no indica mayor`);
  }
}

function mapMove(move: FiscalMoveInput, ctx: EntriesContext, ledgers: ReadonlyMap<string, SilicieLedger>): Proto {
  const hint = ctx.hints?.[move.id];
  if (hint?.sampling === true && move.moveType !== "loss") {
    throw new SilicieDataError(`la marca de muestra no corresponde al movimiento ${move.id}`);
  }
  const ledger = ledgerForMove(move, ledgers);
  switch (move.moveType) {
    case "opening":
      return mapOpening(move, ledger, hint);
    case "production":
      return mapProduction(move, ledger, ctx, hint);
    case "bulk_receipt":
      return mapBulkReceipt(move, ledger, ctx, hint);
    case "packaging_out_bulk":
      return mapPackagingOut(move, ledger, ctx, hint);
    case "packaging_in_packaged":
      return mapPackagingIn(move, ledger, ctx, hint);
    case "loss":
      return mapLoss(move, ledger, hint);
    case "destruction":
      return mapDestruction(move, ledger, hint);
    case "exit_domestic":
      return mapDomestic(move, ledger, ctx, hint);
    case "exit_export":
      return mapExitWithEad(move, ledger, ctx, hint, "A11");
    case "exit_intra_eu":
      return mapExitWithEad(move, ledger, ctx, hint, "A10");
    case "exit_canary":
      throw new SilicieUnspecifiedError("régimen y justificante de la salida a Canarias (A09) (§5, Q-019)");
    case "ledger_change_out":
      return mapLedgerChange(move, ledger, hint, "A17");
    case "ledger_change_in":
      return mapLedgerChange(move, ledger, hint, "A16");
    case "return_in":
      throw new SilicieUnspecifiedError(
        "devolución de un cliente: no puede entrar en fábrica si el impuesto ya se devengó; el asiento (A24–A26 u otro) no está especificado (§5, §11.2, Q-030)",
      );
    case "regularization_in":
    case "regularization_out":
      return mapRegularization(move, ledger, hint);
    case "reversal":
      throw new SilicieUnspecifiedError("movimiento fiscal reversal sin correspondencia en la tabla de §5");
    default: {
      const unreachable: never = move.moveType;
      throw new SilicieUnspecifiedError(`tipo de movimiento fiscal ${String(unreachable)} sin fila en §5`);
    }
  }
}

function mapOpening(move: FiscalMoveInput, ledger: SilicieLedger, hint: MoveHint | undefined): Proto {
  if (move.fiscalTrigger !== "count" && move.justificationType !== "count_record") {
    throw new SilicieDataError(`la apertura ${move.id} se justifica con el aforo (J12)`);
  }
  return wineQuantity(move, ledger, hint, {
    entryKind: "A01",
    aggregable: false,
    regimenFiscal: regimenOfLedger(ledger),
    tipoJustificante: "J12",
    numeroJustificante: requireText(move.justificationRef, "número de aforo", 30),
  });
}

function mapProduction(
  move: FiscalMoveInput,
  ledger: SilicieLedger,
  ctx: EntriesContext,
  hint: MoveHint | undefined,
): Proto {
  if (move.productClass === "packaged") {
    throw new SilicieUnspecifiedError(
      "fabricación (A15 V01) de producto ya envasado: §5 reserva ese A15 al vino obtenido y el del envasado al movimiento de envasado",
    );
  }
  return wineQuantity(move, ledger, hint, {
    entryKind: "A15",
    aggregable: true,
    regimenFiscal: "2",
    tipoOperacion: "V01",
    numeroOperacion: operationNumber(move, ctx),
    tipoJustificante: "J09",
    numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
  });
}

function mapBulkReceipt(
  move: FiscalMoveInput,
  ledger: SilicieLedger,
  ctx: EntriesContext,
  hint: MoveHint | undefined,
): Proto {
  if (move.productClass === "packaged") {
    throw new SilicieUnspecifiedError("entrada de vino envasado (A02): §5 solo describe la compra a granel con e-DA");
  }
  if (move.justificationType !== "e_ad") {
    throw new SilicieDataError(`la entrada a granel ${move.id} se justifica con el e-DA (J01)`);
  }
  return wineQuantity(move, ledger, hint, {
    entryKind: "A02",
    aggregable: false,
    regimenFiscal: "2",
    tipoJustificante: "J01",
    numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
    counterparty: requireParty(move, ctx),
    caeSeed: caeOf(move),
  });
}

function mapPackagingOut(
  move: FiscalMoveInput,
  ledger: SilicieLedger,
  ctx: EntriesContext,
  hint: MoveHint | undefined,
): Proto {
  return wineQuantity(move, ledger, hint, {
    entryKind: "A14",
    aggregable: false,
    regimenFiscal: "2",
    tipoOperacion: "V05",
    numeroOperacion: operationNumber(move, ctx),
    tipoJustificante: "J09",
    numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
  });
}

function mapPackagingIn(
  move: FiscalMoveInput,
  ledger: SilicieLedger,
  ctx: EntriesContext,
  hint: MoveHint | undefined,
): Proto {
  return wineQuantity(move, ledger, hint, {
    entryKind: "A15",
    aggregable: false,
    regimenFiscal: "2",
    tipoOperacion: "V05",
    numeroOperacion: operationNumber(move, ctx),
    tipoJustificante: "J09",
    numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
  });
}

function mapLoss(move: FiscalMoveInput, ledger: SilicieLedger, hint: MoveHint | undefined): Proto {
  if (hint?.sampling === true) {
    throw new SilicieUnspecifiedError("salida de muestras sin correspondencia en la tabla de §5");
  }
  const code = storageLossCode(ledger);
  if (ledger.productClass === "packaged" && move.units === 0) {
    throw new SilicieUnspecifiedError(
      "merma de envasado sin unidades: §5 distingue la rotura (A30, con unidades) de la merma de envasado (A32)",
    );
  }
  return wineQuantity(move, ledger, hint, {
    entryKind: "A30",
    aggregable: false,
    diferenciaMenos: code,
    regimenFiscal: "2",
    tipoJustificante: storageJustificante(move),
    numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
  });
}

function mapDestruction(move: FiscalMoveInput, ledger: SilicieLedger, hint: MoveHint | undefined): Proto {
  if (hint?.destructionDocument === undefined) {
    throw new SilicieUnspecifiedError(
      "justificante de la destrucción (A28): la tabla admite J07 autorización o J08 diligencia y este movimiento no dice cuál (§5, pendiente de asesor)",
    );
  }
  const tipoJustificante: JustificanteCode = hint.destructionDocument === "authorization" ? "J07" : "J08";
  return wineQuantity(move, ledger, hint, {
    entryKind: "A28",
    aggregable: false,
    regimenFiscal: "2",
    tipoJustificante,
    numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
  });
}

function mapDomestic(
  move: FiscalMoveInput,
  ledger: SilicieLedger,
  ctx: EntriesContext,
  hint: MoveHint | undefined,
): Proto {
  if (hint?.retail === true) {
    return wineQuantity(move, ledger, hint, {
      entryKind: "A08",
      aggregable: true,
      regimenFiscal: "4",
      tipoJustificante: "J13",
      numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
    });
  }
  let tipoJustificante: JustificanteCode;
  if (move.justificationType === "invoice") {
    tipoJustificante = "J11";
  } else if (move.justificationType === "delivery_note") {
    tipoJustificante = "J03";
  } else {
    throw new SilicieUnspecifiedError(
      "venta nacional que no es al por menor: §5 la justifica con J11 si la regla es la factura y con J03 si es el albarán (Q-010)",
    );
  }
  return wineQuantity(move, ledger, hint, {
    entryKind: "A08",
    aggregable: false,
    regimenFiscal: "4",
    tipoJustificante,
    numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
    counterparty: requireParty(move, ctx),
    caeSeed: caeOf(move),
  });
}

function mapExitWithEad(
  move: FiscalMoveInput,
  ledger: SilicieLedger,
  ctx: EntriesContext,
  hint: MoveHint | undefined,
  entryKind: "A10" | "A11",
): Proto {
  if (move.justificationType !== "e_ad") {
    throw new SilicieDataError(`la salida ${move.id} se justifica con el e-DA (J01)`);
  }
  return wineQuantity(move, ledger, hint, {
    entryKind,
    aggregable: false,
    regimenFiscal: "2",
    tipoJustificante: "J01",
    numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
    counterparty: requireParty(move, ctx),
    caeSeed: caeOf(move),
  });
}

function mapLedgerChange(
  move: FiscalMoveInput,
  ledger: SilicieLedger,
  hint: MoveHint | undefined,
  entryKind: "A16" | "A17",
): Proto {
  return wineQuantity(move, ledger, hint, {
    entryKind,
    aggregable: false,
    regimenFiscal: "2",
    tipoJustificante: "J09",
    numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
  });
}

function mapRegularization(move: FiscalMoveInput, ledger: SilicieLedger, hint: MoveHint | undefined): Proto {
  const outbound = move.moveType === "regularization_out";
  const byCount = move.fiscalTrigger === "count" || move.justificationType === "count_record";
  const byManual = move.fiscalTrigger === "manual";
  if (byCount && (byManual || hint?.regularizationCause !== undefined)) {
    throw new SilicieDataError(`la regularización ${move.id} mezcla aforo y corrección manual`);
  }
  if (byCount) {
    return wineQuantity(move, ledger, hint, {
      entryKind: outbound ? "A30" : "A31",
      aggregable: false,
      diferenciaMenos: storageLossCode(ledger),
      regimenFiscal: "2",
      tipoJustificante: "J12",
      numeroJustificante: requireText(move.justificationRef, "número de aforo", 30),
    });
  }
  if (!byManual) {
    throw new SilicieUnspecifiedError(
      `regularización con disparador ${move.fiscalTrigger}: §5 distingue aforo, medición sin aforo y ejercicio anterior`,
    );
  }
  if (hint?.regularizationCause === "measurement") {
    return wineQuantity(move, ledger, hint, {
      entryKind: outbound ? "A35" : "A36",
      aggregable: false,
      regimenFiscal: "2",
      tipoJustificante: "J11",
      numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
      observaciones: requireText(move.reason ?? "", "observaciones", 350),
    });
  }
  if (hint?.regularizationCause === "prior_exercise") {
    return wineQuantity(move, ledger, hint, {
      entryKind: outbound ? "A42" : "A43",
      aggregable: false,
      regimenFiscal: "2",
      tipoJustificante: "J11",
      numeroJustificante: requireText(move.justificationRef, "número de justificante", 30),
      observaciones: requireText(move.reason ?? "", "observaciones", 350),
    });
  }
  throw new SilicieUnspecifiedError(
    "regularización manual: §5 no dice si es medición sin aforo (A35/A36) o un ejercicio anterior (A42/A43)",
  );
}

interface QuantitySpec {
  entryKind: SilicieMovementCode;
  aggregable: boolean;
  regimenFiscal: string;
  tipoJustificante: string;
  numeroJustificante: string;
  diferenciaMenos?: string;
  tipoOperacion?: string;
  numeroOperacion?: string;
  counterparty?: SilicieCounterparty | null;
  caeSeed?: string;
  observaciones?: string;
}

function wineQuantity(
  move: FiscalMoveInput,
  ledger: SilicieLedger,
  hint: MoveHint | undefined,
  spec: QuantitySpec,
): Proto {
  const proto = blankProto({
    movementDate: move.fiscalDate,
    aggregable: spec.aggregable,
    entryKind: spec.entryKind,
    ledger,
    cantidad: Math.abs(move.volumeMl),
    unidadMedida: "LTR",
    signedVolumeMl: move.volumeMl,
    gradoCenti: gradoOf(move, ledger),
    diferenciaMenos: spec.diferenciaMenos ?? "",
    regimenFiscal: spec.regimenFiscal,
    tipoOperacion: spec.tipoOperacion ?? "",
    numeroOperacion: spec.numeroOperacion ?? "",
    tipoJustificante: spec.tipoJustificante,
    numeroJustificante: spec.numeroJustificante,
    counterparty: spec.counterparty ?? null,
    caeSeed: spec.caeSeed ?? "",
    observaciones: spec.observaciones ?? "",
    fiscalMoveIds: [move.id],
    numeroEnvases: packagedUnits(move, ledger),
    sortTie: `move:${move.id}`,
  });
  attachHint(proto, hint);
  return proto;
}

function mapFact(fact: SilicieFact, ctx: EntriesContext, ledgers: ReadonlyMap<string, SilicieLedger>): Proto {
  switch (fact.kind) {
    case "opening":
      return mapGrapeOpening(fact, ledgers);
    case "grape_reception":
      return mapGrapeReception(fact, ctx, ledgers);
    case "crushing":
      return mapCrushing(fact, ledgers);
    case "elaboration_loss":
      return mapElaborationLoss(fact, ledgers);
    default: {
      const unreachable: never = fact;
      throw new SilicieUnspecifiedError(`hecho sin fila en §5: ${String(unreachable)}`);
    }
  }
}

function mapGrapeOpening(fact: Extract<SilicieFact, { kind: "opening" }>, ledgers: ReadonlyMap<string, SilicieLedger>): Proto {
  if (fact.ledgerReference === "MOSTO") {
    throw new SilicieUnspecifiedError("código NC del mosto: §6 indica 2204 o 2009, pendiente de asesor");
  }
  if (fact.ledgerReference === "LIAS" || fact.ledgerReference === "ORUJO") {
    throw new SilicieUnspecifiedError(
      "clave y código NC concreto de orujos y lías: §6 indica 2307 / 2308 y una tabla de claves que no reproduce",
    );
  }
  if (fact.ledgerReference !== "UVA") {
    throw new SilicieDataError(
      `la apertura que no es un movimiento fiscal solo está definida para la uva (se pidió ${fact.ledgerReference})`,
    );
  }
  const ledger = requireLedger(ledgers, "UVA");
  if (ledger.productClass !== "raw_grape") {
    throw new SilicieDataError("el mayor UVA no es de uva");
  }
  assertIsoDate(fact.date, `apertura ${fact.id}`);
  if (fact.volumeMl !== undefined) {
    throw new SilicieDataError("la apertura de uva se mide en gramos");
  }
  return blankProto({
    movementDate: fact.date,
    aggregable: false,
    entryKind: "A01",
    ledger,
    cantidad: positiveInt(fact.massG, `masa de ${fact.id}`),
    unidadMedida: "KGM",
    signedVolumeMl: 0,
    gradoCenti: null,
    regimenFiscal: "1",
    tipoJustificante: "J12",
    numeroJustificante: requireText(fact.justificationRef, "número de aforo", 30),
    sortTie: `fact:${fact.id}`,
  });
}

function mapGrapeReception(
  fact: Extract<SilicieFact, { kind: "grape_reception" }>,
  ctx: EntriesContext,
  ledgers: ReadonlyMap<string, SilicieLedger>,
): Proto {
  const ledger = requireLedger(ledgers, "UVA");
  if (ledger.productClass !== "raw_grape") {
    throw new SilicieDataError("el mayor UVA no es de uva");
  }
  assertIsoDate(fact.date, `recepción de uva ${fact.id}`);
  let counterparty: SilicieCounterparty | null = null;
  if (fact.counterpartyContactId != null && fact.counterpartyContactId !== "") {
    counterparty = partyById(fact.counterpartyContactId, ctx, fact.id);
  }
  return blankProto({
    movementDate: fact.date,
    aggregable: true,
    entryKind: "A02",
    ledger,
    cantidad: positiveInt(fact.massG, `masa de ${fact.id}`),
    unidadMedida: "KGM",
    signedVolumeMl: 0,
    gradoCenti: null,
    regimenFiscal: "1",
    tipoJustificante: "J11",
    numeroJustificante: requireText(fact.justificationRef, "número de justificante", 30),
    counterparty,
    sortTie: `fact:${fact.id}`,
  });
}

function mapCrushing(fact: Extract<SilicieFact, { kind: "crushing" }>, ledgers: ReadonlyMap<string, SilicieLedger>): Proto {
  const ledger = requireLedger(ledgers, "UVA");
  if (ledger.productClass !== "raw_grape") {
    throw new SilicieDataError("el mayor UVA no es de uva");
  }
  assertIsoDate(fact.date, `prensado ${fact.id}`);
  return blankProto({
    movementDate: fact.date,
    aggregable: true,
    entryKind: "A14",
    ledger,
    cantidad: positiveInt(fact.massG, `masa de ${fact.id}`),
    unidadMedida: "KGM",
    signedVolumeMl: 0,
    gradoCenti: null,
    regimenFiscal: "1",
    tipoOperacion: "V01",
    numeroOperacion: requireText(fact.operationNumber, "número de operación", 30),
    tipoJustificante: "J09",
    numeroJustificante: requireText(fact.justificationRef, "número de justificante", 30),
    sortTie: `fact:${fact.id}`,
  });
}

function mapElaborationLoss(
  fact: Extract<SilicieFact, { kind: "elaboration_loss" }>,
  ledgers: ReadonlyMap<string, SilicieLedger>,
): Proto {
  const ledger = requireLedger(ledgers, fact.ledgerReference);
  if (!isWine(ledger)) {
    throw new SilicieDataError("la diferencia de elaboración (A32) se anota en un mayor de vino");
  }
  assertIsoDate(fact.date, `diferencia de elaboración ${fact.id}`);
  if (!Number.isSafeInteger(fact.abvCenti) || fact.abvCenti < 0 || fact.abvCenti > 2500) {
    throw new SilicieDataError(`falta el grado de la diferencia de elaboración ${fact.id}`);
  }
  return blankProto({
    movementDate: fact.date,
    aggregable: true,
    entryKind: "A32",
    ledger,
    cantidad: positiveInt(fact.volumeMl, `merma de elaboración ${fact.id}`),
    unidadMedida: "LTR",
    signedVolumeMl: 0,
    gradoCenti: fact.abvCenti,
    diferenciaMenos: "VB01",
    regimenFiscal: "2",
    tipoOperacion: "V01",
    numeroOperacion: requireText(fact.operationNumber, "número de operación", 30),
    tipoJustificante: "J09",
    numeroJustificante: requireText(fact.justificationRef, "número de justificante", 30),
    sortTie: `fact:${fact.id}`,
  });
}

function packagingLosses(
  moves: readonly FiscalMoveInput[],
  ctx: EntriesContext,
  ledgers: ReadonlyMap<string, SilicieLedger>,
): Proto[] {
  const bySource = new Map<string, FiscalMoveInput[]>();
  for (const move of moves) {
    if (move.moveType !== "packaging_out_bulk" && move.moveType !== "packaging_in_packaged") {
      continue;
    }
    const group = bySource.get(move.sourceId);
    if (group === undefined) {
      bySource.set(move.sourceId, [move]);
    } else {
      group.push(move);
    }
  }
  const losses: Proto[] = [];
  for (const [sourceId, group] of bySource) {
    const outs = group.filter((move) => move.moveType === "packaging_out_bulk");
    const ins = group.filter((move) => move.moveType === "packaging_in_packaged");
    if (outs.length === 0 || ins.length === 0) {
      throw new SilicieDataError(`el envasado ${sourceId} tiene que tener salida de granel y entrada de envasado`);
    }
    const outRefs = new Set(outs.map((move) => move.exciseProductKey));
    const inRefs = new Set(ins.map((move) => move.exciseProductKey));
    if (outRefs.size !== 1 || inRefs.size !== 1) {
      throw new SilicieUnspecifiedError(
        "merma de envasado con varios mayores de granel o de producto envasado (§5)",
      );
    }
    const firstOut = outs[0];
    const firstIn = ins[0];
    if (firstOut === undefined || firstIn === undefined) {
      throw new SilicieDataError(`el envasado ${sourceId} está vacío`);
    }
    const op = operationNumber(firstOut, ctx);
    const ref = requireText(firstOut.justificationRef, "número de justificante", 30);
    for (const move of group) {
      if (operationNumber(move, ctx) !== op) {
        throw new SilicieDataError(`el A14 y el A15 del envasado ${sourceId} deben llevar el mismo número de operación (§5)`);
      }
      if (move.fiscalDate !== firstOut.fiscalDate) {
        throw new SilicieDataError(`el envasado ${sourceId} tiene fechas fiscales distintas`);
      }
    }
    const grado = gradoOf(firstOut, ledgerForMove(firstOut, ledgers));
    for (const move of outs) {
      if (move.abvCenti !== grado) {
        throw new SilicieUnspecifiedError(
          "grado alcohólico de la merma de envasado (A32) cuando los movimientos de granel no comparten grado",
        );
      }
    }
    const outMl = outs.reduce((sum, move) => sum + Math.abs(move.volumeMl), 0);
    const inMl = ins.reduce((sum, move) => sum + Math.abs(move.volumeMl), 0);
    const diff = outMl - inMl;
    if (diff < 0) {
      throw new SilicieDataError(`el envasado ${sourceId} obtiene más volumen del que sale de granel`);
    }
    if (diff === 0) {
      continue;
    }
    const ledger = ledgerForMove(firstOut, ledgers);
    losses.push(
      blankProto({
        movementDate: firstOut.fiscalDate,
        aggregable: false,
        entryKind: "A32",
        ledger,
        cantidad: diff,
        unidadMedida: "LTR",
        signedVolumeMl: 0,
        gradoCenti: grado,
        diferenciaMenos: "VB06",
        regimenFiscal: "2",
        tipoOperacion: "V05",
        numeroOperacion: op,
        tipoJustificante: "J09",
        numeroJustificante: ref,
        sortTie: `a32:${sourceId}`,
      }),
    );
  }
  return losses;
}

function collapse(protos: readonly Proto[], ctx: EntriesContext): Proto[] {
  if (ctx.aggregation === "none") {
    return protos.map(cloneProto);
  }
  const groups = new Map<string, Proto>();
  const order: Proto[] = [];
  for (const original of protos) {
    if (!original.aggregable) {
      order.push(cloneProto(original));
      continue;
    }
    const key = groupKey(original);
    const existing = groups.get(key);
    if (existing === undefined) {
      const created = cloneProto(original);
      applyAggregateIdentity(created, ctx);
      groups.set(key, created);
      order.push(created);
      continue;
    }
    mergeInto(existing, original);
  }
  return order;
}

function applyAggregateIdentity(proto: Proto, ctx: EntriesContext): void {
  proto.movementDate = lastDayOfMonth(proto.monthKey);
  if (proto.tipoOperacion === "V01") {
    const number = elaborationNumber(proto.monthKey);
    proto.numeroOperacion = number;
    proto.numeroJustificante = number;
  }
  if (proto.entryKind === "A08") {
    const ref = ctx.retailJustificationByMonth?.[proto.monthKey];
    if (ref === undefined || ref === "") {
      throw new SilicieUnspecifiedError(
        "número de justificante J13 del asiento mensual de venta al por menor (§5, §7)",
      );
    }
    proto.numeroJustificante = requireText(ref, "número de justificante", 30);
    proto.counterparty = null;
    proto.caeSeed = "";
  }
}

function mergeInto(target: Proto, extra: Proto): void {
  if (target.gradoCenti !== extra.gradoCenti) {
    throw new SilicieUnspecifiedError(
      "agregar en un asiento mensual vinos del mismo mayor con grado alcohólico distinto (§5, §7)",
    );
  }
  if (target.densidadE6 !== extra.densidadE6) {
    target.densidadE6 = null;
  }
  if (target.unidadMedida !== extra.unidadMedida) {
    throw new SilicieDataError("no se pueden agregar unidades de medida distintas");
  }
  if (extra.entryKind !== "A08") {
    if (!sameParty(target.counterparty, extra.counterparty) || target.caeSeed !== extra.caeSeed) {
      throw new SilicieUnspecifiedError("datos de contraparte al agregar asientos del mismo mayor y mes (§5, §7)");
    }
    if (target.tipoOperacion !== "V01" && target.numeroJustificante !== extra.numeroJustificante) {
      throw new SilicieUnspecifiedError(
        "número de justificante al agregar entradas de materia prima con distintos documentos (§5, §7)",
      );
    }
  }
  target.cantidad += extra.cantidad;
  target.signedVolumeMl += extra.signedVolumeMl;
  if (extra.numeroEnvases !== null) {
    target.numeroEnvases = (target.numeroEnvases ?? 0) + extra.numeroEnvases;
  }
  target.fiscalMoveIds.push(...extra.fiscalMoveIds);
}

function toDraft(proto: Proto, ctx: EntriesContext, establishment: string, localSeq: number): SilicieEntryDraft {
  if (!Number.isSafeInteger(proto.cantidad) || proto.cantidad <= 0) {
    throw new SilicieDataError("la cantidad del asiento tiene que ser un entero positivo");
  }
  if (proto.unidadMedida === "LTR" && proto.entryKind !== "A32") {
    if (SIGN[proto.entryKind] * proto.cantidad !== proto.signedVolumeMl) {
      throw new SilicieDataError(`invariante de signo rota en ${proto.entryKind} ${proto.ledger.reference}`);
    }
  }
  if (proto.entryKind === "A32" && proto.signedVolumeMl !== 0) {
    throw new SilicieDataError("el A32 es informativo y no mueve el saldo");
  }
  if (proto.numeroEnvases !== null && (proto.numeroEnvases < 0 || proto.numeroEnvases > 999999)) {
    throw new SilicieDataError("el número de envases supera N(6)");
  }
  const wine = isWine(proto.ledger);
  if (wine && (proto.ledger.epigrafe === null || proto.ledger.epigrafeCode === null)) {
    throw new SilicieDataError(`el mayor de vino ${proto.ledger.reference} no tiene epígrafe`);
  }
  if (wine && proto.gradoCenti === null) {
    throw new SilicieDataError(`falta el grado alcohólico del mayor ${proto.ledger.reference}`);
  }
  let tipoEnvase = "";
  let capacidadEnvaseMl: number | null = null;
  if (proto.ledger.productClass === "packaged") {
    if (proto.ledger.containerType === null || proto.ledger.containerCapacityMl === null || proto.numeroEnvases === null) {
      throw new SilicieDataError(`el asiento de ${proto.ledger.reference} no tiene tipo, capacidad o número de envases`);
    }
    tipoEnvase = proto.ledger.containerType;
    capacidadEnvaseMl = proto.ledger.containerCapacityMl;
  }
  const party = partyFields(proto.counterparty);
  const fields: SilicieOfficialFields = {
    numeroReferenciaInterno: formatLocalReference(ctx.exerciseYear, localSeq),
    numeroAsientoPrevio: proto.numeroAsientoPrevio,
    numeroAsientoPrevioReintroduccion: "",
    fechaRegistroContable: ctx.recordedOn ?? "",
    diferenciaMenos: proto.diferenciaMenos,
    regimenFiscal: proto.regimenFiscal,
    tipoOperacion: proto.tipoOperacion,
    numeroOperacion: proto.numeroOperacion,
    descripcionUnidadFabricacion: establishment,
    codigoUnidadFabricacion: "",
    numeroOperacionFabricacionAnterior: proto.previousOperationNumber,
    tipoJustificante: proto.tipoJustificante,
    numeroJustificante: proto.numeroJustificante,
    tipoDocumentoIdentificativo: party.tipo,
    numeroDocumentoIdentificativo: party.numero,
    razonSocial: party.razon,
    caeSeed: proto.caeSeed,
    epigrafe: proto.ledger.epigrafe ?? "",
    codigoEpigrafe: proto.ledger.epigrafeCode ?? "",
    codigoNc: proto.ledger.ncCode,
    clave: proto.ledger.productKey ?? "",
    cantidad: proto.cantidad,
    unidadMedida: proto.unidadMedida,
    descripcionProducto: proto.ledger.description,
    referenciaProducto: proto.ledger.reference,
    densidadE6: proto.densidadE6,
    gradoCenti: proto.gradoCenti,
    tipoEnvase,
    capacidadEnvaseMl,
    numeroEnvases: proto.numeroEnvases,
    indicadorMarcasFiscales: "",
    observaciones: proto.observaciones,
  };
  return {
    id: null,
    exerciseId: ctx.exerciseId,
    taxWarehouseId: ctx.taxWarehouseId,
    localSeq,
    movementDate: proto.movementDate,
    entryKind: proto.entryKind,
    fields,
    status: "pending",
    aeatEntryNumber: null,
    annulsEntryId: proto.annulsEntryId,
    submissionId: null,
    createdAt: null,
    fiscalMoveIds: proto.fiscalMoveIds.slice().sort(),
  };
}

function blankProto(args: {
  movementDate: string;
  aggregable: boolean;
  entryKind: SilicieMovementCode;
  ledger: SilicieLedger;
  cantidad: number;
  unidadMedida: "LTR" | "KGM";
  signedVolumeMl: number;
  gradoCenti: number | null;
  diferenciaMenos?: string;
  regimenFiscal: string;
  tipoOperacion?: string;
  numeroOperacion?: string;
  tipoJustificante: string;
  numeroJustificante: string;
  counterparty?: SilicieCounterparty | null;
  caeSeed?: string;
  observaciones?: string;
  fiscalMoveIds?: string[];
  numeroEnvases?: number | null;
  sortTie: string;
}): Proto {
  assertIsoDate(args.movementDate, "fecha del asiento");
  return {
    movementDate: args.movementDate,
    monthKey: monthKeyOf(args.movementDate),
    aggregable: args.aggregable,
    entryKind: args.entryKind,
    ledger: args.ledger,
    cantidad: args.cantidad,
    unidadMedida: args.unidadMedida,
    signedVolumeMl: args.signedVolumeMl,
    gradoCenti: args.gradoCenti,
    diferenciaMenos: args.diferenciaMenos ?? "",
    regimenFiscal: args.regimenFiscal,
    tipoOperacion: args.tipoOperacion ?? "",
    numeroOperacion: args.numeroOperacion ?? "",
    tipoJustificante: args.tipoJustificante,
    numeroJustificante: args.numeroJustificante,
    counterparty: args.counterparty ?? null,
    caeSeed: args.caeSeed ?? "",
    observaciones: args.observaciones ?? "",
    numeroAsientoPrevio: "",
    annulsEntryId: null,
    fiscalMoveIds: args.fiscalMoveIds ?? [],
    numeroEnvases: args.numeroEnvases ?? null,
    densidadE6: null,
    previousOperationNumber: "",
    sortTie: args.sortTie,
  };
}

function attachHint(proto: Proto, hint: MoveHint | undefined): void {
  if (hint === undefined) {
    return;
  }
  if (hint.previousAeatEntryNumber !== undefined) {
    proto.numeroAsientoPrevio = requireText(hint.previousAeatEntryNumber, "número de asiento previo", 35);
  }
  if (hint.annulsEntryId !== undefined) {
    proto.annulsEntryId = hint.annulsEntryId;
  }
  if (hint.previousOperationNumber !== undefined) {
    proto.previousOperationNumber = requireText(hint.previousOperationNumber, "número de operación anterior", 30);
  }
  if (hint.densityE6 != null) {
    if (!Number.isSafeInteger(hint.densityE6) || hint.densityE6 < 0) {
      throw new SilicieDataError("la densidad tiene que ser un entero ≥ 0 escalado por 1.000.000");
    }
    proto.densidadE6 = hint.densityE6;
  }
}

function packagedUnits(move: FiscalMoveInput, ledger: SilicieLedger): number | null {
  if (ledger.productClass !== "packaged") {
    return null;
  }
  const capacity = ledger.containerCapacityMl;
  if (capacity === null || ledger.containerType === null || capacity <= 0) {
    throw new SilicieDataError(`el mayor ${ledger.reference} de envasado no tiene envase`);
  }
  const units = Math.abs(move.units);
  if (units === 0 || Math.abs(move.volumeMl) !== units * capacity) {
    throw new SilicieDataError(`volumen y envases no cuadran en ${move.id}`);
  }
  if (units > 999999) {
    throw new SilicieDataError(`el número de envases de ${move.id} supera N(6)`);
  }
  return units;
}

function gradoOf(move: FiscalMoveInput, ledger: SilicieLedger): number | null {
  if (!isWine(ledger)) {
    if (move.abvCenti !== null) {
      throw new SilicieDataError(`el mayor ${ledger.reference} no es vino y trae grado`);
    }
    return null;
  }
  if (move.abvCenti === null || !Number.isSafeInteger(move.abvCenti) || move.abvCenti < 0 || move.abvCenti > 2500) {
    throw new SilicieDataError(`falta el grado alcohólico o está fuera de 0 a 25 en ${move.id}`);
  }
  return move.abvCenti;
}

function storageLossCode(ledger: SilicieLedger): "VB02" | "VB03" | "VB04" {
  switch (ledger.productClass) {
    case "bulk":
      return "VB02";
    case "bulk_wood":
      return "VB03";
    case "packaged":
      return "VB04";
    default:
      throw new SilicieUnspecifiedError(
        `tipo de pérdida de almacenamiento para la clase ${ledger.productClass} (§5, §7)`,
      );
  }
}

function storageJustificante(move: FiscalMoveInput): "J09" | "J12" {
  const byCount = move.fiscalTrigger === "count" || move.justificationType === "count_record";
  const byOperation = move.fiscalTrigger === "operation" || move.justificationType === "internal";
  if (byCount && byOperation) {
    throw new SilicieDataError(`el movimiento ${move.id} mezcla aforo y operación`);
  }
  if (byCount) {
    return "J12";
  }
  if (byOperation) {
    return "J09";
  }
  throw new SilicieUnspecifiedError(
    "justificante de la merma de almacenamiento: §5 admite J09 o J12 y este movimiento no es ni operación ni aforo",
  );
}

function regimenOfLedger(ledger: SilicieLedger): "1" | "2" {
  if (
    ledger.productClass === "raw_grape" ||
    ledger.productClass === "raw_must" ||
    ledger.productClass === "byproduct"
  ) {
    return "1";
  }
  return "2";
}

function isWine(ledger: SilicieLedger): boolean {
  return ledger.productClass === "bulk" || ledger.productClass === "bulk_wood" || ledger.productClass === "packaged";
}

function operationNumber(move: FiscalMoveInput, ctx: EntriesContext): string {
  const hinted = ctx.hints?.[move.id]?.operationNumber;
  return requireText(hinted ?? move.justificationRef, "número de operación", 30);
}

function requireParty(move: FiscalMoveInput, ctx: EntriesContext): SilicieCounterparty {
  if (move.counterpartyContactId === null || move.counterpartyContactId === "") {
    throw new SilicieDataError(`falta la contraparte del movimiento ${move.id} (campos 16 a 18)`);
  }
  return partyById(move.counterpartyContactId, ctx, move.id);
}

function partyById(id: string, ctx: EntriesContext, owner: string): SilicieCounterparty {
  const party = ctx.counterparties?.[id];
  if (party === undefined) {
    throw new SilicieDataError(`no está la contraparte ${id} de ${owner}`);
  }
  if (party.documentType !== "1" && party.documentType !== "2" && party.documentType !== "3" && party.documentType !== "4") {
    throw new SilicieDataError("tipo de documento identificativo fuera de la lista de §7");
  }
  requireText(party.documentNumber, "número de documento", 15);
  requireText(party.legalName, "razón social", 125);
  return party;
}

function caeOf(move: FiscalMoveInput): string {
  if (move.counterpartyExciseNumber === null || move.counterpartyExciseNumber === "") {
    return "";
  }
  return requireText(move.counterpartyExciseNumber, "CAE o SEED", 13);
}

function partyFields(party: SilicieCounterparty | null): { tipo: string; numero: string; razon: string } {
  if (party === null) {
    return { tipo: "", numero: "", razon: "" };
  }
  return { tipo: party.documentType, numero: party.documentNumber, razon: party.legalName };
}

function ledgerForMove(move: FiscalMoveInput, ledgers: ReadonlyMap<string, SilicieLedger>): SilicieLedger {
  const key = move.exciseProductKey;
  if (key === null) {
    throw new SilicieDataError(`el movimiento ${move.id} no indica mayor`);
  }
  const ledger = requireLedger(ledgers, key);
  if (ledger.productClass !== move.productClass) {
    throw new SilicieDataError(`la clase del movimiento ${move.id} no coincide con el mayor ${ledger.reference}`);
  }
  if (move.ncCode !== null && move.ncCode !== ledger.ncCode) {
    throw new SilicieDataError(`el NC del movimiento ${move.id} no coincide con el mayor ${ledger.reference}`);
  }
  return ledger;
}

function requireLedger(ledgers: ReadonlyMap<string, SilicieLedger>, reference: string): SilicieLedger {
  const ledger = ledgers.get(reference);
  if (ledger === undefined) {
    throw new SilicieDataError(`no existe el mayor ${reference}`);
  }
  return ledger;
}

function indexLedgers(ctx: EntriesContext): Map<string, SilicieLedger> {
  const map = new Map<string, SilicieLedger>();
  for (const ledger of ctx.ledgers) {
    if (ledger.taxWarehouseId !== ctx.taxWarehouseId) {
      throw new SilicieDataError(`el mayor ${ledger.reference} es de otro establecimiento`);
    }
    if (map.has(ledger.reference)) {
      throw new SilicieDataError(`mayor duplicado: ${ledger.reference}`);
    }
    map.set(ledger.reference, ledger);
  }
  return map;
}

function assertSameElaborationNumber(
  moves: readonly FiscalMoveInput[],
  facts: readonly SilicieFact[],
  ctx: EntriesContext,
): void {
  const productionBySource = new Map<string, string>();
  for (const move of moves) {
    if (move.moveType !== "production") {
      continue;
    }
    const number = operationNumber(move, ctx);
    const previous = productionBySource.get(move.sourceId);
    if (previous !== undefined && previous !== number) {
      throw new SilicieDataError(`la elaboración ${move.sourceId} mezcla números de operación`);
    }
    productionBySource.set(move.sourceId, number);
  }
  for (const fact of facts) {
    if (fact.kind !== "crushing" && fact.kind !== "elaboration_loss") {
      continue;
    }
    const production = productionBySource.get(fact.sourceId);
    if (production !== undefined && production !== fact.operationNumber) {
      throw new SilicieDataError(
        `el A14 y el A15 de la elaboración ${fact.sourceId} deben llevar el mismo número de operación (§5)`,
      );
    }
  }
}

function assertOneOpening(protos: readonly Proto[]): void {
  const seen = new Set<string>();
  for (const proto of protos) {
    if (proto.entryKind !== "A01") {
      continue;
    }
    if (seen.has(proto.ledger.reference)) {
      throw new SilicieDataError(`la apertura es una por mayor (§5): ${proto.ledger.reference}`);
    }
    seen.add(proto.ledger.reference);
  }
}

function assertEachMoveOnce(moves: readonly FiscalMoveInput[], drafts: readonly SilicieEntryDraft[]): void {
  const seen = new Set<string>();
  for (const draft of drafts) {
    for (const id of draft.fiscalMoveIds) {
      if (seen.has(id)) {
        throw new SilicieDataError(`el movimiento ${id} queda en dos asientos`);
      }
      seen.add(id);
    }
  }
  for (const move of moves) {
    if (!seen.has(move.id)) {
      throw new SilicieDataError(`el movimiento ${move.id} no tiene asiento`);
    }
  }
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new SilicieDataError(`${label} duplicado: ${id}`);
    }
    seen.add(id);
  }
}

function groupKey(proto: Proto): string {
  return [
    proto.monthKey,
    proto.entryKind,
    proto.ledger.reference,
    proto.tipoOperacion,
    proto.diferenciaMenos,
    proto.regimenFiscal,
    proto.tipoJustificante,
  ].join("|");
}

function elaborationNumber(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const year = match?.[1];
  const month = match?.[2];
  if (year === undefined || month === undefined) {
    throw new SilicieDataError(`mes no válido: ${monthKey}`);
  }
  return `ELAB-${year}-${month}`;
}

function compareProto(a: Proto, b: Proto): number {
  const idsA = a.fiscalMoveIds.slice().sort().join(",");
  const idsB = b.fiscalMoveIds.slice().sort().join(",");
  return (
    cmp(a.movementDate, b.movementDate) ||
    cmp(a.numeroOperacion, b.numeroOperacion) ||
    cmp(a.numeroJustificante, b.numeroJustificante) ||
    cmp(KIND_RANK[a.entryKind], KIND_RANK[b.entryKind]) ||
    cmp(a.ledger.reference, b.ledger.reference) ||
    cmp(idsA, idsB) ||
    cmp(a.sortTie, b.sortTie)
  );
}

function cloneProto(proto: Proto): Proto {
  return {
    ...proto,
    fiscalMoveIds: proto.fiscalMoveIds.slice(),
    counterparty: proto.counterparty === null ? null : { ...proto.counterparty },
  };
}

function sameParty(a: SilicieCounterparty | null, b: SilicieCounterparty | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.documentType === b.documentType && a.documentNumber === b.documentNumber && a.legalName === b.legalName;
}

function positiveInt(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    throw new SilicieDataError(`${label} tiene que ser un entero positivo`);
  }
  return value;
}

function requireText(value: string, label: string, max: number): string {
  if (value === "") {
    throw new SilicieDataError(`falta ${label}`);
  }
  checkAn(value, max, label);
  return value;
}

function checkAn(value: string, max: number, label: string): void {
  if (value.length > max) {
    throw new SilicieDataError(`${label} supera AN ${max}`);
  }
  if (/[;"\r\n]/.test(value)) {
    throw new SilicieDataError(`${label} contiene un carácter que el CSV de §7 no dice cómo entrecomillar`);
  }
}

function cmp(a: string | number, b: string | number): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
