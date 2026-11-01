export type SettingsFocus = "security" | "approvals" | "numbering";

export function openSettings(category: SettingsFocus) {
  window.dispatchEvent(new CustomEvent<SettingsFocus>("winecore-settings", { detail: category }));
}
