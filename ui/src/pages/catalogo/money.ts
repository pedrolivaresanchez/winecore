/** Precios y cantidades como texto decimal, sin pasar por Number. */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export function scaleDecimal(value: string, places = 6): bigint | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const whole = match[2] ?? "0";
  const frac = match[3] ?? "";
  const keep = frac.slice(0, places);
  const roundUp = (frac[places] ?? "0") >= "5";
  let digits = `${whole}${keep.padEnd(places, "0")}`.replace(/^0+(?=\d)/, "");
  if (roundUp && frac.length > places) {
    digits = (BigInt(digits || "0") + 1n).toString();
  }
  const amount = BigInt(digits || "0");
  return match[1] === "-" ? -amount : amount;
}

export function unscaleDecimal(value: bigint, places = 6): string {
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(places + 1, "0");
  const whole = abs.slice(0, abs.length - places).replace(/^0+(?=\d)/, "");
  const frac = abs.slice(abs.length - places).replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : whole;
  return negative && body !== "0" ? `-${body}` : body;
}

export function isDecimal(value: string): boolean {
  return DECIMAL.test(value.trim());
}

export function cmpDecimal(left: string, right: string): number | null {
  const a = scaleDecimal(left);
  const b = scaleDecimal(right);
  if (a === null || b === null) return null;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isPositiveDecimal(value: string | null | undefined): boolean {
  if (!value) return false;
  const scaled = scaleDecimal(value);
  return scaled !== null && scaled > 0n;
}

export function sumDecimals(values: Array<string | null | undefined>): string {
  let total = 0n;
  for (const value of values) {
    if (!value) continue;
    const scaled = scaleDecimal(value);
    if (scaled === null) continue;
    total += scaled;
  }
  return unscaleDecimal(total);
}

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

/** `7,9000 €` — cuatro decimales, como en la tarifa. */
export function formatPrice(value: string | null | undefined): string {
  if (!value) return "—";
  const shown = formatDecimal(value, 4);
  return shown === "—" ? shown : `${shown} €`;
}

/** Cantidad: enteros sin decimales, el resto con tres. */
export function formatQty(value: string | null | undefined): string {
  if (!value) return "—";
  const shown = formatDecimal(value, 3);
  if (shown === "—") return shown;
  return shown.replace(/,000$/, "");
}

export function formatAlcohol(value: string | null | undefined): string {
  if (!value) return "—";
  const shown = formatDecimal(value, 2);
  return shown === "—" ? shown : `${shown} % vol.`;
}

/** Mililitros enteros a litros con tres decimales: `1.500` → `1,500 L`. */
export function formatMl(value: string | null | undefined): string {
  if (!value) return "—";
  const scaled = scaleDecimal(value, 0);
  if (scaled === null) return "—";
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = (abs / 1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = (abs % 1000n).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${whole},${frac} L`;
}

export function formatVolumeMl(ml: number): string {
  if (!Number.isInteger(ml) || ml < 0) return "—";
  return formatMl(String(ml));
}

/** Acepta coma o punto. Vacío si el texto no es un decimal positivo acotado. */
export function normalizeDecimal(
  input: string,
  maxFraction: number,
): { value: string; error?: string } {
  const trimmed = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return { value: "", error: "Indica un importe." };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { value: "", error: "Usa un número igual o mayor que cero." };
  const [wholeRaw, frac = ""] = trimmed.split(".");
  const whole = (wholeRaw ?? "0").replace(/^0+(?=\d)/, "");
  if (whole.length > 8) return { value: "", error: "El importe es demasiado grande." };
  if (frac.length > maxFraction) {
    return { value: "", error: `Como máximo ${maxFraction} decimales.` };
  }
  return { value: frac ? `${whole}.${frac}` : whole };
}

export function showDecimal(value: string): string {
  return value.replace(".", ",");
}
