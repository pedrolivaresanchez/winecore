export function asString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  return asString(value);
}

export function asBool(value: unknown): boolean {
  return value === true;
}

export function asNullableInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  return Number(value);
}

export function asJsonObject(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
