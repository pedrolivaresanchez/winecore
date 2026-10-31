/**
 * GS1 mod-10 check digit (GLN and GTIN).
 * From the right of the payload, weights alternate 3, 1, 3, 1, …
 */

export function gs1CheckDigit(digitsWithoutCheck: string): number {
  if (!/^\d+$/.test(digitsWithoutCheck)) {
    throw new RangeError('GS1 check digit input must be a non-empty digit string');
  }
  let sum = 0;
  for (let i = 0; i < digitsWithoutCheck.length; i += 1) {
    const digit = digitsWithoutCheck.charCodeAt(digitsWithoutCheck.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGln(value: string): boolean {
  return /^\d{13}$/.test(value) && hasValidCheck(value);
}

export function isValidGtin(value: string): boolean {
  return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value) && hasValidCheck(value);
}

function hasValidCheck(value: string): boolean {
  const expected = gs1CheckDigit(value.slice(0, -1));
  return value.charCodeAt(value.length - 1) - 48 === expected;
}
