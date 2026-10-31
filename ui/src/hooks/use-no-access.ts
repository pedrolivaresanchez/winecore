import { useSyncExternalStore } from "react";
import { isNoAccess, subscribeNoAccess } from "@/lib/access";

export function useNoAccess() {
  return useSyncExternalStore(subscribeNoAccess, isNoAccess, () => false);
}
