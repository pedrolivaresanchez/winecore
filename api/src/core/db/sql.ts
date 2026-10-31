import { Decimal } from 'decimal.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

class RawSql {
  constructor(readonly text: string) {}
}

class JsonSql {
  constructor(readonly value: unknown) {}
}

function quote(value: string): string {
  if (value.includes('\0')) {
    throw new Error('El texto contiene un byte NUL');
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function render(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof RawSql) return value.text;
  if (value instanceof JsonSql) {
    const json = JSON.stringify(value.value);
    if (json === undefined) throw new Error('Valor JSON no serializable');
    return `${quote(json)}::JSON`;
  }
  if (value instanceof Decimal) {
    if (!value.isFinite()) throw new Error('Decimal no finito');
    return `DECIMAL '${value.toFixed()}'`;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Fecha no válida');
    return `TIMESTAMPTZ '${value.toISOString()}'`;
  }
  if (value instanceof Uint8Array) {
    return `from_base64('${Buffer.from(value).toString('base64')}')`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => render(item)).join(', ')}]`;
  }
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Número no finito');
    const rendered = Object.is(value, -0) ? '0' : String(value);
    if (/[eE]/.test(rendered)) throw new Error('Número fuera de rango para un literal SQL');
    return rendered;
  }
  if (typeof value === 'bigint') return value.toString();
  throw new Error('Valor SQL no soportado');
}

export function sql(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  let out = strings[0] ?? '';
  for (let index = 0; index < values.length; index += 1) {
    out += render(values[index]);
    out += strings[index + 1] ?? '';
  }
  return out;
}

sql.raw = (identifier: string): RawSql => {
  if (!IDENTIFIER.test(identifier)) {
    throw new Error('Identificador SQL no permitido');
  }
  return new RawSql(identifier);
};

sql.json = (value: unknown): JsonSql => new JsonSql(value);
