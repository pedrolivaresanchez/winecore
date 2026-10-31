// CSV «Alta de asientos» IESA1 V2 (§7). No presenta nada.
import { formatLocalReference } from "./entries";
import {
  silicieInvalid,
  toDmy,
  type AltaAsientosCsv,
  type AltaAsientosHeader,
  type SilicieEntryDraft,
  type SilicieMovementCode,
} from "./types";

/** Nombres de §7. Las columnas 20–22 y 34–37 no vienen desglosadas: se usa la glosa de la tabla. */
export const IESA1_V2_COLUMNS = [
  "Número Referencia Interno",
  "Número Asiento Previo",
  "Número Asiento Previo Reintroducción",
  "Fecha Movimiento",
  "Fecha Registro Contable",
  "Tipo Movimiento",
  "Información adicional Diferencia en Menos",
  "Régimen Fiscal",
  "Tipo de Operación",
  "Número Operación",
  "Descripción Unidad de Fabricación",
  "Código Unidad de Fabricación",
  "Número de operación fabricación anterior",
  "Tipo Justificante",
  "Número Justificante",
  "Tipo Documento Identificativo",
  "Número Documento Identificativo",
  "Razón Social",
  "CAE/Número SEED",
  "Repercusión tipo",
  "Repercusión número",
  "Repercusión razón social",
  "Epígrafe",
  "Código Epígrafe",
  "Código NC",
  "Clave",
  "Cantidad",
  "Unidad de Medida",
  "Descripción de Producto",
  "Referencia Producto",
  "Densidad",
  "Grado Alcohólico",
  "Cantidad de Alcohol Puro",
  "Extracto",
  "kg extracto",
  "grado Plato",
  "grado acético",
  "Tipo de Envase",
  "Capacidad de Envase",
  "Número de Envases",
  "Indicador de Marcas Fiscales",
  "Observaciones",
] as const;

/** §7 no fija el fin de línea. Convención de este módulo: CR LF. */
export const CSV_LINE_ENDING = "\r\n";

const CAE = /^ES[0-9A-Z]{11}$/;

export function altaAsientosFilename(header: AltaAsientosHeader): string {
  if (!Number.isInteger(header.exerciseYear) || header.exerciseYear < 2020 || header.exerciseYear > 2100) {
    throw silicieInvalid("el ejercicio del fichero está fuera de 2020 a 2100");
  }
  if (!CAE.test(header.cae)) {
    throw silicieInvalid("el CAE del fichero no tiene la forma ES y 11 caracteres");
  }
  return `IESA1V2-${header.cae}-${header.exerciseYear}.csv`;
}

/** Alcohol puro en mililitros, HALF_UP (§7 campo 33): cantidad × grado / 100. */
export function pureAlcoholMl(volumeMl: number, gradoCenti: number): number {
  if (!Number.isSafeInteger(volumeMl) || volumeMl < 0) {
    throw silicieInvalid("el volumen del alcohol puro tiene que ser un entero de mililitros ≥ 0");
  }
  if (!Number.isSafeInteger(gradoCenti) || gradoCenti < 0 || gradoCenti > 2500) {
    throw silicieInvalid("el grado alcohólico está fuera de 0 a 25");
  }
  const numerator = volumeMl * gradoCenti;
  if (!Number.isSafeInteger(numerator)) {
    throw silicieInvalid("desbordamiento al calcular el alcohol puro");
  }
  return Math.floor((numerator + 5000) / 10000);
}

export function renderAltaAsientosCsv(
  entries: readonly SilicieEntryDraft[],
  header: AltaAsientosHeader,
): AltaAsientosCsv {
  const lines = [IESA1_V2_COLUMNS.join(";")];
  for (const entry of entries) {
    lines.push(row(entry, header).join(";"));
  }
  return {
    bytes: encodeLatin1(lines.join(CSV_LINE_ENDING) + CSV_LINE_ENDING),
    filename: altaAsientosFilename(header),
  };
}

function row(entry: SilicieEntryDraft, header: AltaAsientosHeader): string[] {
  const fields = entry.fields;
  const reference = formatLocalReference(header.exerciseYear, entry.localSeq);
  if (fields.numeroReferenciaInterno !== reference) {
    throw silicieInvalid(
      `la referencia interna ${fields.numeroReferenciaInterno} no coincide con el ejercicio ${header.exerciseYear} y el correlativo ${entry.localSeq}`,
    );
  }
  const cantidad = formatMilli(fields.cantidad, 13);
  const grado = fields.gradoCenti === null ? "" : formatGrado(fields.gradoCenti);
  const alcohol =
    fields.gradoCenti === null || fields.unidadMedida !== "LTR"
      ? ""
      : formatMilli(pureAlcoholMl(fields.cantidad, fields.gradoCenti), 13);
  const cells = [
    fields.numeroReferenciaInterno,
    fields.numeroAsientoPrevio,
    fields.numeroAsientoPrevioReintroduccion,
    toDmy(entry.movementDate),
    fields.fechaRegistroContable === "" ? "" : toDmy(fields.fechaRegistroContable),
    entry.entryKind,
    fields.diferenciaMenos,
    fields.regimenFiscal,
    fields.tipoOperacion,
    fields.numeroOperacion,
    fields.descripcionUnidadFabricacion,
    fields.codigoUnidadFabricacion,
    fields.numeroOperacionFabricacionAnterior,
    fields.tipoJustificante,
    fields.numeroJustificante,
    fields.tipoDocumentoIdentificativo,
    fields.numeroDocumentoIdentificativo,
    fields.razonSocial,
    fields.caeSeed,
    "",
    "",
    "",
    fields.epigrafe,
    fields.codigoEpigrafe,
    fields.codigoNc,
    fields.clave,
    cantidad,
    fields.unidadMedida,
    fields.descripcionProducto,
    fields.referenciaProducto,
    fields.densidadE6 === null ? "" : formatDensity(fields.densidadE6),
    grado,
    alcohol,
    "",
    "",
    "",
    "",
    fields.tipoEnvase,
    fields.capacidadEnvaseMl === null ? "" : formatMilli(fields.capacidadEnvaseMl, 4),
    fields.numeroEnvases === null ? "" : formatCount(fields.numeroEnvases, 6),
    fields.indicadorMarcasFiscales,
    fields.observaciones,
  ];
  if (cells.length !== IESA1_V2_COLUMNS.length) {
    throw silicieInvalid(`la fila no tiene ${IESA1_V2_COLUMNS.length} columnas`);
  }
  assertRow(entry.entryKind, cells);
  return cells;
}

