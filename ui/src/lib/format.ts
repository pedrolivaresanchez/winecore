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
  return `${formatGrouped(value, 3)} L`;
}

/** Puntos porcentuales: `21 %`. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const raw = formatGrouped(value, 2).replace(/,00$/, "").replace(/(,\d)0$/, "$1");
  return `${raw} %`;
}
