// Tipos del módulo SILICIE. Columnas: inventory.fiscal_move, regulatory.silicie_ledger,
// regulatory.silicie_entry (docs/02-ddl/0007 y 0012). Reglas: docs/04-regulatorio/silicie.md.
// Las cantidades se guardan en mililitros o gramos enteros; el CSV las pasa a LTR/KGM.

import { DomainError, domainError } from "../../errors";
import { formatMadridDmy, isMadridCivilDate, madridMonthEnd, madridMonthKey } from "../../time";

/** Caso que silicie.md no cierra. HTTP 422. */
export function silicieUnspecified(caso: string): DomainError {
  return new DomainError("WC_REG_SILICIE_UNSPECIFIED", 422, caso);
}

/** Dato de entrada que no cumple el formato o la conservación. HTTP 422. */
export function silicieInvalid(message: string): DomainError {
  return new DomainError("WC_VALIDATION", 422, message);
}

/** WC122: la identificación del mayor no se edita. */
export function silicieLedgerIdentity(): DomainError {
  return domainError("WC122");
}

export type FiscalMoveType =
  | "opening"
  | "production"
  | "bulk_receipt"
  | "packaging_out_bulk"
  | "packaging_in_packaged"
  | "loss"
  | "destruction"
  | "exit_domestic"
  | "exit_export"
  | "exit_intra_eu"
  | "exit_canary"
  | "ledger_change_out"
  | "ledger_change_in"
  | "return_in"
  | "regularization_in"
  | "regularization_out"
  | "reversal";

export type FiscalProductClass = "bulk" | "bulk_wood" | "packaged";

export type LedgerProductClass =
  | "raw_grape"
  | "raw_must"
  | "bulk"
  | "bulk_wood"
  | "packaged"
  | "byproduct";

export type JustificationType =
  | "invoice"
  | "delivery_note"
  | "e_ad"
  | "customs_declaration"
  | "internal"
  | "count_record";

export type FiscalTrigger = "invoice" | "delivery_note" | "operation" | "count" | "manual";

export type WineColor = "tinto" | "blanco" | "rosado";

export type SilicieMovementCode =
  | "A01"
  | "A02"
  | "A08"
  | "A10"
  | "A11"
  | "A14"
  | "A15"
  | "A16"
  | "A17"
  | "A28"
  | "A30"
  | "A31"
  | "A32"
  | "A35"
  | "A36"
  | "A42"
  | "A43";

export type LossCode = "VB01" | "VB02" | "VB03" | "VB04" | "VB05" | "VB06";

export type OperationCode = "V01" | "V05";

export type JustificanteCode = "J01" | "J03" | "J07" | "J08" | "J09" | "J11" | "J12" | "J13";

export type IdentityDocumentType = "1" | "2" | "3" | "4";

/** Espejo de las columnas de inventory.fiscal_move que el asiento necesita. */
export interface FiscalMoveInput {
  id: string;
  taxWarehouseId: string;
  /** YYYY-MM-DD. Columna fiscal_date. */
  fiscalDate: string;
  /** YYYY-MM-DD o null. Columna physical_date. No es la fecha del asiento (§11.3). */
  physicalDate: string | null;
  moveType: FiscalMoveType;
  productClass: FiscalProductClass;
  lotId: string | null;
  productId: string | null;
  /** Mililitros con signo. Columna volume_ml. */
  volumeMl: number;
  /** Unidades con signo. Columna units. */
  units: number;
  /**
   * abv_pct × 100 (numeric(5,2)). 1350 = 13,50 %.
   * Null si el movimiento no trae grado.
   */
  abvCenti: number | null;
  /** Referencia del mayor. Columna excise_product_key. */
  exciseProductKey: string | null;
  ncCode: string | null;
  justificationType: JustificationType;
  justificationRef: string;
  counterpartyContactId: string | null;
  counterpartyExciseNumber: string | null;
  fiscalTrigger: FiscalTrigger;
  sourceTable: string;
  sourceId: string;
  sourceLineId: string | null;
  silicieEntryId: string | null;
  reversesMoveId: string | null;
  reason: string | null;
  createdBy: string;
  /** ISO-8601. Columna created_at. */
  createdAt: string;
}

/** Espejo de regulatory.silicie_ledger. La capacidad va en mililitros (columna container_capacity_l). */
export interface SilicieLedger {
  id: string;
  taxWarehouseId: string;
  reference: string;
  description: string;
  productClass: LedgerProductClass;
  epigrafe: string | null;
  epigrafeCode: string | null;
  ncCode: string;
  productKey: string | null;
  containerType: string | null;
  containerCapacityMl: number | null;
  isActive: boolean;
  validatedBy: string | null;
  createdAt: string;
}

/**
 * Situación de producto con la que se calcula la referencia del mayor (§6).
 * `labeled` no entra en la clave (§11.4).
 */
export interface LedgerSituation {
  productClass: LedgerProductClass;
  color?: WineColor;
  /** Código de vino de la referencia B075-<VINO>. */
  wineCode?: string;
  /** Marca de la descripción de ejemplo «Vino tinto <marca> botella 0,75 L». */
  brand?: string;
  containerCapacityMl?: number;
  containerKind?: "bottle" | "bib";
  labeled?: boolean;
}

