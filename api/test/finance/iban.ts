import { isValidIban } from '../../src/core/party/iban';

function mod97(value: string): number {
  const digits = value.replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));
  let remainder = 0;
  for (const char of digits) remainder = (remainder * 10 + Number(char)) % 97;
  return remainder;
}

/** IBAN español sintético. El número de cuenta de 10 dígitos fija los 4 últimos. */
export function spanishIban(bank: string, branch: string, account: string): string {
  if (!/^\d{4}$/.test(bank) || !/^\d{4}$/.test(branch) || !/^\d{10}$/.test(account)) {
    throw new Error('El BBAN de prueba no tiene la longitud esperada');
  }
  const bban = `${bank}${branch}00${account}`;
  const check = String(98 - mod97(`${bban}ES00`)).padStart(2, '0');
  const iban = `ES${check}${bban}`;
  if (!isValidIban(iban)) throw new Error('El IBAN de prueba no supera el módulo 97');
  return iban;
}
