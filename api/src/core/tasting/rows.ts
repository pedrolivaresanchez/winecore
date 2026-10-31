export function asText(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

export function asId(value: unknown): string {
  return asText(value).toLowerCase();
}

export function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function asInt(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed == null || !Number.isInteger(parsed)) return null;
  return parsed;
}

export function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

export function asInstant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = asText(value);
  const parsed = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString();
}

export function asDate(value: unknown): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(asText(value));
  if (match?.[1]) return match[1];
  return asInstant(value).slice(0, 10);
}

export function asJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function asStringList(value: unknown): string[] {
  return asJsonArray(value).filter((item): item is string => typeof item === 'string');
}

export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