export interface SilicieCounterparty {
  /** 1 NIF/NIE, 2 NIF-IVA UE, 3 otros, 4 aduana (§7 campo 16). */
  documentType: IdentityDocumentType;
  documentNumber: string;
  legalName: string;
}

export interface MoveHint {
  /** Venta al por menor: tienda de la bodega o web a consumidor (§5). */
  retail?: boolean;
  regularizationCause?: "measurement" | "prior_exercise";
  operationNumber?: string;
  previousOperationNumber?: string;
  /** Densidad × 1_000_000 (N(8,6)). */
  densityE6?: number | null;
  /** Número de asiento AEAT del asiento anulado (campo 2). */
  previousAeatEntryNumber?: string;
  annulsEntryId?: string;
  /**
   * §5: J07 si el documento es la autorización, J08 si es la diligencia.
   * Sin este dato el asiento no se puede cerrar.
   */
  destructionDocument?: "authorization" | "diligence";
  sampling?: boolean;
}

/** Hechos de §5 que no son una fila de inventory.fiscal_move. */
export type SilicieFact =
  | {
      kind: "opening";
      id: string;
      date: string;
      ledgerReference: string;
      justificationRef: string;
      massG?: number;
      volumeMl?: number;
      abvCenti?: number | null;
    }
  | {
      kind: "grape_reception";
      id: string;
      date: string;
      massG: number;
      justificationRef: string;
      counterpartyContactId?: string | null;
    }
  | {
      kind: "crushing";
      id: string;
      date: string;
      massG: number;
      justificationRef: string;
      operationNumber: string;
      sourceId: string;
    }
  | {
      kind: "elaboration_loss";
      id: string;
      date: string;
      volumeMl: number;
      ledgerReference: string;
      justificationRef: string;
      operationNumber: string;
      sourceId: string;
      abvCenti: number;
    };

export interface EntriesContext {
  exerciseId: string;
  exerciseYear: number;
  taxWarehouseId: string;
  /** Correlativo interno del primer asiento de esta tanda (local_seq ≥ 1). */
  nextLocalSeq: number;
  ledgers: readonly SilicieLedger[];
  /**
   * `monthly`: agrega las filas que §5 marca como mensuales (fecha = último día del mes).
   * `none`: un asiento por hecho. La norma dice «se pueden agregar» (§1).
   */
  aggregation: "monthly" | "none";
  /** Fecha de creación del asiento en WineCore (campo 5). YYYY-MM-DD. */
  recordedOn?: string;
  /** Nombre del establecimiento (campo 11). */
  establishmentName?: string;
  hints?: Readonly<Record<string, MoveHint>>;
  facts?: readonly SilicieFact[];
  counterparties?: Readonly<Record<string, SilicieCounterparty>>;
  /**
   * Número de justificante J13 por mes `YYYY-MM`.
   * Obligatorio al agregar ventas al por menor; §7 no dice cómo componerlo.
   */
  retailJustificationByMonth?: Readonly<Record<string, string>>;
  /** La comunicación de cierre no tiene asiento en §5–§7: si es true, error. */
  closeExercise?: boolean;
}

/** Campos oficiales del jsonb silicie_entry.fields. Cantidades enteras hasta el CSV. */
export interface SilicieOfficialFields {
  numeroReferenciaInterno: string;
  numeroAsientoPrevio: string;
  numeroAsientoPrevioReintroduccion: string;
  fechaRegistroContable: string;
  diferenciaMenos: string;
  regimenFiscal: string;
  tipoOperacion: string;
  numeroOperacion: string;
  descripcionUnidadFabricacion: string;
  codigoUnidadFabricacion: string;
  numeroOperacionFabricacionAnterior: string;
  tipoJustificante: string;
  numeroJustificante: string;
  tipoDocumentoIdentificativo: string;
  numeroDocumentoIdentificativo: string;
  razonSocial: string;
  caeSeed: string;
  epigrafe: string;
  codigoEpigrafe: string;
  codigoNc: string;
  clave: string;
  /** Valor absoluto: mililitros si LTR, gramos si KGM. */
  cantidad: number;
  unidadMedida: "LTR" | "KGM";
  descripcionProducto: string;
  referenciaProducto: string;
  densidadE6: number | null;
  gradoCenti: number | null;
  tipoEnvase: string;
  capacidadEnvaseMl: number | null;
  numeroEnvases: number | null;
  indicadorMarcasFiscales: string;
  observaciones: string;
}

/** Borrador de regulatory.silicie_entry. El id lo asigna la base al insertar. */
export interface SilicieEntryDraft {
  id: null;
  exerciseId: string;
  taxWarehouseId: string;
  localSeq: number;
  /** YYYY-MM-DD. Columna movement_date. */
  movementDate: string;
  entryKind: SilicieMovementCode;
  fields: SilicieOfficialFields;
  status: "pending";
  aeatEntryNumber: null;
  annulsEntryId: string | null;
  submissionId: null;
  createdAt: null;
  /** Movimientos fiscales que originan el asiento (el FK vive en fiscal_move). */
  fiscalMoveIds: readonly string[];
}

