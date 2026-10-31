export const SIDEBAR_KEY = "winecore.sidebar";

export function entityStorageKey(email: string): string {
  return `winecore.entity.${email}`;
}

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* El navegador puede bloquear el almacenamiento. La elección sigue en memoria. */
  }
}
