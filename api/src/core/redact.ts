const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/;
const NIF = /\b\d{8}[A-Z]\b/;
const NIE = /\b[XYZ]\d{7}[A-Z]\b/i;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\d[\s.-]?){8,14}\d/;
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b/i;
const SECRET = /Bearer\s+\S+|wc_[A-Za-z0-9_-]{8,}|TIMBAL_PROJECT_SECRET\s*[:=]|WINECORE_DATA_KEY\s*[:=]/i;

/** True when a string may contain personal data, SQL or a credential. */
export function isSensitiveText(value: string): boolean {
  return EMAIL.test(value)
    || IBAN.test(value)
    || NIF.test(value)
    || NIE.test(value)
    || PHONE.test(value)
    || SQL.test(value)
    || SECRET.test(value);
}

/** Message safe to write to stdout. Sensitive text is replaced, never trimmed around. */
export function safeLogMessage(value: string): string {
  if (isSensitiveText(value)) return 'Error interno';
  return value.slice(0, 180);
}
