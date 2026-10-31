import { copy } from "@/i18n";
import type { EntityCode } from "@/lib/types";

const roles = copy.roles as Record<string, string>;

export function roleLabel(role: string): string {
  return roles[role] ?? role;
}

export function entityName(code: EntityCode | "all" | null): string {
  if (code === "PO") return copy.entity.po;
  if (code === "CVPO") return copy.entity.cvpo;
  return copy.entity.all;
}

export function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}