export interface AltaAsientosHeader {
  exerciseYear: number;
  /** CAE del establecimiento. En pruebas, el sintético ES00000V0000T. */
  cae: string;
}

export interface AltaAsientosCsv {
  bytes: Uint8Array;
  filename: string;
}

export interface VesselRef {
  kind: string;
  material: string;
}

/**
 * Lo que silicie.md no fija. El módulo no inventa el dato: o lanza
 * WC_REG_SILICIE_UNSPECIFIED o deja constancia aquí de la convención usada.
 */
export const SILICIE_OPEN_QUESTIONS = [
  "Código NC del mosto: §6 dice 2204 o 2009, pendiente del asesor.",
  "Código NC a 8 dígitos del vino: §6 fija el encabezado (2204 29, 2204 21, 2204 22) y deja los 8 dígitos pendientes. El fichero escribe el NC del mayor, sin completar dígitos.",
  "Clave y NC concreto de orujos y lías: §6 indica 2307 / 2308 y una tabla de claves que no reproduce.",
  "Referencia y descripción del envasado que no es botella de 0,75 L. El BIB tiene NC 2204 22 pero §6 no da referencia ni descripción.",
  "VB05 terminado en madera: §7 lo nombra y §6 no define un mayor distinto de la crianza en barrica. Granel en depósito → VB02, crianza → VB03, envasado → VB04.",
  "AA1 figura en la lista del campo 7 y §5 no dice cuándo se usa. No se emite.",
  "Justificante de la destrucción: J07 si el documento es la autorización y J08 si es la diligencia (§5). Sigue pendiente cuál exige el procedimiento y si hay aviso previo (§13).",
  "Régimen y justificante de la salida a Canarias (§5, Q-019).",
  "Asiento de devolución de cliente (§5, §11.2, Q-030).",
  "Régimen 4 de la venta nacional es un supuesto de §5 (Q-010). Se emite el 4 que figura en la tabla.",
  "Justificante J11 de la entrada de uva es un supuesto de §5. Se emite el J11 de la tabla.",
  "Decimales con punto: supuesto de §7. Se usa el punto.",
  "Nombre del fichero de alta: §7 no lo fija. Se usa IESA1V2-{CAE}-{ejercicio}.csv.",
  "Fin de línea y comillas: §7 no los fija. Se usa CR LF y no se entrecomilla; un valor con separador, comillas o salto de línea se rechaza.",
  "Nombres exactos de las columnas 20 a 22: §7 los agrupa como repercusión (tipo, número, razón social) y no se usan.",
  "Contraparte (campos 16 a 19) del asiento de venta al por menor con J13. Esos campos se dejan vacíos.",
  "El campo 7 es obligatorio en A30/A32. §5 también asigna tipo de pérdida a A31 y el asiento lo lleva en ese campo.",
  "Mayor del A32 de envasado: se anota en el mayor del granel de la operación. La cantidad es la diferencia de mililitros.",
  "Cantidad del A32 de elaboración: no se convierte uva (kg) a vino (L). Hace falta la merma informada, en mililitros, del mayor de vino.",
  "En la elaboración agregada, el número de justificante J09 es ELAB-AAAA-MM, el único número que da el ejemplo de §7.",
  "Formato del fichero de anulación IESX4: §4 nombra el número de asiento y el motivo (tabla MOAN: 1, 2 o 3) pero no la cabecera ni el orden. El envío manual escribe esas dos columnas; la realta sigue siendo un alta con el número de asiento previo (campo 2).",
  "Comunicación de cierre de ejercicio: §1 la exige y no hay tipo de movimiento en §5 ni columnas en §7.",
  "Salida de muestras y movimiento reversal: sin fila en §5.",
  "Cómo agregar un mes si el mismo mayor trae grados distintos, contrapartes distintas o, en la uva, justificantes distintos.",
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertIsoDate(iso: string, label: string): void {
  if (!ISO_DATE.test(iso)) {
    throw silicieInvalid(`${label} no es una fecha YYYY-MM-DD: ${iso}`);
  }
  if (!isMadridCivilDate(iso)) {
    throw silicieInvalid(`${label} no existe: ${iso}`);
  }
}

export function monthKeyOf(iso: string): string {
  assertIsoDate(iso, "fecha");
  return madridMonthKey(iso);
}

export function lastDayOfMonth(monthKey: string): string {
  try {
    return madridMonthEnd(monthKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "mes no válido";
    throw silicieInvalid(message);
  }
}

export function toDmy(iso: string): string {
  assertIsoDate(iso, "fecha");
  return formatMadridDmy(iso);
}

export function isMovementCode(value: string): value is SilicieMovementCode {
  switch (value) {
    case "A01":
    case "A02":
    case "A08":
    case "A10":
    case "A11":
    case "A14":
    case "A15":
    case "A16":
    case "A17":
    case "A28":
    case "A30":
    case "A31":
    case "A32":
    case "A35":
    case "A36":
    case "A42":
    case "A43":
      return true;
    default:
      return false;
  }
}
