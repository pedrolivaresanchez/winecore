const NBSP = /[\u00a0\u202f]/g;

function spaces(value: string): string {
  return value.replace(NBSP, " ");
}

/** Agrupa miles con punto y decimales con coma, sin depender del ICU del runtime. */
function formatGrouped(value: number, fractionDigits: number): string {
  const sign = value < 0 ? "-" : "";
  const [whole, frac] = Math.abs(value).toFixed(fractionDigits).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fractionDigits > 0 ? `${sign}${grouped},${frac}` : `${sign}${grouped}`;
}

function asDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateFormat = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormat = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return formatGrouped(value, 0);
}

/** `1.234,56 €` */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${formatGrouped(value, 2)} €`;
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Agrupa un texto decimal: miles con punto y decimales con coma, sin pasar por Number. */
export function formatDecimal(value: string, fractionDigits: number): string {
  const match = DECIMAL.exec(value.trim());
  if (!match) return "—";
  const negative = match[1] === "-";
  let whole = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  if (!whole) whole = "0";
  const frac = match[3] ?? "";
  let outFrac = "";
  if (fractionDigits === 0) {
    if ((frac[0] ?? "0") >= "5") whole = (BigInt(whole) + 1n).toString();
  } else if (frac.length <= fractionDigits) {
    outFrac = frac.padEnd(fractionDigits, "0");
  } else {
    const keep = frac.slice(0, fractionDigits);
    if ((frac[fractionDigits] ?? "0") < "5") {
      outFrac = keep;
    } else {
      const bumped = (BigInt(keep || "0") + 1n).toString().padStart(fractionDigits, "0");
      if (bumped.length > fractionDigits) {
        whole = (BigInt(whole) + 1n).toString();
        outFrac = "0".repeat(fractionDigits);
      } else {
        outFrac = bumped;
      }
    }
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const zero = whole === "0" && (outFrac === "" || /^0+$/.test(outFrac));
  const sign = negative && !zero ? "-" : "";
  return fractionDigits > 0 ? `${sign}${grouped},${outFrac}` : `${sign}${grouped}`;
}

/** Importe decimal con separadores españoles. Las tarifas usan 4 decimales: `7,9000 €`. */
export function formatDecimalMoney(value: string | null | undefined, fractionDigits = 4): string {
  if (!value) return "—";
  const shown = formatDecimal(value, fractionDigits);
  return shown === "—" ? shown : `${shown} €`;
}

/** `31/10/2026` en Europe/Madrid. */
export function formatDate(value: Date | string | number): string {
  const date = asDate(value);
  if (!date) return "—";
  return spaces(dateFormat.format(date));
}

/** `31/10/2026, 23:30` en Europe/Madrid, 24 h. */
export function formatDateTime(value: Date | string | number): string {
  const date = asDate(value);
  if (!date) return "—";
  return spaces(dateTimeFormat.format(date));
}

/** Litros con 3 decimales: `1.234,500 L`. */
export function formatLitres(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${formatGrouped(value, 3)}\u00a0L`;
}

/** Puntos porcentuales: `21 %`. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const raw = formatGrouped(value, 2).replace(/,00$/, "").replace(/(,\d)0$/, "$1");
  return `${raw} %`;
}
