const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_LETTERS = "JABCDEFGHI";

export function normalizeTaxId(value: string): string {
  return value.replace(/[\s.-]/g, "").toUpperCase();
}

function nifLetter(num: number): string {
  return NIF_LETTERS[num % 23] ?? "";
}

function cifControl(digits: string): number {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = digits.charCodeAt(index) - 48;
    if (index % 2 === 0) {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += digit;
    }
  }
  return (10 - (sum % 10)) % 10;
}

function cifOk(id: string): boolean {
  const control = cifControl(id.slice(1, 8));
  const last = id[8] ?? "";
  const letter = CIF_LETTERS[control] ?? "";
  if ("ABEH".includes(id[0] ?? "")) return last === String(control);
  if ("KPQS".includes(id[0] ?? "")) return last === letter;
  return last === String(control) || last === letter;
}

const WARN_NIF = "La letra de control del NIF no coincide";
const WARN_NIE = "La letra de control del NIE no coincide";
const WARN_CIF = "El dígito de control del CIF no coincide";

/**
 * Letra o dígito de control incorrecto: el API lo guarda y avisa, no bloquea.
 * Null si el valor está vacío, no es un identificador español reconocible o el control cuadra.
 */
export function taxIdWarning(value: string, country: string): string | null {
  const id = normalizeTaxId(value);
  if (!id || country !== "ES") return null;
  if (/^\d{8}[A-Z]$/.test(id)) {
    return id[8] === nifLetter(Number(id.slice(0, 8))) ? null : WARN_NIF;
  }
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    const prefix = id[0] === "Y" ? "1" : id[0] === "Z" ? "2" : "0";
    const number = Number(prefix + id.slice(1, 8));
    return id[8] === nifLetter(number) ? null : WARN_NIE;
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) {
    return cifOk(id) ? null : WARN_CIF;
  }
  return null;
}

/** Devuelve un mensaje en español o null si el identificador se puede enviar. Vacío es válido. */
export function taxIdError(value: string, country: string): string | null {
  const id = normalizeTaxId(value);
  if (!id) return null;
  if (country !== "ES") {
    if (id.length < 2 || id.length > 20) return "El identificador fiscal no es válido.";
    return null;
  }
  if (taxIdWarning(value, country)) return null;
  if (/^\d{8}[A-Z]$/.test(id)) return null;
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) return null;
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) return null;
  return "El NIF no es válido.";
}
