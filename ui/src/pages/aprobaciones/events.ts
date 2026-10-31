const CHANGED = "winecore-approvals-changed";

export function notifyApprovalsChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

export function onApprovalsChanged(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}