function assertRow(kind: SilicieMovementCode, cells: readonly string[]): void {
  const value = (index: number): string => {
    const cell = cells[index];
    if (cell === undefined) {
      throw silicieInvalid(`falta la columna ${index + 1}`);
    }
    if (/[;"\r\n]/.test(cell)) {
      throw silicieInvalid(`la columna ${index + 1} contiene un carácter que §7 no dice cómo entrecomillar`);
    }
    return cell;
  };
  const required = [0, 3, 5, 7, 13, 14, 24, 26, 27, 28, 29];
  for (const index of required) {
    if (value(index) === "") {
      throw silicieInvalid(`falta el campo obligatorio ${IESA1_V2_COLUMNS[index] ?? index}`);
    }
  }
  for (let index = 0; index < cells.length; index += 1) {
    value(index);
  }
  if ((kind === "A30" || kind === "A32" || kind === "A31") && value(6) === "") {
    throw silicieInvalid("falta el tipo de pérdida del campo 7");
  }
  if ((kind === "A14" || kind === "A15" || kind === "A32") && (value(8) === "" || value(9) === "")) {
    throw silicieInvalid("A14, A15 y A32 exigen tipo y número de operación");
  }
  if ((kind === "A35" || kind === "A36" || kind === "A42" || kind === "A43") && value(41) === "") {
    throw silicieInvalid("A35, A36, A42 y A43 exigen observaciones");
  }
  if (value(22) !== "" && (value(31) === "" || value(32) === "")) {
    throw silicieInvalid("el vino exige grado y cantidad de alcohol puro");
  }
  const envase = value(37) !== "" || value(38) !== "" || value(39) !== "";
  if (envase && (value(37) === "" || value(38) === "" || value(39) === "")) {
    throw silicieInvalid("el envasado exige tipo, capacidad y número de envases");
  }
  const limits: ReadonlyArray<readonly [number, number]> = [
    [0, 20],
    [1, 35],
    [2, 35],
    [9, 30],
    [10, 35],
    [11, 20],
    [12, 30],
    [14, 30],
    [16, 15],
    [17, 125],
    [18, 13],
    [24, 8],
    [28, 100],
    [29, 20],
    [40, 1],
    [41, 350],
  ];
  for (const pair of limits) {
    const index = pair[0];
    const max = pair[1];
    if (index === undefined || max === undefined) {
      throw silicieInvalid("límite de columna incompleto");
    }
    const cell = value(index);
    if (cell.length > max) {
      throw silicieInvalid(`${IESA1_V2_COLUMNS[index] ?? index} supera AN ${max}`);
    }
  }
}

/** Mililitros o gramos → unidad con 3 decimales y punto (§7, N(16,3) o N(7,3)). */
export function formatMilli(value: number, maxIntegerDigits: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw silicieInvalid("la cantidad a formatear tiene que ser un entero ≥ 0");
  }
  const whole = Math.floor(value / 1000);
  const frac = value % 1000;
  if (String(whole).length > maxIntegerDigits) {
    throw silicieInvalid("la cantidad supera el formato numérico de §7");
  }
  return `${whole}.${String(frac).padStart(3, "0")}`;
}

export function formatGrado(gradoCenti: number): string {
  if (!Number.isSafeInteger(gradoCenti) || gradoCenti < 0 || gradoCenti > 2500) {
    throw silicieInvalid("el grado alcohólico está fuera de 0 a 25");
  }
  const whole = Math.floor(gradoCenti / 100);
  const frac = gradoCenti % 100;
  return `${whole}.${String(frac).padStart(2, "0")}0`;
}

function formatDensity(scaled: number): string {
  if (!Number.isSafeInteger(scaled) || scaled < 0) {
    throw silicieInvalid("la densidad tiene que ser un entero ≥ 0 escalado por 1.000.000");
  }
  const whole = Math.floor(scaled / 1_000_000);
  const frac = scaled % 1_000_000;
  if (whole > 99) {
    throw silicieInvalid("la densidad supera N(8,6)");
  }
  return `${whole}.${String(frac).padStart(6, "0")}`;
}

function formatCount(value: number, digits: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || String(value).length > digits) {
    throw silicieInvalid(`el número de envases supera N(${digits})`);
  }
  return String(value);
}

export function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 255) {
      throw silicieInvalid("el CSV es ISO-8859-1 y hay un carácter que no cabe");
    }
    bytes[index] = code;
  }
  return bytes;
}
