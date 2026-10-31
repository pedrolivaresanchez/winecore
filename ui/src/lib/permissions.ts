import type { Me } from "@/lib/types";

export function allows(me: Me, permission?: string): boolean {
  if (!permission) return true;
  if (me.roles.some((role) => role.role === "owner")) return true;
  return me.permissions.includes(permission);
}
