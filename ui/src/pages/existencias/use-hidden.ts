import { useState } from "react";
import { readStorage, writeStorage } from "@/lib/storage";

function readHidden(key: string, ids: readonly string[], defaults: readonly string[]): Set<string> {
  const raw = readStorage(key);
  if (!raw) return new Set(defaults);
  try {
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed.filter((id) => ids.includes(id)));
  } catch {
    return new Set(defaults);
  }
}

export function useHiddenColumns(key: string, ids: readonly string[], defaults: readonly string[] = []) {
  const [hidden, setHidden] = useState(() => readHidden(key, ids, defaults));

  function toggle(id: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStorage(key, JSON.stringify([...next]));
      return next;
    });
  }

  return { hidden, toggle };
}
