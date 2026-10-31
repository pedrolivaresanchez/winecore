/** Dígito de control GS1 (GTIN-8/12/13/14). El cuerpo no incluye el dígito. */

export function gtinCheckDigit(body: string): string | null {
  if (!/^\d+$/.test(body) || body.length < 7 || body.length > 13) return null;
  let sum = 0;
  const digits = body.split("").map((char) => Number(char));
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const fromRight = digits.length - 1 - index;
    const digit = digits[index] ?? 0;
    sum += digit * (fromRight % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

export function gtinWithCheck(body: string): string | null {
  const check = gtinCheckDigit(body);
  return check === null ? null : `${body}${check}`;
}

export function gtinError(value: string, lengths: number[]): string | null {
  const digits = value.trim();
  if (!digits) return null;
  if (!/^\d+$/.test(digits) || !lengths.includes(digits.length)) {
    const expected = lengths.join(", ");
    return `El GTIN tiene que tener ${expected} dígitos.`;
  }
  const expected = gtinCheckDigit(digits.slice(0, -1));
  if (expected === null || expected !== digits.slice(-1)) return "El dígito de control GS1 no cuadra.";
  return null;
}
