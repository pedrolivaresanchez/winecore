type Listener = () => void;

let denied = false;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function markNoAccess() {
  if (denied) return;
  denied = true;
  emit();
}

export function clearNoAccess() {
  if (!denied) return;
  denied = false;
  emit();
}

export function isNoAccess() {
  return denied;
}

export function subscribeNoAccess(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
